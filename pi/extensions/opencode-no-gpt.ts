import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type ModelConfig = {
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow?: number;
  maxTokens?: number;
  [key: string]: unknown;
};

type ModelsStore = {
  opencode?: { models?: ModelConfig[] };
};

type ModelsConfig = {
  providers?: {
    opencode?: {
      baseUrl?: string;
      api?: string;
      models?: ModelConfig[];
    };
  };
};

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function isGptModel(model: ModelConfig): boolean {
  // Match current IDs (gpt-*) and future namespaced IDs such as openai/gpt-*.
  const pattern = /(^|[/:\s])gpt(?:[-_.\s]|$)/i;
  return pattern.test(model.id) || pattern.test(model.name ?? "");
}

export default function blockOpenCodeGptModels(pi: ExtensionAPI) {
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const store = readJson<ModelsStore>(join(agentDir, "models-store.json"));
  const config = readJson<ModelsConfig>(join(agentDir, "models.json"));
  const openCodeConfig = config?.providers?.opencode;

  // Start with Pi's latest cached OpenCode catalog, then apply the user's custom
  // entries. Registering a provider with `models` replaces the provider's model
  // list, so remote catalog refreshes cannot reintroduce GPT models.
  const modelsById = new Map<string, ModelConfig>();
  for (const model of store?.opencode?.models ?? []) modelsById.set(model.id, model);
  for (const model of openCodeConfig?.models ?? []) modelsById.set(model.id, model);

  const allowedModels = [...modelsById.values()].filter((model) => !isGptModel(model));
  if (allowedModels.length === 0) {
    throw new Error("Cannot install the OpenCode GPT block: no non-GPT OpenCode models were found");
  }

  pi.registerProvider("opencode", {
    name: "OpenCode Zen (GPT blocked)",
    baseUrl: openCodeConfig?.baseUrl ?? "https://opencode.ai/zen/v1",
    api: (openCodeConfig?.api ?? "openai-completions") as any,
    models: allowedModels as any,
  });
}
