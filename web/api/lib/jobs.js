/**
 * In-memory job store for async LLM processing.
 * Jobs auto-expire after 10 minutes.
 */
const jobs = new Map();
const JOB_TTL_MS = 600000; // 10 minutes

// Cleanup expired jobs every 60 seconds
const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}, 60000);
cleanupTimer.unref(); // Don't prevent process idle/exit

module.exports = { jobs };
