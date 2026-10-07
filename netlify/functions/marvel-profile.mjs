import { randomBytes } from "node:crypto";
import {
  ADMIN_PROFILE_ID,
  ADMIN_NAME,
  ADMIN_PERSON_1,
  ADMIN_PERSON_2,
  JM_BOOTSTRAP_MARKER,
  LEGACY_JM_ROOT_ID,
  adminCookie,
  adminToken,
  bodySizeOk,
  clearFailedLogins,
  clearSessionCookie,
  clearAdminElevationCookie,
  adminElevationCookie,
  hasAdminCapability,
  readAdminElevation,
  createStateKey,
  deriveLegacyV131StateKey,
  deleteProfileAndState,
  findProfileByPair,
  getProfile,
  hashPin,
  json,
  legacyVerifier,
  loginLockRemaining,
  makeProfile,
  normalizePair,
  optionsResponse,
  profilePublic,
  profileStore,
  secretEqual,
  refreshProfileIndex,
  registerFailedLogin,
  requireSession,
  saveProfileIndex,
  stateStore,
  sessionStore,
  sessionRecordKey,
  listProfileSessions,
  revokeSession,
  revokeAllProfileSessions,
  userCookie,
  validPin,
  verifyLegacyPin,
  verifyScrypt,
  upgradeLegacyVerifier,
} from "../lib/profile-core.mjs";

const maxSnapshotBytes = 4_800_000;

function newSessionId() {
  return randomBytes(18).toString("base64url");
}

async function registerNewSession(req, session, profileId, role = "USER") {
  const sid = String(session?.sid || "");
  const key = sessionRecordKey(profileId, sid, role);
  if (!key) throw new Error("Invalid session id");
  const now = new Date().toISOString();
  await sessionStore.setJSON(key, {
    id: sid,
    profileId: String(profileId),
    role,
    createdAt: new Date(Number(session?.iat || 0) * 1000 || Date.now()).toISOString(),
    lastSeenAt: now,
    expiresAt: new Date(Number(session?.exp || 0) * 1000 || Date.now()).toISOString(),
    remember: !!session?.rm,
    deviceType: (() => {
      const ua = String(req.headers.get("user-agent") || "").toLowerCase();
      if (/ipad|tablet|android(?!.*mobile)/i.test(ua)) return "Tablet";
      if (/mobi|iphone|ipod|android/i.test(ua)) return "Móvil";
      if (/windows|macintosh|mac os x|linux|cros|x11/i.test(ua)) return "Escritorio";
      return "Desconocido";
    })(),
    sessionVersion: role === "USER" ? Number(session?.sv || 1) : null,
    revokedAt: null,
  });
}

function isJuanjoMaria(p1, p2) {
  return normalizePair(p1, p2) === normalizePair("Juanjo", "María");
}

function isFixedJuanjoMaria(profile) {
  return !!profile && (String(profile.id || "") === "jm-user" || isJuanjoMaria(profile.person1, profile.person2));
}

function publicList(profiles) {
  return [
    {
      id: ADMIN_PROFILE_ID,
      name: ADMIN_NAME,
      person1: ADMIN_PERSON_1,
      person2: ADMIN_PERSON_2,
      role: "ADMIN",
      root: true,
      virtual: true,
    },
    ...profiles.filter(p => p.role === "USER").map(profilePublic),
  ];
}

