const crypto = require("crypto");
const { restructure } = require("../lib/llm");
const { validateToken } = require("../lib/auth");
const { jobs } = require("../lib/jobs");

// Simple in-memory rate limiter: max 10 requests per IP per hour
const rateLimitMap = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 3600000; // 1 hour
const MAX_INPUT_BYTES = 102400; // 100KB

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return true;
  }

  if (entry.count >= RATE_LIMIT) {
    return false;
  }

  entry.count++;
  return true;
}

/**
 * POST /api/restructure
 * Headers: X-CanvaFixer-Token: <token>
 * Body: { "html": "..." }
 * Returns: 202 with { "jobId": "...", "status": "processing" }
 *
 * The LLM call runs in the background. Poll /api/restructure-status?id=<jobId> for the result.
 */
module.exports = async function (context, req) {
  // Auth check
  const token = (req.headers?.["x-canvafixer-token"] || "").trim();

  const tokenResult = validateToken(token);
  if (!tokenResult.valid) {
    context.res = {
      status: 401,
      headers: { "Content-Type": "application/json" },
      body: { error: `Unauthorized — ${tokenResult.reason}` },
    };
    return;
  }

  // Rate limit
  const clientIp = req.headers?.["client-ip"]
    || req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim()
    || "unknown";

  if (!checkRateLimit(clientIp)) {
    context.res = {
      status: 429,
      headers: { "Content-Type": "application/json" },
      body: { error: "Rate limit exceeded — max 10 requests per hour" },
    };
    return;
  }

  // Validate input
  const { html } = req.body || {};

  if (!html || typeof html !== "string") {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: { error: "Missing 'html' in request body" },
    };
    return;
  }

  if (Buffer.byteLength(html, "utf-8") > MAX_INPUT_BYTES) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: { error: `Input too large — max ${MAX_INPUT_BYTES / 1024}KB` },
    };
    return;
  }

  // Generate job ID and start background processing
  const jobId = crypto.randomUUID();

  jobs.set(jobId, {
    status: "processing",
    createdAt: Date.now(),
  });

  // Fire-and-forget — the LLM call continues after this function returns.
  // The Node.js process stays alive for subsequent poll requests.
  const createdAt = Date.now();
  restructure(html)
    .then((result) => {
      jobs.set(jobId, {
        status: "complete",
        html: result.html,
        usage: result.usage,
        createdAt,
      });
    })
    .catch((err) => {
      jobs.set(jobId, {
        status: "error",
        error: "AI restructure failed: " + err.message,
        createdAt,
      });
    });

  // Return immediately with job ID
  context.res = {
    status: 202,
    headers: { "Content-Type": "application/json" },
    body: { jobId, status: "processing" },
  };
};
