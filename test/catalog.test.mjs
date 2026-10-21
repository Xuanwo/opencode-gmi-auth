import assert from "node:assert/strict";
import { test } from "node:test";

import { gmiModel, modelsFromCatalog, perMillion } from "../catalog.mjs";
import { GmiCloudAuthPlugin, _internal } from "../index.mjs";

const { PROVIDER } = _internal;

test("perMillion converts GMI per-token USD to per-million USD", () => {
  assert.equal(perMillion("0.000001"), 1);
  assert.equal(perMillion("0.000003"), 3);
  assert.equal(perMillion(0.0000003), 0.3);
  assert.equal(perMillion(undefined), 0);
  assert.equal(perMillion("0"), 0);
});

test("gmiModel maps id, context and pricing", () => {
  const m = gmiModel({
    id: "deepseek-ai/DeepSeek-V4-Pro",
    name: "DeepSeek V4 Pro",
    context_length: 1_048_576,
    pricing: {
      prompt: "0.00000132",
      completion: "0.00000396",
      input_cache_read: "0.000000044",
      input_cache_write: "0",
    },
  });
  assert.equal(m.id, "deepseek-ai/DeepSeek-V4-Pro");
  assert.equal(m.context, 1_048_576);
  assert.equal(m.reasoning, true);
  assert.equal(m.image, false);
  assert.deepEqual(m.cost, {
    input: 1.32,
    output: 3.96,
    cacheRead: 0.044,
    cacheWrite: 0,
  });
});

test("gmiModel falls back to object and filters non-chat models", () => {
  assert.equal(
    gmiModel({ object: "Qwen/Qwen3.8-Max", context_length: 262_144 }).id,
    "Qwen/Qwen3.8-Max",
  );
  assert.equal(gmiModel({ id: "model", object: "model" }), undefined);
  assert.equal(gmiModel({ id: "mixed-ai/flux-kontext-pro" }), undefined);
  assert.equal(gmiModel({ id: "openai/text-embedding-3-large" }), undefined);
});

test("modelsFromCatalog accepts data list and bare array", () => {
  const row = { id: "zai-org/GLM-5.2-FP8", context_length: 200_000 };
  assert.equal(modelsFromCatalog({ object: "list", data: [row] }).length, 1);
  assert.equal(modelsFromCatalog([row]).length, 1);
  assert.equal(modelsFromCatalog({}).length, 0);
});

test("plugin declares gmicloud with defaults when models.dev is absent", async () => {
  const plugin = await GmiCloudAuthPlugin();
  const config = {};
  await plugin.config(config);
  const provider = config.provider[PROVIDER];
  assert.equal(provider.name, "GMI Cloud");
  assert.equal(provider.npm, "@ai-sdk/openai-compatible");
  assert.equal(provider.api, "https://api.gmi-serving.com/v1");
  assert.ok(provider.models["deepseek-ai/DeepSeek-V4-Pro"]);
  assert.equal(provider.models["deepseek-ai/DeepSeek-V4-Pro"].tool_call, true);
});

test("plugin config keeps existing values and fills model gaps", async () => {
  const plugin = await GmiCloudAuthPlugin();
  const config = {
    provider: {
      [PROVIDER]: {
        name: "kept",
        models: {
          "deepseek-ai/DeepSeek-V4-Pro": { name: "User override" },
          m: {},
        },
      },
    },
  };
  await plugin.config(config);
  assert.equal(config.provider[PROVIDER].name, "kept");
  assert.equal(
    config.provider[PROVIDER].models["deepseek-ai/DeepSeek-V4-Pro"].name,
    "User override",
  );
  assert.equal(
    config.provider[PROVIDER].models["deepseek-ai/DeepSeek-V4-Pro"].tool_call,
    true,
  );
  assert.deepEqual(config.provider[PROVIDER].models.m, {});
  assert.ok(config.provider[PROVIDER].models["Qwen/Qwen3.8-Max"]);
});

test("auth method is an api key and loader carries it", async () => {
  const plugin = await GmiCloudAuthPlugin();
  assert.equal(plugin.auth.provider, PROVIDER);
  assert.equal(plugin.auth.methods[0].type, "api");
  assert.equal(plugin.auth.methods[0].authorize, undefined);
  const loader = await plugin.auth.loader(async () => ({ type: "api", key: "gmi-secret" }));
  assert.deepEqual(loader, {
    baseURL: "https://api.gmi-serving.com/v1",
    apiKey: "gmi-secret",
    headers: {},
  });
});

test("models hook leaves the list alone without a sign-in", async () => {
  const plugin = await GmiCloudAuthPlugin();
  const models = { m: { name: "M" } };
  assert.deepEqual(await plugin.provider.models({ models }), models);
  assert.deepEqual(
    await plugin.provider.models({ models }, { auth: { type: "api", key: "" } }),
    models,
  );
});
