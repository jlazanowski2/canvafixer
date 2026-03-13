/**
 * LLM provider abstraction.
 * Supports Anthropic (Claude) and OpenAI-compatible APIs.
 *
 * Config via environment variables:
 *   LLM_PROVIDER: "anthropic" | "openai"
 *   LLM_MODEL: model ID (e.g., "claude-sonnet-4-6", "gpt-4o")
 *   ANTHROPIC_API_KEY: API key for Anthropic
 *   ANTHROPIC_BASE_URL: (optional) custom base URL (e.g., Azure AI Foundry)
 *   OPENAI_API_KEY: API key for OpenAI-compatible
 *   OPENAI_BASE_URL: (optional) custom base URL for OpenAI-compatible APIs
 */

const { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE } = require("./rules");

async function callAnthropic(html, model) {
  const Anthropic = require("@anthropic-ai/sdk");
  const config = { apiKey: process.env.ANTHROPIC_API_KEY };
  if (process.env.ANTHROPIC_BASE_URL) {
    config.baseURL = process.env.ANTHROPIC_BASE_URL;
  }
  const client = new Anthropic(config);

  const response = await client.messages.create({
    model: model || "claude-sonnet-4-6",
    max_tokens: 16384,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: USER_PROMPT_TEMPLATE + html },
    ],
  });

  // Extract text from response
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return {
    html: text.trim(),
    usage: {
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
    },
  };
}

async function callOpenAI(html, model) {
  const OpenAI = require("openai");
  const config = { apiKey: process.env.OPENAI_API_KEY };
  if (process.env.OPENAI_BASE_URL) {
    config.baseURL = process.env.OPENAI_BASE_URL;
  }
  const client = new OpenAI(config);

  const response = await client.chat.completions.create({
    model: model || "gpt-4o",
    max_tokens: 16384,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: USER_PROMPT_TEMPLATE + html },
    ],
  });

  const text = response.choices?.[0]?.message?.content || "";

  return {
    html: text.trim(),
    usage: {
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
    },
  };
}

/**
 * Call the configured LLM provider to restructure email HTML.
 * @param {string} html - The Pass 1 optimized HTML
 * @returns {Promise<{html: string, usage: {inputTokens: number, outputTokens: number}}>}
 */
async function restructure(html) {
  const provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
  const model = process.env.LLM_MODEL || undefined;

  switch (provider) {
    case "anthropic":
      return callAnthropic(html, model);
    case "openai":
      return callOpenAI(html, model);
    default:
      throw new Error(`Unknown LLM provider: ${provider}. Use "anthropic" or "openai".`);
  }
}

module.exports = { restructure };
