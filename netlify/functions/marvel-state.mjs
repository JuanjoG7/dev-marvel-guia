import {
  getProfile,
  json,
  optionsResponse,
  requireSession,
  safeId,
  stateStore,
} from "../lib/profile-core.mjs";

const headers = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Pragma": "no-cache",
};

export default async function handler(req) {
  if (req.method === "OPTIONS") return optionsResponse(req);
  try {
    const auth = await requireSession(req, "USER");
    if (auth.error) return auth.error;
    const profile = auth.profile;
    const stateKey = safeId(profile.stateKey);
    if (!stateKey) return json({ error: "Profile cloud identity missing" }, 500, req);
    const key = `account-${stateKey}`;

    if (req.method === "HEAD") {
      return new Response(null, { status: 204, headers: { ...headers } });
    }

    if (req.method === "GET") {
      // Conservative read: prefer strong consistency, but retry once without
      // the explicit consistency flag if the first storage read fails. This
      // keeps a transient Blob read problem from surfacing as a generic 500.
      const readState = async (cloudKey) => {
        try {
          return await stateStore.get(cloudKey, { type: "json", consistency: "strong" });
        } catch (firstError) {
          console.warn("marvel-state GET strong read failed", firstError);
          return await stateStore.get(cloudKey, { type: "json" });
        }
      };
      let state = await readState(key);
      if (!state && Array.isArray(profile.legacyStateKeys)) {
        for (const legacyKey of profile.legacyStateKeys) {
          const legacy = safeId(legacyKey);
          if (!legacy || legacy === stateKey) continue;
          state = await readState(`account-${legacy}`);
          if (state) {
            try { await stateStore.setJSON(key, state); } catch (error) { console.warn("marvel-state legacy promotion failed", error); }
            break;
          }
        }
      }
      return json(state ? { state } : null, 200, req);
    }

    if (req.method === "PUT") {
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== "object" || !body.state || typeof body.state !== "object") {
        return json({ error: "Invalid body" }, 400, req);
      }

      // V1.19.8: Netlify Blobs can transiently reject a write. The previous
      // implementation retried GET but a PUT failed immediately, which made a
      // temporary storage hiccup surface as a visible 503 even though the
      // client already had a persistent local copy and a retry queue.
      const delays = [0, 700, 1800, 3500];
      let lastError = null;
      for (let attempt = 0; attempt < delays.length; attempt++) {
        if (delays[attempt]) await new Promise(resolve => setTimeout(resolve, delays[attempt]));
        try {
          await stateStore.setJSON(key, body.state);
          return json({ ok: true, state: body.state, attempts: attempt + 1 }, 200, req);
        } catch (error) {
          lastError = error;
          console.warn(`marvel-state PUT failed (attempt ${attempt + 1}/${delays.length})`, error);
        }
      }
      const message = String(lastError?.message || "").slice(0, 220);
      console.error("marvel-state PUT exhausted retries", message);
      return json({
        error: "Cloud storage temporarily unavailable",
        retryable: true,
        operation: "write",
      }, 503, req);
    }

    return json({ error: "Method not allowed" }, 405, req);
  } catch (error) {
    console.error("marvel-state", error);
    return json({ error: "Cloud storage temporarily unavailable", retryable: true }, 503, req);
  }
}
