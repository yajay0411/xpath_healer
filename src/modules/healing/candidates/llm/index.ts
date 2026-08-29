import { anthropicProvider } from "./anthropic";
import { openAiCompatible } from "./openai-compatible";
import type { LocatorProvider } from "./types";

const REGISTRY: Record<string, LocatorProvider> = {
  anthropic: anthropicProvider,
  xai: openAiCompatible({
    name: "xai",
    baseUrl: "https://api.x.ai/v1",
    apiKeyEnv: "XAI_API_KEY",
    defaultModel: "grok-4",
  }),
  // Groq gates json_schema to openai/gpt-oss-* and qwen/qwen3.8-27b. Point HEAL_MODEL at
  // one of those; anything else 400s at response_format rather than returning a bad locator.
  groq: openAiCompatible({
    name: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    defaultModel: "openai/gpt-oss-120b",
  }),
  openai: openAiCompatible({
    name: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-4o",
  }),
  local: openAiCompatible({
    name: "local",
    baseUrl: process.env.LOCAL_LLM_URL ?? "http://localhost:11434/v1",
    apiKeyEnv: "LOCAL_LLM_KEY",
    defaultModel: "llama3.1",
  }),
};

/** Swapping vendors is one environment variable. The pipeline depends on the interface only. */
export function provider(): LocatorProvider {
  const name = process.env.LLM_PROVIDER ?? "anthropic";
  const found = REGISTRY[name];
  if (!found) {
    throw new Error(`Unknown LLM_PROVIDER "${name}". Known: ${Object.keys(REGISTRY).join(", ")}`);
  }
  return found;
}

export { REGISTRY };
export * from "./types";