async function ensureBootstrapJuanjoMaria() {
  const existingById = await getProfile("jm-user");
  const bootstrapMarker = await profileStore.get(JM_BOOTSTRAP_MARKER, { type: "json", consistency: "strong" });
  if (existingById?.role === "USER") {
    if (!bootstrapMarker) await profileStore.setJSON(JM_BOOTSTRAP_MARKER, { version: 1, profileId: "jm-user", createdAt: new Date().toISOString() });
    return existingById;
  }
  if (bootstrapMarker) return null;
  const existing = await findProfileByPair("Juanjo", "María");
  if (existing?.role === "USER") {
    const normalized = existing.id === "jm-user" ? existing : { ...existing, id: "jm-user", updatedAt: new Date().toISOString() };
    if (normalized.id !== existing.id) {
      await profileStore.setJSON("profile-jm-user", normalized);
      await profileStore.delete(`profile-${existing.id}`);
      const profiles = (await refreshProfileIndex()).filter(p => p.id !== existing.id);
      profiles.push(normalized);
      await saveProfileIndex(profiles);
    }
    await profileStore.setJSON(JM_BOOTSTRAP_MARKER, { version: 1, profileId: "jm-user", createdAt: new Date().toISOString() });
    return normalized;
  }
  const pin = String(process.env.MARVEL_JUANJO_MARIA_PIN || "").trim();
  if (!validPin(pin)) return null;
  const profile = makeProfile({
    id: "jm-user",
    person1: "Juanjo",
    person2: "María",
    stateKey: deriveLegacyV131StateKey("Juanjo", "María", pin),
    verifier: hashPin(pin),
    role: "USER",
    root: false,
    migratedFrom: "v1.15-bootstrap",
  });
  await profileStore.setJSON(`profile-${profile.id}`, profile);
  const profiles = await refreshProfileIndex();
  if (!profiles.some(p => p.id === profile.id)) profiles.push(profile);
  await saveProfileIndex(profiles);
  await profileStore.setJSON(JM_BOOTSTRAP_MARKER, { version: 1, profileId: "jm-user", createdAt: profile.createdAt });
  return profile;
}

async function listResponse(req) {
  await ensureBootstrapJuanjoMaria();
  const profiles = await refreshProfileIndex();
  return json({ version: 1, profiles: publicList(profiles) }, 200, req);
}

async function handleAdminLogin(req, body) {
  const token = String(body?.token || "");
  let expected = "";
  try { expected = adminToken(); } catch { return json({ error: "Server admin secret is not configured" }, 503, req); }
  if (!token || !secretEqual(token, expected)) return json({ error: "Invalid administrator credential" }, 403, req);
  const remember = body?.remember === true;
  const sid = newSessionId();
  const cookie = adminCookie(remember, sid);
  const decoded = decodeSessionCookieValue(cookie);
  await registerNewSession(req, decoded, ADMIN_PROFILE_ID, "ADMIN");
  const response = json({ ok: true, profile: { id: ADMIN_PROFILE_ID, name: ADMIN_NAME, person1: ADMIN_PERSON_1, person2: ADMIN_PERSON_2, role: "ADMIN", root: true } }, 200, req);
  return setCookie(response, cookie);
}

