const crypto = require("crypto");

/**
 * POST /api/login
 * Body: { "password": "..." }
 * Returns: 200 with session token or 401.
 *
 * Simple password auth — compares against APP_PASSWORD env var.
 * Returns a signed token (HMAC of password + timestamp) for subsequent requests.
 */
module.exports = async function (context, req) {
  const { password } = req.body || {};
  const appPassword = process.env.APP_PASSWORD;

  if (!appPassword) {
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Server not configured: APP_PASSWORD not set" }),
    };
    return;
  }

  if (!password || password !== appPassword) {
    context.res = {
      status: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid password" }),
    };
    return;
  }

  // Generate a simple session token: HMAC(password, timestamp)
  // Valid for 24 hours
  const timestamp = Math.floor(Date.now() / 1000);
  const expiry = timestamp + 86400; // 24h
  const payload = `${expiry}`;
  const hmac = crypto
    .createHmac("sha256", appPassword)
    .update(payload)
    .digest("hex");
  const token = `${payload}.${hmac}`;

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, expiresIn: 86400 }),
  };
};
