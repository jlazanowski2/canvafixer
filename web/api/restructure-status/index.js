const { validateToken } = require("../lib/auth");
const { jobs } = require("../lib/jobs");

/**
 * GET /api/restructure-status?id=<jobId>
 * Headers: X-CanvaFixer-Token: <token>
 *
 * Returns:
 *   202 { "status": "processing" }           — still working
 *   200 { "status": "complete", "html": "...", "usage": {...} }  — done
 *   500 { "status": "error", "error": "..." } — failed
 *   404 { "error": "Job not found" }          — expired or invalid
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

  const jobId = req.query?.id;
  if (!jobId) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: { error: "Missing job ID" },
    };
    return;
  }

  const job = jobs.get(jobId);
  if (!job) {
    context.res = {
      status: 404,
      headers: { "Content-Type": "application/json" },
      body: { error: "Job not found — it may have expired" },
    };
    return;
  }

  if (job.status === "processing") {
    context.res = {
      status: 202,
      headers: { "Content-Type": "application/json" },
      body: { status: "processing" },
    };
    return;
  }

  if (job.status === "error") {
    jobs.delete(jobId);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: { status: "error", error: job.error },
    };
    return;
  }

  // Complete — return result and clean up
  const result = { status: "complete", html: job.html, usage: job.usage };
  jobs.delete(jobId);
  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: result,
  };
};
