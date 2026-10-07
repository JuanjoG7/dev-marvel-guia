import { createHash, createHmac, randomBytes, randomUUID, scryptSync, pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

export const PROFILE_STORE_NAME = "marvel-marathon-profiles-v1";
export const STATE_STORE_NAME = "marvel-marathon-accounts-v90";
export const ADMIN_PROFILE_ID = "marvel-admin-root";
export const ADMIN_PERSON_1 = "administrador1";
export const ADMIN_PERSON_2 = "administrador2";
export const ADMIN_NAME = `${ADMIN_PERSON_1} × ${ADMIN_PERSON_2}`;
export const SESSION_COOKIE = "marvel_session";
export const ADMIN_ELEVATION_COOKIE = "marvel_admin_elevation";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
export const ADMIN_ELEVATION_MAX_AGE = 60 * 15;
export const SESSION_STORE_NAME = "marvel-marathon-sessions-v1";
export const BACKUP_STORE_NAME = "marvel-marathon-backups-v1";
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
export const LOGIN_MAX_FAILS = 5;
export const LOGIN_LOCK_MS = 10 * 60 * 1000;
export const LEGACY_PBKDF2_ITERATIONS = 120000;
export const LEGACY_PROFILE_VERSION = "v131-stable-profile";
export const JM_BOOTSTRAP_MARKER = "bootstrap-jm-v1";
export const LEGACY_JM_ROOT_ID = "juanjo-maria-root";

export const profileStore = getStore({ name: PROFILE_STORE_NAME, consistency: "strong" });
export const stateStore = getStore({ name: STATE_STORE_NAME, consistency: "strong" });
export const sessionStore = getStore({ name: SESSION_STORE_NAME, consistency: "strong" });
export const backupStore = getStore({ name: BACKUP_STORE_NAME, consistency: "strong" });

const jsonHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Pragma": "no-cache",
  "Content-Type": "application/json; charset=utf-8",
};

export function responseHeaders(req) {
  const origin = req.headers.get("origin");
  const allowed = String(process.env.URL || "").replace(/\/$/, "");
  const headers = { ...jsonHeaders, "Vary": "Origin" };
  if (origin && allowed && origin === allowed) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}

export function json(body, status = 200, req) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(req) });
}

export function optionsResponse(req) {
  return new Response(null, {
    status: 204,
    headers: {
      ...responseHeaders(req),
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Accept,X-Marvel-Profile-Action",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Max-Age": "600",
    },
  });
}

