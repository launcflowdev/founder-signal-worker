/**
 * founder-signal-worker
 * Week 1: stubbed extraction surface (no Reddit auth yet)
 */

type SignalType = "pain" | "workaround" | "request" | "launch" | "unknown";

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
  // HN-specific prefixes take priority
  if (t.startsWith("show hn")) return "launch";
  if (t.startsWith("ask hn")) return "request";
  // Keyword-based detection
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
  kids?: number[];
};

type HNComment = {
  id: number;
  text?: string;
  deleted?: boolean;
  dead?: boolean;
};

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type ProviderResult = {
  items: SignalItem[];
  error?: string;
};

async function fetchTopComments(
  hnApi: string,
  kids: number[] | undefined,
  maxComments = 3
): Promise<string> {
  if (!kids || kids.length === 0) {
    return "";
  }

  const commentIds = kids.slice(0, maxComments);
  const commentPromises = commentIds.map(async (id): Promise<string | null> => {
    try {
      const res = await fetch(`${hnApi}/item/${id}.json`);
      if (!res.ok) return null;
      const comment: HNComment = await res.json();
      // Handle deleted/dead/missing comments
      if (!comment || comment.deleted || comment.dead || !comment.text) {
        return null;
      }
      return stripHtmlTags(comment.text);
    } catch {
      return null;
    }
  });

  const comments = await Promise.all(commentPromises);
  const validComments = comments.filter((c): c is string => c !== null && c.length > 0);

  if (validComments.length === 0) {
    return "";
  }

  // Join comments and limit to 200 chars
  const joined = validComments.join(" | ");
  return joined.length > 200 ? joined.slice(0, 197) + "..." : joined;
}

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
    // Fetch comments in parallel for all filtered items
    const limitedItems = filtered.slice(0, limit);
    const signalItemPromises = limitedItems.map(async (item): Promise<SignalItem> => {
      let excerpt = `${item.descendants ?? 0} comments`;

      // Fetch top comments if available
      if (item.descendants && item.descendants > 0 && item.kids && item.kids.length > 0) {
        const commentsExcerpt = await fetchTopComments(HN_API, item.kids, 3);
        if (commentsExcerpt) {
          excerpt = commentsExcerpt;
        }
      }

      return {
        title: item.title!,
        url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
        subreddit: "hackernews",
        score: item.score ?? 0,
        created_utc: item.time ?? 0,
        excerpt,
        signal_type: classifySignal(item.title!),
      };
    });

    const signalItems = await Promise.all(signalItemPromises);

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

    // POST /synthesize
    if (request.method === "POST" && path === "/synthesize") {
      let body: { items: SignalItem[] };
      try {
        body = await readJson<{ items: SignalItem[] }>(request);
      } catch (e) {
        return badRequest((e as Error).message);
      }

      if (!body || !Array.isArray(body.items)) {
        return badRequest("Invalid body. Expected { items: SignalItem[] }");
      }

      if (body.items.length === 0) {
        return badRequest("items array must not be empty");
      }

      if (!env.CLAUDE_API_KEY) {
        return json({ error: "CLAUDE_API_KEY not configured" }, 500);
      }

      const systemPrompt = `You are a Founder Signal Analyst. Transform HN posts into actionable founder intelligence. Speak founder language (problems, not features). Filter for actionable insights.`;

      const userPrompt = `Analyze these signal items from Hacker News and provide founder intelligence:

${JSON.stringify(body.items, null, 2)}

Identify:
- Top 3 patterns/problems identified
- Common workarounds being used
- Opportunities worth pursuing

For each pattern, provide:
- problem: Clear problem statement
- context: Background and evidence
- actionable_insight: What a founder should do
- confidence: 0.0-1.0 score
- evidence: Array of source titles that support this

Also provide an executive_summary (2-3 sentences) of the overall findings.

Respond with valid JSON only, in this exact format:
{
  "patterns": [
    {
      "problem": "string",
      "context": "string",
      "actionable_insight": "string",
      "confidence": 0.0-1.0,
      "evidence": ["source titles"]
    }
  ],
  "executive_summary": "string"
}`;

      try {
        const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.CLAUDE_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 2048,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
          }),
        });

        if (!claudeRes.ok) {
          const errText = await claudeRes.text();
          return json(
            { error: "Claude API error", status: claudeRes.status, details: errText },
            502
          );
        }

        const claudeData = (await claudeRes.json()) as {
          content: Array<{ type: string; text?: string }>;
        };

        const textBlock = claudeData.content.find((b) => b.type === "text");
        if (!textBlock || !textBlock.text) {
          return json({ error: "No text response from Claude" }, 502);
        }

        // Parse Claude's JSON response (strip markdown fences if present)
        let parsed: { patterns: unknown[]; executive_summary: string };
        try {
          let jsonText = textBlock.text.trim();
          // Remove leading markdown code fence (```json or ```)
          if (jsonText.startsWith("```")) {
            const firstNewline = jsonText.indexOf("\n");
            if (firstNewline !== -1) {
              jsonText = jsonText.slice(firstNewline + 1);
            }
          }
          // Remove trailing markdown code fence
          if (jsonText.endsWith("```")) {
            jsonText = jsonText.slice(0, -3);
          }
          jsonText = jsonText.trim();
          parsed = JSON.parse(jsonText);
        } catch {
          return json(
            { error: "Failed to parse Claude response as JSON", raw: textBlock.text },
            502
          );
        }

        return json({
          synthesis: {
            generated_at: new Date().toISOString(),
            item_count: body.items.length,
            patterns: parsed.patterns,
            executive_summary: parsed.executive_summary,
          },
        });
      } catch (e) {
        return json({ error: "Claude API request failed", details: (e as Error).message }, 502);
      }
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
          "POST /synthesize": "synthesize patterns from extracted signals",
        },
      },
      404
    );
  },
} satisfies ExportedHandler<Env>;