async function handleLogin(req, body) {
  const id = String(body?.profileId || "").trim();
  const pin = String(body?.pin || "").trim();
  const remember = body?.remember === true;
  if (!id || id === ADMIN_PROFILE_ID) return json({ error: "Invalid profile" }, 400, req);
  if (!validPin(pin)) return json({ error: "Invalid PIN" }, 400, req);
  const profile = await getProfile(id);
  if (!profile || profile.role !== "USER") return json({ error: "Profile not found" }, 404, req);

  const remaining = loginLockRemaining(profile);
  if (remaining > 0) {
    return json({ error: "Too many failed attempts", retryAfterSeconds: Math.ceil(remaining / 1000) }, 429, req);
  }

  let ok = false;
  if (profile.verifier?.alg === "scrypt-v1") ok = verifyScrypt(pin, profile.verifier);
  else if (profile.verifier?.alg === "legacy-pbkdf2-v1") ok = verifyLegacyPin(pin, profile.verifier);
  if (!ok) {
    await registerFailedLogin(profile);
    return json({ error: "Incorrect PIN" }, 401, req);
  }

  let authenticated = await clearFailedLogins(profile);
  if (authenticated.verifier?.alg === "legacy-pbkdf2-v1") {
    authenticated = await upgradeLegacyVerifier(authenticated, pin);
  }

  const sessionVersion = Number(authenticated.sessionVersion || 1);
  const sid = newSessionId();
  authenticated = { ...authenticated, lastAccessAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await profileStore.setJSON(`profile-${authenticated.id}`, authenticated);
  const cookie = userCookie(authenticated, remember, sid);
  const decoded = decodeSessionCookieValue(cookie);
  await registerNewSession(req, decoded, authenticated.id, "USER");

  const response = json({
    ok: true,
    profile: profilePublic(authenticated),
    stateKey: authenticated.stateKey,
  }, 200, req);
  return setCookie(response, cookie);
}

async function handleCreateUser(req, body) {
  const auth = await requireSession(req);
  if (auth.error) return auth.error;
  if (!(await hasAdminCapability(req))) return json({ error: "Insufficient permissions" }, 403, req);
  const person1 = String(body?.person1 || "").trim();
  const person2 = String(body?.person2 || "").trim();
  const pin = String(body?.pin || "").trim();
  if (person1.length < 1 || person1.length > 40 || person2.length < 1 || person2.length > 40 || !validPin(pin)) {
    return json({ error: "Invalid identity or PIN" }, 400, req);
  }
  const duplicate = await findProfileByPair(person1, person2);
  if (duplicate) return json({ error: "A profile with those two names already exists" }, 409, req);
  const profile = makeProfile({ person1, person2, stateKey: createStateKey(), verifier: hashPin(pin), role: "USER", root: false });
  await profileStore.setJSON(`profile-${profile.id}`, profile);
  const profiles = await refreshProfileIndex();
  profiles.push(profile);
  await saveProfileIndex(profiles);
  return json({ ok: true, profile: profilePublic(profile), stateKey: profile.stateKey }, 201, req);
}

async function handleRename(req, body) {
  const auth = await requireSession(req);
  if (auth.error) return auth.error;
  const targetId = String(body?.profileId || auth.profile?.id || "").trim();
  if (targetId === ADMIN_PROFILE_ID) return json({ error: "The administrator identity is fixed" }, 403, req);
  const target = await getProfile(targetId);
  if (!target || target.role !== "USER") return json({ error: "Profile not found" }, 404, req);
  if (isFixedJuanjoMaria(target)) return json({ error: "Juanjo × María es un perfil protegido" }, 403, req);
  const elevated = auth.session.role === "ADMIN" || await hasAdminCapability(req);
  if (!elevated && target.id !== auth.profile.id) return json({ error: "Insufficient permissions" }, 403, req);
  const person1 = String(body?.person1 || "").trim();
  const person2 = String(body?.person2 || "").trim();
  if (!person1 || !person2) return json({ error: "Both names are required" }, 400, req);
  const duplicate = await findProfileByPair(person1, person2);
  if (duplicate && duplicate.id !== target.id) return json({ error: "A profile with those names already exists" }, 409, req);
  const next = { ...target, name: `${person1} × ${person2}`, person1, person2, updatedAt: new Date().toISOString() };
  await profileStore.setJSON(`profile-${target.id}`, next);
  const profiles = await refreshProfileIndex();
  await saveProfileIndex(profiles.map(p => p.id === next.id ? next : p));
  return json({ ok: true, profile: profilePublic(next) }, 200, req);
}

async function handleChangePin(req, body) {
  const auth = await requireSession(req);
  if (auth.error) return auth.error;
  const targetId = String(body?.profileId || auth.profile?.id || "").trim();
  if (targetId === ADMIN_PROFILE_ID) return json({ error: "The administrator credential is managed in Netlify" }, 403, req);
  const target = await getProfile(targetId);
  if (!target || target.role !== "USER") return json({ error: "Profile not found" }, 404, req);
  const isAdmin = auth.session.role === "ADMIN" || await hasAdminCapability(req);
  if (isAdmin && isFixedJuanjoMaria(target)) return json({ error: "El PIN de Juanjo × María solo puede cambiarse desde su propia cuenta" }, 403, req);
  if (!isAdmin && target.id !== auth.profile.id) return json({ error: "Insufficient permissions" }, 403, req);
  const newPin = String(body?.newPin || "").trim();
  if (!validPin(newPin)) return json({ error: "Invalid new PIN" }, 400, req);
  if (!isAdmin) {
    const currentPin = String(body?.currentPin || "").trim();
    if (!validPin(currentPin)) return json({ error: "Current PIN required" }, 400, req);
    const ok = target.verifier?.alg === "scrypt-v1" ? verifyScrypt(currentPin, target.verifier) : verifyLegacyPin(currentPin, target.verifier);
    if (!ok) return json({ error: "Incorrect current PIN" }, 401, req);
  }
  const next = { ...target, verifier: hashPin(newPin), sessionVersion: Number(target.sessionVersion || 1) + 1, failedCount: 0, lockUntil: 0, updatedAt: new Date().toISOString() };
  await profileStore.setJSON(`profile-${target.id}`, next);
  const sameProfile = auth.session.role === "USER" && String(auth.profile?.id || "") === String(target.id);
  await revokeAllProfileSessions(target.id, "USER");
  if (sameProfile) {
    const sid = newSessionId();
    const cookie = userCookie(next, !!auth.session?.rm, sid);
    const decoded = decodeSessionCookieValue(cookie);
    await registerNewSession(req, decoded, target.id, "USER");
    const response = json({ ok: true, profile: profilePublic(next), reauthenticated: true }, 200, req);
    return setCookie(response, cookie);
  }
  return json({ ok: true, profile: profilePublic(next), reauthenticated: false }, 200, req);
}

async function handleDelete(req, body) {
  const auth = await requireSession(req);
  if (auth.error) return auth.error;
  if (!(await hasAdminCapability(req))) return json({ error: "Insufficient permissions" }, 403, req);
  const targetId = String(body?.profileId || "").trim();
  if (!targetId || targetId === ADMIN_PROFILE_ID) return json({ error: "Protected administrator profile" }, 403, req);
  if (auth.session.role !== "ADMIN" && targetId === auth.profile?.id) return json({ error: "No puedes eliminar el perfil con el que estás conectado" }, 403, req);
  const target = await getProfile(targetId);
  if (!target || target.role !== "USER") return json({ error: "Profile not found" }, 404, req);
  if (isFixedJuanjoMaria(target)) return json({ error: "Juanjo × María es un perfil fijo y protegido" }, 403, req);
  await revokeAllProfileSessions(target.id, "USER");
  await deleteProfileAndState(target);
  return json({ ok: true, profileId: targetId }, 200, req);
}

async function handleSessionsList(req, body) {
  const auth = await requireSession(req);
  if (auth.error) return auth.error;
  if (!(await hasAdminCapability(req))) return json({ error: "Insufficient permissions" }, 403, req);
  const targetId = String(body?.profileId || "").trim();
  if (!targetId) return json({ error: "Profile id required" }, 400, req);
  const role = targetId === ADMIN_PROFILE_ID ? "ADMIN" : "USER";
  if (role === "USER") {
    const target = await getProfile(targetId);
    if (!target || target.role !== "USER") return json({ error: "Profile not found" }, 404, req);
  }
  const sessions = await listProfileSessions(targetId, role, String(auth.session?.sid || ""));
  return json({ ok: true, profileId: targetId, sessions }, 200, req);
}

async function handleSessionRevoke(req, body) {
  const auth = await requireSession(req);
  if (auth.error) return auth.error;
  if (!(await hasAdminCapability(req))) return json({ error: "Insufficient permissions" }, 403, req);
  const targetId = String(body?.profileId || "").trim();
  const sessionId = String(body?.sessionId || "").trim();
  if (!targetId || !sessionId) return json({ error: "Profile id and session id required" }, 400, req);
  const role = targetId === ADMIN_PROFILE_ID ? "ADMIN" : "USER";
  if (String(auth.session?.sid || "") === sessionId && String(auth.session?.role || "") === role && String(auth.session?.sub || ADMIN_PROFILE_ID) === targetId) {
    return json({ error: "No puedes revocar la sesión con la que estás conectado" }, 400, req);
  }
  const revoked = await revokeSession(targetId, sessionId, role);
  return revoked ? json({ ok: true, sessionId }, 200, req) : json({ error: "Session not found" }, 404, req);
}

async function handleSessionsRevokeAll(req, body) {
  const auth = await requireSession(req);
  if (auth.error) return auth.error;
  if (!(await hasAdminCapability(req))) return json({ error: "Insufficient permissions" }, 403, req);
  const targetId = String(body?.profileId || "").trim();
  if (!targetId) return json({ error: "Profile id required" }, 400, req);
  const role = targetId === ADMIN_PROFILE_ID ? "ADMIN" : "USER";
  if (role === "USER") {
    const target = await getProfile(targetId);
    if (!target || target.role !== "USER") return json({ error: "Profile not found" }, 404, req);
  }
  const currentSid = String(auth.session?.sid || "");
  const sameCurrentProfile = String(auth.session?.sub || ADMIN_PROFILE_ID) === targetId && String(auth.session?.role || "") === role;
  const revoked = await revokeAllProfileSessions(targetId, role, sameCurrentProfile ? currentSid : "");
  return json({ ok: true, revoked }, 200, req);
}

function decodeSessionCookieValue(cookie) {
  const value = String(cookie || "").split("=").slice(1).join("=").split(";")[0];
  const [encoded] = value.split(".");
  if (!encoded) throw new Error("Invalid session cookie");
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}

function sanitizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const serialized = JSON.stringify(snapshot);
  if (serialized.length > maxSnapshotBytes) return null;
  return snapshot;
}

