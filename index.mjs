/**
 * GMI Cloud (https://www.gmicloud.ai) provider plugin for OpenCode and
 * magpie. GMI serves open-weight and hosted models over an
 * OpenAI-compatible API at https://api.gmi-serving.com/v1.
 *
 * Provider id is "gmicloud" — models.dev lists it, so OpenCode and magpie
 * start from its entry and this plugin only needs to refresh the account's
 * own catalog and add whatever models.dev does not carry.
 *
 * The plugin loads its live model catalog from GET /v1/models per account.
 * GMI prices are per token; catalog.mjs converts them to per-million-USD.
 */

import {
  BASE,
  DEFAULT_OUTPUT,
  gmiModel,
  modelsFromCatalog,
} from "./catalog.mjs";

const PROVIDER = "gmicloud";
const NAME = "GMI Cloud";
// GMI's API is OpenAI-compatible chat completions.
const CHAT = "@ai-sdk/openai-compatible";

// models.dev carries GMI's current catalog (17 models at the time of
// writing). This list is only the fallback when models.dev is unreachable;
// the live catalog replaces it once an account is signed in. Each entry is
// { id, name, context, reasoning, image }.
const SNAPSHOT = [
  ["openai/gpt-5.5", "GPT-5.5", 1_050_000, true, true],
  ["MiniMaxAI/MiniMax-M3", "MiniMax M3", 1_000_000, false, false],
  ["MiniMaxAI/MiniMax-M2.7", "MiniMax M2.7", 200_000, false, false],
  ["zai-org/GLM-5.2-FP8", "GLM 5.2 FP8", 200_000, false, false],
  ["zai-org/GLM-5.1-FP8", "GLM 5.1 FP8", 200_000, false, false],
  ["zai-org/GLM-5-FP8", "GLM 5 FP8", 200_000, false, false],
  ["deepseek-ai/DeepSeek-V4-Pro", "DeepSeek V4 Pro", 1_000_000, true, false],
  ["deepseek-ai/DeepSeek-V4-Flash", "DeepSeek V4 Flash", 1_000_000, true, false],
  ["Qwen/Qwen3.8-Max", "Qwen3.8 Max", 1_000_000, true, false],
  ["Qwen/Qwen3.8-Flash", "Qwen3.8 Flash", 1_000_000, true, false],
  ["Qwen/Qwen3.7-Max", "Qwen3.7 Max", 1_000_000, true, false],
  ["anthropic/claude-opus-4.7", "Claude Opus 4.7", 1_000_000, true, true],
  ["anthropic/claude-opus-4.6", "Claude Opus 4.6", 200_000, true, true],
  ["anthropic/claude-opus-4.8", "Claude Opus 4.8", 1_000_000, true, true],
  ["anthropic/claude-sonnet-4.6", "Claude Sonnet 4.6", 200_000, false, true],
  ["moonshotai/Kimi-K2.6", "Kimi K2.6", 262_144, false, true],
  ["moonshotai/kimi-k2.7-code-highspeed", "Kimi K2.7 Code Highspeed", 262_144, false, true],
];

function modelFrom(row) {
  return {
    id: row[0],
    name: row[1],
    tool_call: true,
    reasoning: row[3],
    attachment: row[4],
    temperature: true,
    modalities: { input: row[4] ? ["text", "image"] : ["text"], output: ["text"] },
    limit: { context: row[2], output: DEFAULT_OUTPUT },
  };
}

