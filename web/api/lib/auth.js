const crypto = require("crypto");

/**
 * Validate a session token (HMAC-signed expiry timestamp).
 * @param {string} token
 * @returns {{ valid: boolean, reason?: string }}
 */
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

    if (isNaN(expiry)) return { valid: false, reason: "invalid token format" };
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

module.exports = { validateToken };
