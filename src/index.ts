/**
 * founder-signal-worker
 * Week 1: stubbed extraction surface (no Reddit auth yet)
 */

type SignalType = "pain" | "workaround" | "request" | "unknown";

type ExtractRequest = {
  subreddits: string[];
  keywords: string[];
  limit?: number;
};

type SignalItem = {
  title: string;
  url: string;
  subreddit: string;
  score: number;
  created_utc: number;
  signal_type: SignalType;
  excerpt: string;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // permissive for local testing; tighten later if needed
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

function badRequest(message: string, details?: unknown): Response {
  return json({ error: message, details }, 400);
}

function normalizeLimit(limit: unknown): number {
  const n = typeof limit === "number" ? limit : Number(limit);
  if (!Number.isFinite(n) || n <= 0) return 25;
  return Math.min(Math.floor(n), 100);
}

function classifySignal(text: string): SignalType {
  const t = text.toLowerCase();
  if (/(pain|stuck|frustrat|hate|broken|can't|cannot|problem|issue)/.test(t)) return "pain";
  if (/(workaround|hack|duct tape|script|automate|i built|we built|solution)/.test(t)) return "workaround";
  if (/(looking for|anyone know|recommend|need a tool|wish there was|does anyone)/.test(t)) return "request";
  return "unknown";
}

type HNItem = {
  id: number;
  title?: string;
  url?: string;
  score?: number;
  time?: number;
  descendants?: number;
  type?: string;
};

type ProviderResult = {
  items: SignalItem[];
  error?: string;
};

async function hackerNewsProvider(keywords: string[], limit: number): Promise<ProviderResult> {
  const HN_API = "https://hacker-news.firebaseio.com/v0";

  try {
    // Fetch top story IDs
    const topStoriesRes = await fetch(`${HN_API}/topstories.json`);
    if (!topStoriesRes.ok) {
      return { items: [], error: `Failed to fetch top stories: ${topStoriesRes.status}` };
    }
    const storyIds: number[] = await topStoriesRes.json();

    // Fetch item details in parallel (limit to first 100 to avoid excessive requests)
    const fetchLimit = Math.min(storyIds.length, 100);
    const itemPromises = storyIds.slice(0, fetchLimit).map(async (id): Promise<HNItem | null> => {
      try {
        const res = await fetch(`${HN_API}/item/${id}.json`);
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    });

    const items = await Promise.all(itemPromises);

    // Filter by keywords (case-insensitive match in title)
    const keywordsLower = keywords.map((k) => k.toLowerCase());
    const filtered = items.filter((item): item is HNItem => {
      if (!item || !item.title) return false;
      const titleLower = item.title.toLowerCase();
      return keywordsLower.some((kw) => titleLower.includes(kw));
    });

    // Map to SignalItem format and respect limit
    const signalItems: SignalItem[] = filtered.slice(0, limit).map((item) => ({
      title: item.title!,
      url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
      subreddit: "hackernews",
      score: item.score ?? 0,
      created_utc: item.time ?? 0,
      excerpt: `${item.descendants ?? 0} comments`,
      signal_type: classifySignal(item.title!),
    }));

    return { items: signalItems };
  } catch (e) {
    return { items: [], error: `HN API error: ${(e as Error).message}` };
  }
}

async function readJson<T>(request: Request): Promise<T> {
  const ct = request.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) {
    throw new Error("Content-Type must be application/json");
  }
  return (await request.json()) as T;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // CORS preflight
    if (request.method === "OPTIONS") return json({ ok: true });

    const url = new URL(request.url);
    const path = url.pathname;

    // GET /health
    if (request.method === "GET" && path === "/health") {
      return json({ ok: true, name: "founder-signal-worker", ts: Date.now() });
    }

    // POST /extract
    if (request.method === "POST" && path === "/extract") {
      let body: ExtractRequest;
      try {
        body = await readJson<ExtractRequest>(request);
      } catch (e) {
        return badRequest((e as Error).message);
      }

      if (!body || !Array.isArray(body.subreddits) || !Array.isArray(body.keywords)) {
        return badRequest("Invalid body. Expected { subreddits: string[], keywords: string[], limit?: number }");
      }

      const subreddits = body.subreddits.map((s) => String(s).trim()).filter(Boolean);
      const keywords = body.keywords.map((k) => String(k).trim()).filter(Boolean);
      if (subreddits.length === 0) return badRequest("subreddits must contain at least one non-empty string");
      if (keywords.length === 0) return badRequest("keywords must contain at least one non-empty string");

      const limit = normalizeLimit(body.limit);
      const result = await hackerNewsProvider(keywords, limit);

      const meta: Record<string, unknown> = { subreddits, keywords, limit, provider: "hackernews" };
      if (result.error) {
        meta.error = result.error;
      }

      return json({ items: result.items, meta });
    }

    return json(
      {
        error: "Not Found",
        routes: {
          "GET /health": "liveness check",
          "POST /extract": "extract signals from Hacker News",
        },
      },
      404
    );
  },
} satisfies ExportedHandler<Env>;
