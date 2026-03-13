const crypto = require("crypto");
const { restructure } = require("../lib/llm");

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

function validateToken(token) {
  try {
    const appPassword = process.env.APP_PASSWORD;
    if (!appPassword || !token) return false;

    const parts = token.split(".");
    if (parts.length !== 2) return false;

    const [payload, hmac] = parts;
    const expiry = parseInt(payload, 10);

    // Check expiry
    if (isNaN(expiry) || Math.floor(Date.now() / 1000) > expiry) return false;

    // Verify HMAC
    const expected = crypto
      .createHmac("sha256", appPassword)
      .update(payload)
      .digest("hex");

    const hmacBuf = Buffer.from(hmac, "hex");
    const expectedBuf = Buffer.from(expected, "hex");

    if (hmacBuf.length !== expectedBuf.length) return false;

    return crypto.timingSafeEqual(hmacBuf, expectedBuf);
  } catch {
    return false;
  }
}

/**
 * POST /api/restructure
 * Headers: Authorization: Bearer <token>
 * Body: { "html": "..." }
 * Returns: { "html": "...", "usage": { inputTokens, outputTokens } }
 */
module.exports = async function (context, req) {
  // Auth check
  const authHeader = req.headers?.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!validateToken(token)) {
    context.res = {
      status: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Unauthorized — invalid or expired token" }),
    };
    return;
  }

  // Rate limit
  const clientIp = req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.headers?.["client-ip"]
    || "unknown";

  if (!checkRateLimit(clientIp)) {
    context.res = {
      status: 429,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Rate limit exceeded — max 10 requests per hour" }),
    };
    return;
  }

  // Validate input
  const { html } = req.body || {};

  if (!html || typeof html !== "string") {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing 'html' in request body" }),
    };
    return;
  }

  if (Buffer.byteLength(html, "utf-8") > MAX_INPUT_BYTES) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: `Input too large — max ${MAX_INPUT_BYTES / 1024}KB` }),
    };
    return;
  }

  // Call LLM
  try {
    const result = await restructure(html);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        html: result.html,
        usage: result.usage,
      }),
    };
  } catch (err) {
    context.log.error("LLM restructure failed:", err.message);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "AI restructure failed: " + err.message }),
    };
  }
};