async function migrateOne(item) {
  const p1 = String(item?.person1 || "").trim();
  const p2 = String(item?.person2 || "").trim();
  const pinSalt = String(item?.pinSalt || "").trim();
  const pinHash = String(item?.pinHash || "").trim();
  if (!p1 || !p2 || !pinSalt || !pinHash) return { ok: false, reason: "missing local PIN verifier", legacyId: String(item?.id || "") };
  if (!pinHash.startsWith("pbkdf2:") || !pinSalt) return { ok: false, reason: "invalid legacy verifier", legacyId: String(item?.id || "") };
  const snapshot = sanitizeSnapshot(item?.snapshot);
  const pairIsJM = isJuanjoMaria(p1, p2);
  let target = await findProfileByPair(p1, p2);
  const oldCloudKey = String(item?.cloudKey || "").trim();
  const suggestedId = String(item?.id || "").trim();
  if (!target) {
    const stateKey = oldCloudKey || (pairIsJM ? deriveLegacyV131StateKey(p1, p2, String(process.env.MARVEL_JUANJO_MARIA_PIN || "")) : createStateKey());
    target = makeProfile({
      id: pairIsJM ? "jm-user" : suggestedId || undefined,
      person1: p1,
      person2: p2,
      stateKey: stateKey || createStateKey(),
      verifier: legacyVerifier(pinSalt, pinHash),
      role: "USER",
      root: false,
      migratedFrom: "v1.14-local",
    });
    if (!target.id || target.id === ADMIN_PROFILE_ID) target.id = `user-${randomUUID()}`;
  } else {
    const nextStateKey = target.stateKey || oldCloudKey || (pairIsJM ? deriveLegacyV131StateKey(p1, p2, String(process.env.MARVEL_JUANJO_MARIA_PIN || "")) : createStateKey());
    target = {
      ...target,
      verifier: legacyVerifier(pinSalt, pinHash),
      stateKey: nextStateKey,
      updatedAt: new Date().toISOString(),
      migratedFrom: "v1.14-local",
    };
  }

  await profileStore.setJSON(`profile-${target.id}`, target);
  if (pairIsJM && target.id !== LEGACY_JM_ROOT_ID) {
    await profileStore.delete(`profile-${LEGACY_JM_ROOT_ID}`);
  }
  const profiles = await refreshProfileIndex();
  if (!profiles.some(p => p.id === target.id)) profiles.push(target);
  await saveProfileIndex(profiles);

  let stateAction = "kept";
  if (snapshot) {
    const existing = await stateStore.get(`account-${target.stateKey}`, { type: "json", consistency: "strong" });
    if (!existing) {
      await stateStore.setJSON(`account-${target.stateKey}`, snapshot);
      stateAction = "uploaded-local-snapshot";
    }
  }
  return {
    ok: true,
    legacyId: String(item?.id || ""),
    profileId: target.id,
    stateKey: target.stateKey,
    stateAction,
    name: target.name,
  };
}

