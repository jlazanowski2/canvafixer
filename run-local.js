#!/usr/bin/env node
/**
 * Local runner for the full CanvaFixer pipeline (Pass 1 + Pass 2).
 *
 * Usage: node run-local.js "email 5.html"
 *
 * Reads LLM config from web/api/local.settings.json automatically.
 * Pass 1 output: <input>.pass1.html
 * Pass 2 output: <input>.optimized.html
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('Usage: node run-local.js "email 5.html"');
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error(`File not found: ${inputFile}`);
  process.exit(1);
}

const base = inputFile.replace(/(\.\w+)$/, "");
const ext = path.extname(inputFile);
const pass1Output = `${base}.pass1${ext}`;
const pass2Output = `${base}.optimized${ext}`;

// --- Pass 1: mechanical optimization ---
console.log("\n========== PASS 1: Mechanical Optimization ==========\n");
execSync(`node optimize.js "${inputFile}" "${pass1Output}"`, { stdio: "inherit" });

if (!fs.existsSync(pass1Output)) {
  console.error("Pass 1 failed — no output file.");
  process.exit(1);
}

// --- Pass 2: LLM structural rewrite ---
console.log("\n========== PASS 2: LLM Structural Rewrite ==========\n");

// Load env from local.settings.json
const settingsPath = path.join(__dirname, "web", "api", "local.settings.json");
if (fs.existsSync(settingsPath)) {
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  if (settings.Values) {
    for (const [key, value] of Object.entries(settings.Values)) {
      if (value && !process.env[key]) {
        process.env[key] = value;
      }
    }
  }
  console.log(`Loaded config from ${settingsPath}`);
  console.log(`  Provider: ${process.env.LLM_PROVIDER}`);
  console.log(`  Model:    ${process.env.LLM_MODEL}`);
  if (process.env.ANTHROPIC_BASE_URL) {
    console.log(`  Base URL: ${process.env.ANTHROPIC_BASE_URL}`);
  }
} else {
  console.log("No local.settings.json found — using environment variables.");
}

const { restructure } = require("./web/api/lib/llm");

const pass1Html = fs.readFileSync(pass1Output, "utf-8");
const inputKB = (Buffer.byteLength(pass1Html, "utf-8") / 1024).toFixed(1);
console.log(`\nSending ${inputKB} KB to LLM...\n`);

const startTime = Date.now();

restructure(pass1Html)
  .then((result) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    fs.writeFileSync(pass2Output, result.html, "utf-8");

    const outputKB = (Buffer.byteLength(result.html, "utf-8") / 1024).toFixed(1);
    console.log(`\nPass 2 complete in ${elapsed}s`);
    console.log(`  Output: ${pass2Output} (${outputKB} KB)`);
    console.log(`  Tokens: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
    console.log("\nDone — both passes complete.");
  })
  .catch((err) => {
    console.error("\nPass 2 FAILED:", err.message);
    if (err.status) console.error(`  HTTP status: ${err.status}`);
    process.exit(1);
  });