// The canonical OpenCode model shape the models hook returns, with the
// account's catalog data merged over whatever the provider already had.
function runtimeModel(provider, m, base) {
  const image = base?.attachment ?? m.image;
  return {
    id: m.id,
    providerID: PROVIDER,
    name: m.name,
    api: {
      id: m.id,
      url: typeof provider.api === "string" ? provider.api : BASE,
      npm: provider.npm ?? CHAT,
    },
    status: "active",
    headers: {},
    options: {},
    cost: {
      input: m.cost.input,
      output: m.cost.output,
      cache: { read: m.cost.cacheRead, write: m.cost.cacheWrite },
    },
    limit: { context: m.context, output: base?.limit?.output ?? DEFAULT_OUTPUT },
    capabilities: {
      temperature: true,
      reasoning: m.reasoning,
      attachment: image,
      toolcall: true,
      input: { text: true, image, audio: false, video: false, pdf: false },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: "",
  };
}

/**
 * The plugin: one export, in OpenCode's v1 plugin shape. Add to magpie with
 * `magpie plugin add ./opencode-gmi-auth` (or from npm/git once published).
 */
export const GmiCloudAuthPlugin = async () => ({
  auth: {
    provider: PROVIDER,
    methods: [
      {
        type: "api",
        label: "GMI Cloud API key",
        placeholder: "gmi-…",
        // Validates the key by listing models; /v1/models answers 401 with
        // "Invalid API key" when it is refused.
        async authorize(inputs) {
          const key = String(inputs?.key ?? inputs?.apiKey ?? "").trim();
          if (!key) return { type: "failed", error: "No API key given" };
          const headers = { authorization: `Bearer ${key}` };
          const organization = String(inputs?.organization ?? "").trim();
          if (organization) headers["x-organization-id"] = organization;
          try {
            const res = await fetch(`${BASE}/models`, { headers });
            if (res.status === 401) {
              return { type: "failed", error: "GMI Cloud refused the API key (401)" };
            }
            if (!res.ok) {
              return { type: "failed", error: `GMI Cloud answered ${res.status}` };
            }
            return {
              type: "success",
              key,
              metadata: { organization: organization || undefined },
            };
          } catch (error) {
            return {
              type: "failed",
              error: `Could not reach GMI Cloud: ${error?.message ?? error}`,
            };
          }
        },
      },
    ],
    loader: async (getAuth) => {
      const auth = await getAuth();
      if (auth?.type !== "api" || !auth.key) return {};
      const headers = {};
      if (auth.metadata?.organization) {
        headers["x-organization-id"] = auth.metadata.organization;
      }
      return { baseURL: BASE, apiKey: auth.key, headers };
    },
  },

  config: async (config) => {
    config.provider ??= {};
    // models.dev usually declares gmicloud already; keep its (or the
    // user's plugins.json) values, and fill each model's gaps with our
    // defaults — models.dev may carry only id/name/reasoning.
    const was = config.provider[PROVIDER] ?? {};
    const defaults = Object.fromEntries(SNAPSHOT.map((row) => [row[0], modelFrom(row)]));
    const models = {};
    for (const [id, model] of Object.entries(was.models ?? {})) {
      models[id] =
        model && typeof model === "object" && !Array.isArray(model)
          ? { ...(defaults[id] ?? {}), ...model }
          : model;
    }
    for (const [id, model] of Object.entries(defaults)) {
      if (!(id in models)) models[id] = model;
    }
    config.provider[PROVIDER] = { name: NAME, npm: CHAT, api: BASE, ...was, models };
  },

  provider: {
    id: PROVIDER,
    async models(provider, { auth } = {}) {
      if (auth?.type !== "api" || !auth.key) return provider.models;
      const headers = { authorization: `Bearer ${auth.key}` };
      if (auth.metadata?.organization) {
        headers["x-organization-id"] = auth.metadata.organization;
      }
      try {
        const res = await fetch(`${BASE}/models`, { headers });
        if (!res.ok) return provider.models;
        const rows = modelsFromCatalog(await res.json());
        // A catalog that suddenly has no chat models at all is more likely
        // a bad read than a real one: keep the list magpie had.
        if (!rows.length) return provider.models;
        return Object.fromEntries(
          rows.map((m) => [m.id, runtimeModel(provider, m, provider.models[m.id])]),
        );
      } catch {
        return provider.models;
      }
    },
  },
});

// Only for tests; magpie treats every exported function as a plugin, so
// helpers must not be exported from the entry file.
export const _internal = { PROVIDER, gmiModel, modelsFromCatalog, runtimeModel };