async function handleMigrateLocal(req, body) {
  const auth = await requireSession(req);
  if (auth.error) return auth.error;
  if (!(await hasAdminCapability(req))) return json({ error: "Insufficient permissions" }, 403, req);
  if (!bodySizeOk(req)) return json({ error: "Migration payload too large" }, 413, req);
  const items = Array.isArray(body?.profiles) ? body.profiles : [];
  if (!items.length) return json({ ok: true, migrated: [], skipped: [] }, 200, req);
  const migrated = [];
  const skipped = [];
  for (const item of items.slice(0, 20)) {
    try {
      const result = await migrateOne(item);
      if (result.ok) migrated.push(result); else skipped.push(result);
    } catch (error) {
      skipped.push({ ok: false, legacyId: String(item?.id || ""), reason: "server error" });
      console.error("marvel-profile migrate", error);
    }
  }
  return json({ ok: true, migrated, skipped }, 200, req);
}

async function handleAdminElevate(req, body) {
  const auth = await requireSession(req);
  if (auth.error) return auth.error;
  const token = String(body?.token || "");
  let expected = "";
  try { expected = adminToken(); } catch { return json({ error: "Server admin secret is not configured" }, 503, req); }
  if (!token || !secretEqual(token, expected)) return json({ error: "Invalid administrator credential" }, 403, req);
  const response = json({ ok: true, elevated: true, expiresInSeconds: 15 * 60 }, 200, req);
  return setCookie(response, adminElevationCookie());
}

