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

function html(content: string): Response {
  return new Response(content, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Founder Signal</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      line-height: 1.6;
      padding: 2rem;
      max-width: 900px;
      margin: 0 auto;
    }
    h1 { color: #58a6ff; margin-bottom: 1.5rem; font-size: 1.8rem; }
    h2 { color: #8b949e; font-size: 1rem; margin-bottom: 0.5rem; font-weight: 500; }
    h3 { color: #c9d1d9; font-size: 1.1rem; margin-bottom: 0.75rem; }
    .form-group { margin-bottom: 1rem; }
    label { display: block; margin-bottom: 0.4rem; color: #8b949e; font-size: 0.9rem; }
    input {
      width: 100%;
      padding: 0.75rem;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #c9d1d9;
      font-size: 1rem;
    }
    input:focus { outline: none; border-color: #58a6ff; }
    button {
      background: #238636;
      color: #fff;
      border: none;
      padding: 0.75rem 1.5rem;
      border-radius: 6px;
      font-size: 1rem;
      cursor: pointer;
      margin-top: 0.5rem;
    }
    button:hover { background: #2ea043; }
    button:disabled { background: #21262d; color: #484f58; cursor: not-allowed; }
    .summary {
      background: linear-gradient(135deg, #1a2332 0%, #161b22 100%);
      border: 1px solid #58a6ff;
      border-radius: 8px;
      padding: 1.25rem;
      margin: 1.5rem 0;
    }
    .summary h2 { color: #58a6ff; margin-bottom: 0.75rem; }
    .summary p { color: #e6edf3; }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.25rem;
      margin-bottom: 1rem;
    }
    .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
    .rank { background: #238636; color: #fff; padding: 0.25rem 0.6rem; border-radius: 4px; font-size: 0.8rem; font-weight: 600; }
    .confidence { color: #8b949e; font-size: 0.85rem; }
    .field { margin-bottom: 0.75rem; }
    .field-label { color: #8b949e; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .field-value { color: #c9d1d9; }
    .evidence { background: #0d1117; padding: 0.5rem 0.75rem; border-left: 3px solid #30363d; margin: 0.25rem 0; font-size: 0.9rem; font-style: italic; }
    .risk { color: #f85149; }
    .collapsible { margin-top: 2rem; }
    .collapsible-toggle {
      background: #21262d;
      border: 1px solid #30363d;
      color: #8b949e;
      width: 100%;
      text-align: left;
      padding: 0.75rem 1rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .collapsible-toggle:hover { background: #30363d; }
    .collapsible-content { display: none; margin-top: 0.5rem; }
    .collapsible-content.open { display: block; }
    .signal-item {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 1rem;
      margin-bottom: 0.75rem;
    }
    .signal-title { color: #58a6ff; font-weight: 500; text-decoration: none; }
    .signal-title:hover { text-decoration: underline; }
    .signal-meta { color: #8b949e; font-size: 0.8rem; margin-top: 0.25rem; }
    .signal-type {
      display: inline-block;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 500;
      text-transform: uppercase;
    }
    .type-pain { background: #f8514933; color: #f85149; }
    .type-workaround { background: #a371f733; color: #a371f7; }
    .type-request { background: #58a6ff33; color: #58a6ff; }
    .type-launch { background: #23863633; color: #3fb950; }
    .type-unknown { background: #30363d; color: #8b949e; }
    .excerpt { color: #8b949e; font-size: 0.85rem; margin-top: 0.5rem; }
    .loading { text-align: center; padding: 2rem; color: #8b949e; }
    .spinner { display: inline-block; width: 20px; height: 20px; border: 2px solid #30363d; border-top-color: #58a6ff; border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 0.5rem; vertical-align: middle; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .error { background: #f8514922; border: 1px solid #f85149; color: #f85149; padding: 1rem; border-radius: 6px; margin: 1rem 0; }
    #results { margin-top: 2rem; }
    @media (max-width: 600px) {
      body { padding: 1rem; }
      h1 { font-size: 1.5rem; }
      .card-header { flex-direction: column; align-items: flex-start; gap: 0.5rem; }
    }
  </style>
</head>
<body>
  <h1>Founder Signal</h1>
  <form id="searchForm">
    <div class="form-group">
      <label for="keywords">Keywords (comma-separated)</label>
      <input type="text" id="keywords" placeholder="e.g. automation, saas, api, devtools" required>
    </div>
    <div class="form-group">
      <label for="limit">Limit</label>
      <input type="number" id="limit" value="10" min="1" max="100">
    </div>
    <button type="submit" id="submitBtn">Extract & Analyze</button>
  </form>
  <div id="results"></div>

  <script>
    const form = document.getElementById('searchForm');
    const results = document.getElementById('results');
    const submitBtn = document.getElementById('submitBtn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const keywords = document.getElementById('keywords').value.split(',').map(k => k.trim()).filter(Boolean);
      const limit = parseInt(document.getElementById('limit').value) || 10;

      if (keywords.length === 0) {
        results.innerHTML = '<div class="error">Please enter at least one keyword</div>';
        return;
      }

      submitBtn.disabled = true;
      results.innerHTML = '<div class="loading"><span class="spinner"></span>Extracting signals from Hacker News...</div>';

      try {
        // Step 1: Extract signals
        const extractRes = await fetch('/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subreddits: ['hackernews'], keywords, limit })
        });
        const extractData = await extractRes.json();

        if (!extractRes.ok || extractData.error) {
          throw new Error(extractData.error || 'Failed to extract signals');
        }

        if (!extractData.items || extractData.items.length === 0) {
          results.innerHTML = '<div class="error">No signals found for these keywords. Try different terms.</div>';
          submitBtn.disabled = false;
          return;
        }

        results.innerHTML = '<div class="loading"><span class="spinner"></span>Analyzing ' + extractData.items.length + ' signals with Claude...</div>';

        // Step 2: Synthesize with Claude
        const synthRes = await fetch('/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: extractData.items })
        });
        const synthData = await synthRes.json();

        if (!synthRes.ok || synthData.error) {
          throw new Error(synthData.error || 'Failed to synthesize signals');
        }

        // Render results
        renderResults(synthData.synthesis, extractData.items);
      } catch (err) {
        results.innerHTML = '<div class="error">Error: ' + err.message + '</div>';
      } finally {
        submitBtn.disabled = false;
      }
    });

    function renderResults(synthesis, rawItems) {
      let html = '';

      // Executive Summary
      if (synthesis.executive_summary) {
        html += '<div class="summary"><h2>Executive Summary</h2><p>' + escapeHtml(synthesis.executive_summary) + '</p></div>';
      }

      // Opportunity Cards
      if (synthesis.opportunities && synthesis.opportunities.length > 0) {
        html += '<h2 style="margin: 1.5rem 0 1rem;">Top Opportunities</h2>';
        synthesis.opportunities.forEach(opp => {
          html += '<div class="card">';
          html += '<div class="card-header"><span class="rank">#' + opp.rank + '</span><span class="confidence">Confidence: ' + (opp.confidence * 100).toFixed(0) + '%</span></div>';
          html += '<h3>' + escapeHtml(opp.problem) + '</h3>';

          html += '<div class="field"><div class="field-label">Market Size</div><div class="field-value">' + escapeHtml(opp.market_size) + '</div></div>';
          html += '<div class="field"><div class="field-label">Competition</div><div class="field-value">' + escapeHtml(opp.competition) + '</div></div>';
          html += '<div class="field"><div class="field-label">Recommended Action</div><div class="field-value">' + escapeHtml(opp.recommended_action) + '</div></div>';

          if (opp.evidence && opp.evidence.length > 0) {
            html += '<div class="field"><div class="field-label">Evidence</div>';
            opp.evidence.forEach(ev => {
              html += '<div class="evidence">"' + escapeHtml(ev) + '"</div>';
            });
            html += '</div>';
          }

          if (opp.risk_factors) {
            html += '<div class="field"><div class="field-label">Risk Factors</div><div class="field-value risk">' + escapeHtml(opp.risk_factors) + '</div></div>';
          }

          html += '</div>';
        });
      }

      // Collapsible Raw Signals
      html += '<div class="collapsible">';
      html += '<button class="collapsible-toggle" onclick="toggleRaw()">▶ Raw Signals (' + rawItems.length + ' items)</button>';
      html += '<div class="collapsible-content" id="rawSignals">';
      rawItems.forEach(item => {
        html += '<div class="signal-item">';
        html += '<a href="' + escapeHtml(item.url) + '" target="_blank" class="signal-title">' + escapeHtml(item.title) + '</a>';
        html += '<div class="signal-meta">';
        html += '<span class="signal-type type-' + item.signal_type + '">' + item.signal_type + '</span> ';
        html += '· Score: ' + item.score + ' · ' + formatDate(item.created_utc);
        html += '</div>';
        if (item.excerpt) {
          html += '<div class="excerpt">' + escapeHtml(item.excerpt) + '</div>';
        }
        html += '</div>';
      });
      html += '</div></div>';

      results.innerHTML = html;
    }

    function toggleRaw() {
      const content = document.getElementById('rawSignals');
      const btn = document.querySelector('.collapsible-toggle');
      content.classList.toggle('open');
      btn.textContent = content.classList.contains('open')
        ? '▼ Raw Signals (' + document.querySelectorAll('.signal-item').length + ' items)'
        : '▶ Raw Signals (' + document.querySelectorAll('.signal-item').length + ' items)';
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function formatDate(ts) {
      if (!ts) return '';
      return new Date(ts * 1000).toLocaleDateString();
    }
  </script>
</body>
</html>`;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // CORS preflight
    if (request.method === "OPTIONS") return json({ ok: true });

    const url = new URL(request.url);
    const path = url.pathname;

    // GET / - Serve UI
    if (request.method === "GET" && path === "/") {
      return html(UI_HTML);
    }

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

      const systemPrompt = `You are a startup validation consultant. Transform HN signals into consultant-grade opportunity briefs worth $5K each. Be specific about market size, competition, and risks. No fluff - decisions only.`;

      const userPrompt = `Analyze these signal items from Hacker News and produce exactly 3 startup opportunities, ranked by confidence:

${JSON.stringify(body.items, null, 2)}

Respond with valid JSON only, in this exact format:
{
  "executive_summary": "One paragraph: top 3 opportunities and why they matter now",
  "opportunities": [
    {
      "rank": 1,
      "problem": "Clear one-liner problem statement",
      "market_size": "Specific estimate with reasoning",
      "competition": "Who else is solving this, gaps in their approach",
      "recommended_action": "Exact first step to validate this week",
      "evidence": ["Direct quote 1", "Direct quote 2", "Direct quote 3"],
      "risk_factors": "What could kill this opportunity",
      "confidence": 0.0-1.0
    }
  ]
}

Requirements:
- Return exactly 3 opportunities
- Rank them by confidence (highest first)
- Evidence must be direct quotes from the input items
- Be specific about market size numbers and competition names
- Recommended action must be actionable this week`;

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
        let parsed: { opportunities: unknown[]; executive_summary: string };
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
            opportunities: parsed.opportunities,
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