function requiredSecret(name) {
  const value = String(process.env[name] || "");
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function profilePepper() {
  return requiredSecret("MARVEL_PROFILE_PEPPER");
}

export function sessionSecret() {
  return requiredSecret("MARVEL_SESSION_SECRET");
}

export function adminToken() {
  return requiredSecret("MARVEL_ROOT_ADMIN_TOKEN");
}

export function secretEqual(a, b) {
  try {
    const left = Buffer.from(String(a || ""), "utf8");
    const right = Buffer.from(String(b || ""), "utf8");
    return left.length === right.length && timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function b64url(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(value) {
  const raw = String(value || "").trim();
  try {
    return Buffer.from(raw, "base64url");
  } catch {
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(normalized + "=".repeat((4 - (normalized.length % 4)) % 4), "base64");
  }
}

export function randomToken(bytes = 32) {
  return b64url(randomBytes(bytes));
}

export function safeId(value) {
  return String(value || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 120);
}

export function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function validPin(pin) {
  return /^\d{4,6}$/.test(String(pin || ""));
}

export function profilePublic(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    name: profile.name,
    person1: profile.person1,
    person2: profile.person2,
    role: profile.role || "USER",
    root: profile.role === "ADMIN" || profile.root === true,
    createdAt: profile.createdAt || null,
    updatedAt: profile.updatedAt || null,
    lastAccessAt: profile.lastAccessAt || null,
    stateVersion: profile.stateVersion || 1,
  };
}

export function adminPublic() {
  return {
    id: ADMIN_PROFILE_ID,
    name: ADMIN_NAME,
    person1: ADMIN_PERSON_1,
    person2: ADMIN_PERSON_2,
    role: "ADMIN",
    root: true,
    virtual: true,
  };
}

export function adminCookie(remember = false, sid = randomToken(18)) {
  const payload = {
    sub: ADMIN_PROFILE_ID,
    role: "ADMIN",
    tv: adminTokenFingerprint(),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (remember ? SESSION_MAX_AGE : 60 * 60 * 8),
    sid: String(sid || randomToken(18)),
    rm: !!remember,
  };
  return makeCookie(payload, remember);
}

export function adminTokenFingerprint() {
  return b64url(createHash("sha256").update(adminToken(), "utf8").digest()).slice(0, 22);
}

export function adminElevationCookie() {
  const payload = {
    sub: ADMIN_PROFILE_ID,
    role: "ADMIN_ELEVATED",
    tv: adminTokenFingerprint(),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ADMIN_ELEVATION_MAX_AGE,
    sid: randomToken(18),
  };
  return makeCookie(payload, true, ADMIN_ELEVATION_COOKIE, ADMIN_ELEVATION_MAX_AGE);
}

export function clearAdminElevationCookie() {
  return `${ADMIN_ELEVATION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function readAdminElevation(req) {
  const token = getCookie(req, ADMIN_ELEVATION_COOKIE);
  const [encoded, sig] = String(token || "").split(".");
  if (!encoded || !sig) return null;
  try {
    const expected = createHmac("sha256", sessionSecret()).update(encoded).digest();
    const actual = fromB64url(sig);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const payload = JSON.parse(fromB64url(encoded).toString("utf8"));
    if (payload?.sub !== ADMIN_PROFILE_ID || payload?.role !== "ADMIN_ELEVATED") return null;
    if (Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;
    if (!secretEqual(String(payload.tv || ""), adminTokenFingerprint())) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function hasAdminCapability(req) {
  const session = readSession(req);
  if (session?.role === "ADMIN") {
    try {
      return secretEqual(String(session.tv || ""), adminTokenFingerprint());
    } catch {
      return false;
    }
  }
  return !!readAdminElevation(req);
}

export function userCookie(profile, remember = false, sid = randomToken(18)) {
  const payload = {
    sub: profile.id,
    role: "USER",
    sv: Number(profile.sessionVersion || 1),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (remember ? SESSION_MAX_AGE : 60 * 60 * 8),
    sid: String(sid || randomToken(18)),
    rm: !!remember,
  };
  return makeCookie(payload, remember);
}

function makeCookie(payload, remember, cookieName = SESSION_COOKIE, rememberMaxAge = SESSION_MAX_AGE) {
  const encoded = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(createHmac("sha256", sessionSecret()).update(encoded).digest());
  const value = `${encoded}.${sig}`;
  const maxAge = remember ? `; Max-Age=${rememberMaxAge}` : "";
  const sameSite = cookieName === ADMIN_ELEVATION_COOKIE ? "Strict" : "Lax";
  return `${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=${sameSite}${maxAge}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function sessionRolePrefix(role) {
  return role === "ADMIN" ? "admin" : "user";
}

export function sessionRecordKey(profileId, sid, role = "USER") {
  const cleanProfile = safeId(profileId);
  const cleanSid = safeId(sid);
  return cleanProfile && cleanSid ? `session-${sessionRolePrefix(role)}-${cleanProfile}-${cleanSid}` : "";
}

export function sessionDeviceType(req) {
  const ua = String(req?.headers?.get?.("user-agent") || "").toLowerCase();
  if (!ua) return "Desconocido";
  if (/ipad|tablet|android(?!.*mobile)/i.test(ua)) return "Tablet";
  if (/mobi|iphone|ipod|android/i.test(ua)) return "Móvil";
  if (/windows|macintosh|mac os x|linux|cros|x11/i.test(ua)) return "Escritorio";
  return "Desconocido";
}

function sessionPublic(record, currentSid = "") {
  if (!record) return null;
  return {
    id: String(record.id || ""),
    profileId: String(record.profileId || ""),
    role: record.role === "ADMIN" ? "ADMIN" : "USER",
    createdAt: record.createdAt || null,
    lastSeenAt: record.lastSeenAt || record.createdAt || null,
    expiresAt: record.expiresAt || null,
    remember: !!record.remember,
    deviceType: record.deviceType || "Desconocido",
    current: !!currentSid && String(record.id) === String(currentSid),
  };
}

export async function ensureSessionRecord(req, session) {
  const role = session?.role === "ADMIN" ? "ADMIN" : "USER";
  const profileId = role === "ADMIN" ? ADMIN_PROFILE_ID : safeId(session?.sub);
  const sid = safeId(session?.sid);
  if (!profileId || !sid) return null;
  const key = sessionRecordKey(profileId, sid, role);
  if (!key) return null;
  const existing = await sessionStore.get(key, { type: "json", consistency: "strong" });
  const nowMs = Date.now();
  const expiresAt = Number(session?.exp || 0) * 1000;
  if (existing?.revokedAt) return null;
  if (!existing) {
    const createdAt = Number(session?.iat || 0) * 1000 || nowMs;
    const record = {
      id: sid,
      profileId,
      role,
      createdAt: new Date(createdAt).toISOString(),
      lastSeenAt: new Date(nowMs).toISOString(),
      expiresAt: expiresAt || nowMs,
      remember: !!session?.rm,
      deviceType: sessionDeviceType(req),
      sessionVersion: role === "USER" ? Number(session?.sv || 1) : null,
      revokedAt: null,
    };
    await sessionStore.setJSON(key, record);
    return record;
  }
  if (Number(existing.expiresAt || 0) <= nowMs) return null;
  if (nowMs - new Date(existing.lastSeenAt || existing.createdAt || 0).getTime() >= SESSION_TOUCH_INTERVAL_MS) {
    const next = { ...existing, lastSeenAt: new Date(nowMs).toISOString() };
    await sessionStore.setJSON(key, next);
    return next;
  }
  return existing;
}

export async function listProfileSessions(profileId, role = "USER", currentSid = "") {
  const clean = safeId(profileId);
  if (!clean) return [];
  const prefix = `session-${sessionRolePrefix(role)}-${clean}-`;
  const { blobs = [] } = await sessionStore.list({ prefix });
  const nowMs = Date.now();
  const out = [];
  for (const entry of blobs) {
    const record = await sessionStore.get(entry.key, { type: "json", consistency: "strong" });
    if (!record || record.revokedAt || Number(record.expiresAt || 0) <= nowMs) continue;
    out.push(sessionPublic(record, currentSid));
  }
  return out.sort((a, b) => Number(new Date(b.lastSeenAt || 0)) - Number(new Date(a.lastSeenAt || 0)));
}

export async function revokeSession(profileId, sid, role = "USER") {
  const clean = safeId(profileId);
  const cleanSid = safeId(sid);
  const key = sessionRecordKey(clean, cleanSid, role);
  if (!key) return false;
  const record = await sessionStore.get(key, { type: "json", consistency: "strong" });
  if (!record || record.revokedAt) return false;
  await sessionStore.setJSON(key, { ...record, revokedAt: new Date().toISOString() });
  return true;
}

export async function revokeAllProfileSessions(profileId, role = "USER", exceptSid = "") {
  const clean = safeId(profileId);
  if (!clean) return 0;
  const prefix = `session-${sessionRolePrefix(role)}-${clean}-`;
  const { blobs = [] } = await sessionStore.list({ prefix });
  let count = 0;
  for (const entry of blobs) {
    const record = await sessionStore.get(entry.key, { type: "json", consistency: "strong" });
    if (!record || record.revokedAt || String(record.id || "") === String(exceptSid || "")) continue;
    await sessionStore.setJSON(entry.key, { ...record, revokedAt: new Date().toISOString() });
    count++;
  }
  return count;
}

function getCookie(req, name) {
  const raw = String(req.headers.get("cookie") || "");
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

export function verifySessionToken(token) {
  const [encoded, sig] = String(token || "").split(".");
  if (!encoded || !sig) return null;
  try {
    const expected = createHmac("sha256", sessionSecret()).update(encoded).digest();
    const actual = fromB64url(sig);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const payload = JSON.parse(fromB64url(encoded).toString("utf8"));
    if (!payload?.sub || !payload?.role || Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readSession(req) {
  return verifySessionToken(getCookie(req, SESSION_COOKIE));
}

export async function requireSession(req, expectedRole = null) {
  const session = readSession(req);
  if (!session) return { error: json({ error: "Authentication required" }, 401, req) };
  if (expectedRole && session.role !== expectedRole) return { error: json({ error: "Insufficient permissions" }, 403, req) };
  if (session.role === "ADMIN") {
    try {
      if (!secretEqual(String(session.tv || ""), adminTokenFingerprint())) {
        return { error: json({ error: "Administrator session expired" }, 401, req) };
      }
    } catch {
      return { error: json({ error: "Server admin secret is not configured" }, 503, req) };
    }
    if (!(await ensureSessionRecord(req, session))) return { error: json({ error: "Session expired or revoked" }, 401, req) };
    return { session, profile: adminPublic(), publicProfile: adminPublic() };
  }
  const id = safeId(session.sub);
  let profile = await profileStore.get(`profile-${id}`, { type: "json", consistency: "strong" });
  if (!profile || profile.role !== "USER") return { error: json({ error: "Profile not found" }, 401, req) };

  // V1.18.2: heal the fixed Juanjo × María profile if an older migration left
  // the server-side stateKey missing. The fixed profile is special because its
  // state identity can be deterministically recovered from the protected
  // MARVEL_JUANJO_MARIA_PIN without asking the user for the PIN again.
  // This preserves the legacy V1.13/V1.15 cloud namespace instead of creating
  // a new random state key and accidentally hiding the existing progress.
  if (!profile.stateKey && String(profile.id || "") === "jm-user") {
    try {
      const pin = String(process.env.MARVEL_JUANJO_MARIA_PIN || "").trim();
      if (validPin(pin)) {
        const recoveredStateKey = Array.isArray(profile.legacyStateKeys)
          ? profile.legacyStateKeys.map(safeId).find(Boolean)
          : "";
        const stateKey = recoveredStateKey || deriveLegacyV131StateKey("Juanjo", "María", pin);
        if (stateKey) {
          profile = { ...profile, stateKey, updatedAt: new Date().toISOString() };
          await profileStore.setJSON(`profile-${id}`, profile);
        }
      }
    } catch (error) {
      console.warn("profile-core: no se pudo reparar stateKey de jm-user", error);
    }
  }

  if (Number(profile.sessionVersion || 1) !== Number(session.sv || 1)) return { error: json({ error: "Session expired" }, 401, req) };
  if (!(await ensureSessionRecord(req, session))) return { error: json({ error: "Session expired or revoked" }, 401, req) };
  return { session, profile, publicProfile: profilePublic(profile) };
}

export function createStateKey() {
  return randomToken(32);
}

export function deriveLegacyV131StateKey(person1, person2, pin) {
  const material = `maraton-marvel:${LEGACY_PROFILE_VERSION}|${normalizeName(person1)}|${normalizeName(person2)}|${String(pin ?? "")}`;
  return b64url(createHash("sha256").update(material, "utf8").digest());
}

export function hashPin(pin) {
  const salt = randomBytes(16);
  const derived = scryptSync(`${String(pin)}\0${profilePepper()}`, salt, 32, {
    N: 32768,
    r: 8,
    p: 2,
    maxmem: 64 * 1024 * 1024,
  });
  return {
    alg: "scrypt-v1",
    salt: b64url(salt),
    hash: b64url(derived),
  };
}

export function verifyScrypt(pin, verifier) {
  if (!verifier || verifier.alg !== "scrypt-v1") return false;
  try {
    const got = scryptSync(`${String(pin)}\0${profilePepper()}`, fromB64url(verifier.salt), 32, {
      N: 32768,
      r: 8,
      p: 2,
      maxmem: 64 * 1024 * 1024,
    });
    const expected = fromB64url(verifier.hash);
    return got.length === expected.length && timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}

export function verifyLegacyPin(pin, verifier) {
  if (!verifier || verifier.alg !== "legacy-pbkdf2-v1" || !verifier.salt || !verifier.hash) return false;
  try {
    const derived = pbkdf2Sync(Buffer.from(String(pin), "utf8"), fromB64url(verifier.salt), LEGACY_PBKDF2_ITERATIONS, 32, "sha256");
    const expected = verifier.hash.startsWith("pbkdf2:") ? fromB64url(verifier.hash.slice(7)) : fromB64url(verifier.hash);
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function legacyVerifier(pinSalt, pinHash) {
  if (!pinSalt || !pinHash) return null;
  return { alg: "legacy-pbkdf2-v1", salt: String(pinSalt), hash: String(pinHash) };
}

export function makeProfile({ id = randomUUID(), person1, person2, stateKey, verifier, role = "USER", root = false, sessionVersion = 1, migratedFrom = null }) {
  const now = new Date().toISOString();
  return {
    id: safeId(id) || randomUUID(),
    name: `${String(person1).trim()} × ${String(person2).trim()}`,
    person1: String(person1).trim(),
    person2: String(person2).trim(),
    role,
    root,
    stateKey: String(stateKey || createStateKey()),
    verifier,
    sessionVersion,
    failedCount: 0,
    lockUntil: 0,
    createdAt: now,
    updatedAt: now,
    stateVersion: 1,
    migratedFrom,
  };
}

export async function getProfile(id) {
  const clean = safeId(id);
  if (!clean) return null;
  return profileStore.get(`profile-${clean}`, { type: "json", consistency: "strong" });
}

export async function getProfileIndex() {
  const data = await profileStore.get("index", { type: "json", consistency: "strong" });
  return Array.isArray(data?.profiles) ? data.profiles : [];
}

export async function saveProfileIndex(profiles) {
  const summaries = profiles.map(profilePublic).filter(Boolean);
  await profileStore.setJSON("index", { version: 1, profiles: summaries, updatedAt: new Date().toISOString() });
}

export async function refreshProfileIndex() {
  const profiles = [];
  const index = await getProfileIndex();
  for (const item of index) {
    const p = await getProfile(item.id);
    if (p?.role === "USER") profiles.push(p);
  }
  return profiles;
}

export function normalizePair(person1, person2) {
  return `${normalizeName(person1)}\u0000${normalizeName(person2)}`;
}

export async function findProfileByPair(person1, person2) {
  const target = normalizePair(person1, person2);
  const profiles = await refreshProfileIndex();
  return profiles.find(p => normalizePair(p.person1, p.person2) === target) || null;
}

export async function deleteProfileAndState(profile) {
  if (!profile || profile.role !== "USER") return;
  const keys = new Set([profile.stateKey, ...(Array.isArray(profile.legacyStateKeys) ? profile.legacyStateKeys : [])].filter(Boolean));
  for (const stateKey of keys) {
    await stateStore.delete(`account-${safeId(stateKey)}`);
  }
  const cleanProfile = safeId(profile.id);
  if (cleanProfile) {
    const { blobs = [] } = await backupStore.list({ prefix: `backup-${cleanProfile}-` });
    for (const entry of blobs) {
      try { await backupStore.delete(entry.key); } catch (error) { console.warn("profile backup cleanup", entry?.key, error); }
    }
  }
  await profileStore.delete(`profile-${cleanProfile}`);
  const remaining = (await refreshProfileIndex()).filter(p => p.id !== profile.id);
  await saveProfileIndex(remaining);
}

export function loginLockRemaining(profile) {
  return Math.max(0, Number(profile?.lockUntil || 0) - Date.now());
}

export async function registerFailedLogin(profile) {
  const nextCount = Number(profile.failedCount || 0) + 1;
  const next = { ...profile, failedCount: nextCount, lockUntil: nextCount >= LOGIN_MAX_FAILS ? Date.now() + LOGIN_LOCK_MS : 0, updatedAt: new Date().toISOString() };
  await profileStore.setJSON(`profile-${safeId(profile.id)}`, next);
  return next;
}

export async function clearFailedLogins(profile) {
  if (!Number(profile.failedCount || 0) && !Number(profile.lockUntil || 0)) return profile;
  const next = { ...profile, failedCount: 0, lockUntil: 0, updatedAt: new Date().toISOString() };
  await profileStore.setJSON(`profile-${safeId(profile.id)}`, next);
  return next;
}

export async function upgradeLegacyVerifier(profile, pin) {
  const next = { ...profile, verifier: hashPin(pin), failedCount: 0, lockUntil: 0, updatedAt: new Date().toISOString() };
  await profileStore.setJSON(`profile-${safeId(profile.id)}`, next);
  return next;
}

export function setCookie(response, cookie) {
  response.headers.set("Set-Cookie", cookie);
  return response;
}

export function bodySizeOk(req, maxBytes = 5_500_000) {
  const contentLength = Number(req.headers.get("content-length") || 0);
  return !contentLength || contentLength <= maxBytes;
}