async function handleAdminStatus(req) {
  const auth = await requireSession(req);
  if (auth.error) return auth.error;
  const adminSession = auth.session.role === "ADMIN" && await hasAdminCapability(req);
  const elevated = !!readAdminElevation(req);
  return json({ ok: true, elevated: !!(adminSession || elevated), mode: adminSession ? "admin" : (elevated ? "elevated" : "user"), expiresAt: elevated ? Number(readAdminElevation(req)?.exp || 0) * 1000 : null }, 200, req);
}

async function handleMe(req) {
  const auth = await requireSession(req);
  if (auth.error) return auth.error;
  return json({ ok: true, profile: auth.publicProfile || profilePublic(auth.profile), stateKey: auth.profile?.stateKey || "", role: auth.session.role, remembered: !!auth.session.rm }, 200, req);
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return optionsResponse(req);
  try {
    if (req.method === "GET") {
      if (req.headers.get("x-marvel-profile-action") === "me") return await handleMe(req);
      return await listResponse(req);
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const action = String(body?.action || "");
      if (action === "admin-login") return await handleAdminLogin(req, body);
      if (action === "login") return await handleLogin(req, body);
      if (action === "create") return await handleCreateUser(req, body);
      if (action === "migrate-local") return await handleMigrateLocal(req, body);
      if (action === "logout") {
        const current = await requireSession(req).catch(() => ({ error: null, session: null }));
        if (!current.error && current.session?.sid) {
          const role = current.session.role === "ADMIN" ? "ADMIN" : "USER";
          const profileId = role === "ADMIN" ? ADMIN_PROFILE_ID : String(current.session.sub || "");
          await revokeSession(profileId, current.session.sid, role);
        }
        const response = json({ ok: true }, 200, req);
        setCookie(response, clearSessionCookie());
        response.headers.append("Set-Cookie", clearAdminElevationCookie());
        return response;
      }
      if (action === "admin-elevate") return await handleAdminElevate(req, body);
      if (action === "admin-status") return await handleAdminStatus(req);
      if (action === "sessions-list") return await handleSessionsList(req, body);
      if (action === "session-revoke") return await handleSessionRevoke(req, body);
      if (action === "sessions-revoke-all") return await handleSessionsRevokeAll(req, body);
      return json({ error: "Unsupported action" }, 400, req);
    }
    if (req.method === "PATCH") {
      const body = await req.json().catch(() => ({}));
      const action = String(body?.action || "");
      if (action === "rename") return await handleRename(req, body);
      if (action === "change-pin") return await handleChangePin(req, body);
      return json({ error: "Unsupported action" }, 400, req);
    }
    if (req.method === "DELETE") {
      const body = await req.json().catch(() => ({}));
      return await handleDelete(req, body);
    }
    return json({ error: "Method not allowed" }, 405, req);
  } catch (error) {
    console.error("marvel-profile", error);
    const status = String(error?.message || "").startsWith("Missing ") ? 503 : 500;
    return json({ error: status === 503 ? "Server security configuration incomplete" : "Server error" }, status, req);
  }
}

function setCookie(response, cookie) {
  response.headers.set("Set-Cookie", cookie);
  return response;
}
