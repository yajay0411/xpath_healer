import { z } from "zod";

import {
  ProposalSchema,
  renderUserTurn,
  SYSTEM_PROMPT,
  type LocatorProvider,
} from "./types";

/**
 * One adapter for every chat-completions-shaped API: xAI (Grok), OpenAI, and local runtimes
 * such as Ollama or vLLM. They differ only in base URL, key and model name.
 *
 * NOTE: verify the JSON-schema response_format field names against the vendor's current
 * documentation before trusting this in production. The shape below is the widely-implemented
 * OpenAI one; a vendor that diverges will fail closed at the safeParse below, which is the
 * correct failure mode — never a salvage attempt.
 */
export function openAiCompatible(config: {
  name: string;
  baseUrl: string;
  apiKeyEnv: string;
  defaultModel: string;
}): LocatorProvider {
  return {
    name: config.name,

    get model() {
      return process.env.HEAL_MODEL ?? config.defaultModel;
    },

    async propose(req) {
      const key = process.env[config.apiKeyEnv];
      if (!key) throw new Error(`${config.apiKeyEnv} is not set`);

      const started = Date.now();
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: renderUserTurn(req) },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "xpath_proposal",
              strict: true,
              schema: z.toJSONSchema(ProposalSchema),
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`${config.name} returned ${response.status}: ${await response.text()}`);
      }

      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error(`${config.name} returned no content`);

      // Schema-valid or nothing. Never regex an XPath out of prose.
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(content);
      } catch {
        throw new Error(`${config.name} returned non-JSON content`);
      }

      const parsed = ProposalSchema.safeParse(parsedJson);
      if (!parsed.success) {
        throw new Error(`${config.name} response did not satisfy ProposalSchema`);
      }

      const inputTokens = body.usage?.prompt_tokens ?? 0;
      const outputTokens = body.usage?.completion_tokens ?? 0;
      const priceIn = Number(process.env.HEAL_PRICE_INPUT ?? 0);
      const priceOut = Number(process.env.HEAL_PRICE_OUTPUT ?? 0);

      if (!priceIn && !priceOut) {
        // Say so loudly: an unpriced provider makes the daily USD cap unenforceable.
        // The daily run cap still binds.
        console.warn(
          `[${config.name}] HEAL_PRICE_INPUT/OUTPUT unset — cost recorded as 0, USD cap cannot bind`,
        );
      }

      return {
        proposal: parsed.data,
        usage: {
          inputTokens,
          outputTokens,
          cachedTokens: 0,
          costUsd: (inputTokens * priceIn + outputTokens * priceOut) / 1_000_000,
          latencyMs: Date.now() - started,
        },
      };
    },
  };
}
