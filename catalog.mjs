/**
 * Pure GMI Cloud catalog mapping helpers.
 * Kept free of plugin-runtime imports so unit tests can import this module
 * directly. GMI's `/v1/models` reports prices in USD per token; OpenCode and
 * magpie track costs in USD per million tokens.
 */

export const BASE = "https://api.gmi-serving.com/v1";
export const DEFAULT_CONTEXT = 128000;
export const DEFAULT_OUTPUT = 8192;

// Models served from GMI's catalog that are not chat models (image
// generation, embeddings, speech and friends) are filtered out so agents
// only see models they can actually chat with.
const NON_CHAT =
  /embed|tts|speech|whisper|asr|transcri|rerank|clip|ocr|flux|bria|veo|sora|image-gen|imagegen|video/i;

export function isChatModel(id, name = "") {
  return !NON_CHAT.test(`${id} ${name}`);
}

// Heuristics, tuned on GMI's catalog: reasoning and multimodal families.
export function looksReasoning(id, name = "") {
  const text = `${id} ${name}`.toLowerCase();
  return (
    /thinking|reason|\br1\b|opus|sonnet|fable/.test(text) ||
    /gpt-5(?!\s)/.test(text) ||
    /deepseek-v4-pro|kimi-k2\.(?:[5-9]|\d{2})|kimi-k3|grok|gemini-3|glm-5|qwen3\.(?:[5-9]|\d{2})|hy3|minimax-m3|mimo-v2\.5-pro/.test(
      text,
    )
  );
}

export function looksMultimodal(id, name = "") {
  const text = `${id} ${name}`.toLowerCase();
  return (
    /claude|gpt-4o|gpt-5|gemini|gemma-4|kimi-k2\.(?:[5-9]|\d{2})|kimi-k3|grok/.test(
      text,
    ) && !/coder|code-only|tts|embed|clip/.test(text)
  );
}

export function perMillion(value) {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // GMI reports USD per token.
  return Math.round(n * 1_000_000 * 10_000) / 10_000;
}

/**
 * Maps one catalog row (or undefined when it is not a chat model) to the
 * fields both the config hook and the models hook need.
 */
export function gmiModel(raw) {
  const id =
    typeof raw?.id === "string" && raw.id.trim() && raw.id.trim() !== "model"
      ? raw.id.trim()
      : typeof raw?.object === "string" && raw.object.trim() && raw.object.trim() !== "model"
        ? raw.object.trim()
        : undefined;
  if (!id) return undefined;
  const name = (typeof raw?.name === "string" && raw.name.trim()) || id;
  if (!isChatModel(id, name)) return undefined;
  const context =
    typeof raw?.context_length === "number" && raw.context_length > 0
      ? raw.context_length
      : DEFAULT_CONTEXT;
  const pricing = raw?.pricing ?? {};
  return {
    id,
    name,
    context,
    reasoning: looksReasoning(id, name),
    image: looksMultimodal(id, name),
    cost: {
      input: perMillion(pricing.prompt),
      output: perMillion(pricing.completion),
      cacheRead: perMillion(pricing.input_cache_read),
      cacheWrite: perMillion(pricing.input_cache_write),
    },
  };
}

/**
 * Rows from `GET /v1/models` (as `{ data: [...] }` or a bare array) mapped
 * to chat models, in catalog order.
 */
export function modelsFromCatalog(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : [];
  return rows.map(gmiModel).filter(Boolean);
}
