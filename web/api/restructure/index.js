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
    if (!appPassword) return { valid: false, reason: "APP_PASSWORD not configured" };
    if (!token) return { valid: false, reason: "no token provided" };

    const dotIndex = token.indexOf(".");
    if (dotIndex === -1) return { valid: false, reason: "bad token format" };

    const payload = token.substring(0, dotIndex);
    const hmac = token.substring(dotIndex + 1);
    const expiry = parseInt(payload, 10);

    if (isNaN(expiry)) return { valid: false, reason: `invalid expiry — payload: "${payload}", token starts: "${token.substring(0, 30)}"` };
    if (Math.floor(Date.now() / 1000) > expiry) return { valid: false, reason: "token expired" };

    const expected = crypto
      .createHmac("sha256", appPassword)
      .update(payload)
      .digest("hex");

    const hmacBuf = Buffer.from(hmac, "hex");
    const expectedBuf = Buffer.from(expected, "hex");

    if (hmacBuf.length !== expectedBuf.length) return { valid: false, reason: "HMAC length mismatch" };

    if (!crypto.timingSafeEqual(hmacBuf, expectedBuf)) return { valid: false, reason: "HMAC mismatch" };

    return { valid: true };
  } catch (e) {
    return { valid: false, reason: `validation error: ${e.message}` };
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
  const authHeader = req.headers?.authorization || req.headers?.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

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
  const clientIp = req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.headers?.["client-ip"]
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

  // Call LLM
  try {
    const result = await restructure(html);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        html: result.html,
        usage: result.usage,
      },
    };
  } catch (err) {
    context.log.error("LLM restructure failed:", err.message);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: { error: "AI restructure failed: " + err.message },
    };
  }
};
