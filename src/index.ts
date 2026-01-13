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

function stubProvider(subreddits: string[], keywords: string[], limit: number): SignalItem[] {
  const now = Math.floor(Date.now() / 1000);
  const seed = `${subreddits.join(",")} | ${keywords.join(",")}`;

  const base: Omit<SignalItem, "signal_type">[] = [
    {
      title: `I'm drowning in customer support — need a lightweight triage workflow (${seed})`,
      url: "https://example.com/reddit/mock/1",
      subreddit: subreddits[0] ?? "startups",
      score: 137,
      created_utc: now - 60 * 60 * 6,
      excerpt:
        "We're a 2-person SaaS and support is consuming the roadmap. I need a simple way to tag and prioritize without building a full system.",
    },
    {
      title: `Workaround: I pipe feedback into a spreadsheet + weekly clustering (${seed})`,
      url: "https://example.com/reddit/mock/2",
      subreddit: subreddits[1] ?? subreddits[0] ?? "Entrepreneur",
      score: 88,
      created_utc: now - 60 * 60 * 18,
      excerpt:
        "I copy/paste notable complaints into a sheet, then every Friday I group them into themes. It's ugly but it keeps me shipping.",
    },
    {
      title: `Request: tool that summarizes founder pain points by niche (${seed})`,
      url: "https://example.com/reddit/mock/3",
      subreddit: subreddits[2] ?? subreddits[0] ?? "SaaS",
      score: 54,
      created_utc: now - 60 * 60 * 30,
      excerpt:
        "Is there anything that reads the forums so I don't have to? I want the top recurring problems and what people tried.",
    },
  ];

  const items = base.map((x) => ({
    ...x,
    signal_type: classifySignal(`${x.title} ${x.excerpt}`),
  }));

  // Repeat deterministically if limit > base size (stub behavior)
  const out: SignalItem[] = [];
  for (let i = 0; i < limit; i++) out.push(items[i % items.length]);
  return out;
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
      const items = stubProvider(subreddits, keywords, limit);

      return json({ items, meta: { subreddits, keywords, limit, provider: "stub" } });
    }

    return json(
      {
        error: "Not Found",
        routes: {
          "GET /health": "liveness check",
          "POST /extract": "stubbed extraction (no Reddit auth yet)",
        },
      },
      404
    );
  },
} satisfies ExportedHandler<Env>;
