import { randomBytes } from "node:crypto";
import {
  json,
  optionsResponse,
  requireSession,
  safeId,
  stateStore,
  backupStore,
} from "../lib/profile-core.mjs";

const MAX_BACKUPS_PER_PROFILE = 8;
const MAX_SNAPSHOT_BYTES = 4_800_000;
const BACKUP_PREFIX = "backup-";

function newBackupId() {
  return `${Date.now().toString(36)}-${randomBytes(9).toString("base64url")}`;
}

function profileKey(profile) {
  return safeId(profile?.id || "");
}

function stateKey(profile) {
  return safeId(profile?.stateKey || "");
}

function backupKey(profileId, backupId) {
  const p = safeId(profileId);
  const b = safeId(backupId);
  return p && b ? `${BACKUP_PREFIX}${p}-${b}` : "";
}

function snapshotSize(snapshot) {
  try { return Buffer.byteLength(JSON.stringify(snapshot), "utf8"); } catch { return Infinity; }
}

function validCloudSnapshot(snapshot) {
  return !!snapshot && typeof snapshot === "object" && !!snapshot.state && typeof snapshot.state === "object" && !!snapshot.state.items;
}

async function listBackupRecords(profileId, includePayload = false) {
  const clean = safeId(profileId);
  if (!clean) return [];
  const { blobs = [] } = await backupStore.list({ prefix: `${BACKUP_PREFIX}${clean}-` });
  const records = [];
  for (const entry of blobs) {
    try {
      const record = await backupStore.get(entry.key, { type: "json", consistency: "strong" });
      if (!record || String(record.profileId || "") !== clean) continue;
      records.push(includePayload ? record : {
        id: record.id,
        profileId: record.profileId,
        profileName: record.profileName || "",
        createdAt: record.createdAt || null,
        kind: record.kind || "manual",
        bytes: Number(record.bytes || 0),
        sourceVersion: record.sourceVersion || null,
      });
    } catch (error) {
      console.warn("marvel-backup list", entry?.key, error);
    }
  }
  records.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return records;
}

async function pruneBackups(profileId) {
  const records = await listBackupRecords(profileId, false);
  const stale = records.slice(MAX_BACKUPS_PER_PROFILE);
  for (const record of stale) {
    const key = backupKey(profileId, record.id);
    if (key) {
      try { await backupStore.delete(key); } catch (error) { console.warn("marvel-backup prune", key, error); }
    }
  }
}

async function createBackup(profile, kind = "manual") {
  const pid = profileKey(profile);
  const skey = stateKey(profile);
  if (!pid || !skey) return { error: "Profile cloud identity missing", status: 500 };
  const current = await stateStore.get(`account-${skey}`, { type: "json", consistency: "strong" });
  if (!validCloudSnapshot(current)) return { error: "No hay un estado Cloud válido para respaldar", status: 404 };
  const bytes = snapshotSize(current);
  if (!Number.isFinite(bytes) || bytes > MAX_SNAPSHOT_BYTES) return { error: "El estado Cloud supera el tamaño máximo de copia", status: 413 };

  const id = newBackupId();
  const record = {
    format: "maraton-marvel-cloud-backup",
    version: 118,
    id,
    profileId: pid,
    profileName: String(profile.name || ""),
    createdAt: new Date().toISOString(),
    kind: String(kind || "manual"),
    bytes,
    sourceVersion: Number(current.version || current.profileVersion || 0) || null,
    payload: current,
  };
  await backupStore.setJSON(backupKey(pid, id), record);
  await pruneBackups(pid);
  return { backup: {
    id,
    profileId: pid,
    profileName: record.profileName,
    createdAt: record.createdAt,
    kind: record.kind,
    bytes,
    sourceVersion: record.sourceVersion,
  }};
}

async function handleList(req, auth) {
  const records = await listBackupRecords(profileKey(auth.profile), false);
  return json({ ok: true, backups: records }, 200, req);
}

async function handleCreate(req, auth) {
  const result = await createBackup(auth.profile, "manual");
  if (result.error) return json({ error: result.error }, result.status || 500, req);
  return json({ ok: true, backup: result.backup }, 201, req);
}

async function handleRestore(req, auth, body) {
  const pid = profileKey(auth.profile);
  const id = String(body?.backupId || "").trim();
  const key = backupKey(pid, id);
  if (!key) return json({ error: "Backup inválido" }, 400, req);

  const target = await backupStore.get(key, { type: "json", consistency: "strong" });
  if (!target || String(target.profileId || "") !== pid || !validCloudSnapshot(target.payload)) {
    return json({ error: "Copia no encontrada o incompatible" }, 404, req);
  }
  const targetSize = snapshotSize(target.payload);
  if (!Number.isFinite(targetSize) || targetSize > MAX_SNAPSHOT_BYTES) return json({ error: "La copia supera el tamaño máximo permitido" }, 413, req);

  // Antes de restaurar, dejamos una copia server-side del estado Cloud actual.
  try {
    const safety = await createBackup(auth.profile, "pre-restore");
    if (safety.error) return json({ error: `No se pudo crear la copia de seguridad previa: ${safety.error}` }, safety.status || 500, req);
  } catch (error) {
    console.error("marvel-backup pre-restore", error);
    return json({ error: "No se pudo crear la copia de seguridad previa" }, 500, req);
  }

  const skey = stateKey(auth.profile);
  if (!skey) return json({ error: "Profile cloud identity missing" }, 500, req);
  await stateStore.setJSON(`account-${skey}`, target.payload);
  await pruneBackups(pid);
  return json({ ok: true, restored: {
    id: target.id,
    createdAt: target.createdAt || null,
    profileName: target.profileName || auth.profile?.name || "",
  }}, 200, req);
}

async function handleDelete(req, auth, body) {
  const pid = profileKey(auth.profile);
  const id = String(body?.backupId || "").trim();
  const key = backupKey(pid, id);
  if (!key) return json({ error: "Backup inválido" }, 400, req);
  const record = await backupStore.get(key, { type: "json", consistency: "strong" });
  if (!record || String(record.profileId || "") !== pid) return json({ error: "Copia no encontrada" }, 404, req);
  await backupStore.delete(key);
  return json({ ok: true, backupId: id }, 200, req);
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return optionsResponse(req);
  try {
    const auth = await requireSession(req);
    if (auth.error) return auth.error;
    if (auth.session?.role !== "USER") {
      return json({ error: "El perfil administrador no tiene copias de maratón" }, 403, req);
    }
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, req);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "list").trim();
    if (action === "list") return await handleList(req, auth);
    if (action === "create") return await handleCreate(req, auth);
    if (action === "restore") return await handleRestore(req, auth, body);
    if (action === "delete") return await handleDelete(req, auth, body);
    return json({ error: "Unsupported action" }, 400, req);
  } catch (error) {
    console.error("marvel-backup", error);
    return json({ error: "Server error" }, 500, req);
  }
}
