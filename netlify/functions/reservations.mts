import { getStore } from "@netlify/blobs";
import type { Context, Config } from "@netlify/functions";

// Shared, public reservation state for the wishlist gifts.
// GET  /api/reservations?clientId=...        -> { [giftId]: { reserved: true, mine: bool } }
// POST /api/reservations  { id, clientId, action: "reserve" | "release" }

export default async (req: Request, context: Context) => {
  // Strong consistency: without it, a reservation just written can be
  // invisible to a read that follows immediately (e.g. reserve -> refresh).
  const store = getStore({ name: "reservations", consistency: "strong" });

  if (req.method === "GET") {
    const url = new URL(req.url);
    const clientId = url.searchParams.get("clientId") || "";
    const { blobs } = await store.list();
    const result: Record<string, { reserved: boolean; mine: boolean }> = {};

    await Promise.all(
      blobs.map(async (b) => {
        const data = await store.get(b.key, { type: "json" });
        if (data && typeof data === "object" && "reservedBy" in data) {
          result[b.key] = {
            reserved: true,
            mine: (data as any).reservedBy === clientId,
          };
        }
      })
    );

    return new Response(JSON.stringify(result), {
      headers: { "content-type": "application/json" },
    });
  }

  if (req.method === "POST") {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "bad_request" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const { id, clientId, action } = body || {};
    if (!id || !clientId || (action !== "reserve" && action !== "release")) {
      return new Response(JSON.stringify({ error: "bad_request" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const existing = (await store.get(id, { type: "json" })) as
      | { reservedBy: string; reservedAt: string }
      | null;

    if (action === "reserve") {
      if (existing && existing.reservedBy !== clientId) {
        return new Response(JSON.stringify({ error: "conflict" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        });
      }
      await store.setJSON(id, {
        reservedBy: clientId,
        reservedAt: new Date().toISOString(),
      });
      return new Response(JSON.stringify({ ok: true, reserved: true }), {
        headers: { "content-type": "application/json" },
      });
    }

    // action === "release"
    if (existing && existing.reservedBy === clientId) {
      await store.delete(id);
    }
    return new Response(JSON.stringify({ ok: true, reserved: false }), {
      headers: { "content-type": "application/json" },
    });
  }

  return new Response("Method Not Allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/reservations",
};
