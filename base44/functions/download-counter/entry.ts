import { createClientFromRequest } from "npm:@base44/sdk";

// Public download counter for the extension zip on the marketing site.
// GET  -> { count }        current number of recorded downloads
// POST -> { count }        increments the counter and returns the new value
// Anonymous visitors call this from get-extension.html, so it must allow
// CORS and must not require auth; writes go through the service role.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const COUNTER_KEY = "extension_downloads";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const base44 = createClientFromRequest(req);
    const counters = base44.asServiceRole.entities.Counter;
    const existing = (await counters.filter({ key: COUNTER_KEY }))[0];

    if (req.method === "POST") {
      const updated = existing
        ? await counters.update(existing.id, { count: (existing.count || 0) + 1 })
        : await counters.create({ key: COUNTER_KEY, count: 1 });
      return Response.json({ count: updated.count }, { headers: CORS_HEADERS });
    }

    return Response.json({ count: existing?.count || 0 }, { headers: CORS_HEADERS });
  } catch (error) {
    return Response.json(
      { error: error?.message || String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
});
