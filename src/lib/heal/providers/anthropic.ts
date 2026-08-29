import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import {
  ProposalSchema,
  renderUserTurn,
  SYSTEM_PROMPT,
  type LocatorProvider,
} from "./types";

/** USD per 1M tokens. */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

let client: Anthropic | undefined;

export const anthropicProvider: LocatorProvider = {
  name: "anthropic",
  get model() {
    return process.env.HEAL_MODEL ?? "claude-opus-5";
  },

  async propose(req) {
    client ??= new Anthropic();
    const started = Date.now();
    const model = this.model;

    const response = await client.messages.parse({
      model,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { format: zodOutputFormat(ProposalSchema), effort: "high" },
      // Frozen prefix, so it caches across every run. Volatile content lives in `messages`.
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: renderUserTurn(req) }],
    });

    const proposal = response.parsed_output;
    // A schema failure is no_candidate, never a salvage job. Regexing an XPath out of prose
    // is exactly how an unvalidated string reaches a source file.
    if (!proposal) throw new Error("model response did not satisfy ProposalSchema");

    const price = PRICING[model] ?? { input: 0, output: 0 };
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    return {
      proposal,
      usage: {
        inputTokens,
        outputTokens,
        cachedTokens: response.usage.cache_read_input_tokens ?? 0,
        costUsd: (inputTokens * price.input + outputTokens * price.output) / 1_000_000,
        latencyMs: Date.now() - started,
      },
    };
  },
};
