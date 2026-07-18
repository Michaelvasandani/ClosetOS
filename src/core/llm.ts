/**
 * Anthropic SDK wrapper — the only module that talks to the LLM (ADR-0002,
 * ADR-0003; issue 06). The rest of the core reaches the model through the
 * narrow `LlmClient` seam below, never the SDK directly, so `recommend.ts` can
 * be exercised against a stub with no network (issue 06 "Done when").
 *
 * "Code owns correctness, LLM owns judgment + prose" (ADR-0003): this module
 * owns none of the recommendation logic. It only turns a system prompt + user
 * prompt + JSON schema into one structured, machine-checkable JSON response.
 *
 * Model per tier (spec.md "Models"): the hot path (`outfit`) runs Sonnet; the
 * async-intelligence tier (evals, self-improvement) runs Opus and is deferred
 * to a later issue. Structured output (`output_config.format`) constrains the
 * reply to the caller's schema; adaptive thinking lets the model decide how
 * much to reason without a fixed budget. The API key comes from the standard
 * `ANTHROPIC_API_KEY` env var (resolved by the SDK when no key is passed).
 */

import Anthropic from "@anthropic-ai/sdk";

/** The Claude model per task tier (spec.md "Models"). */
export const MODELS = {
  /** Hot path (`outfit`) — fast + cheap enough for daily interactive use. */
  hotPath: "claude-sonnet-5",
  /** Async intelligence (evals, self-improvement PRs) — deferred past v1. */
  async: "claude-opus-4-8",
} as const;

/** One structured-output completion: a system prompt, a user prompt, and the JSON schema the reply must satisfy. */
export interface StructuredRequest {
  /** A model id — use `MODELS.hotPath` on the recommendation path. */
  model: string;
  /** The role/behaviour framing (stable across requests). */
  system: string;
  /** The request-specific user turn (candidates, occasion, signals). */
  prompt: string;
  /** JSON schema the response is constrained to (must be object-typed with `additionalProperties: false`). */
  schema: Record<string, unknown>;
}

/**
 * The narrow LLM seam the core reasons over. A single method so a test can
 * supply a no-network stub (issue 06). Returns the parsed JSON as `unknown` —
 * structured output guarantees the *shape*, but the caller still validates the
 * *content* (that every id is a real candidate), since the model owns judgment,
 * not correctness (ADR-0003).
 */
export interface LlmClient {
  structured(request: StructuredRequest): Promise<unknown>;
}

/**
 * Build the production `LlmClient` backed by the Anthropic TS SDK. Uses adaptive
 * thinking and structured output; a non-streaming call with a modest
 * `max_tokens` (the reply is three short picks, well under the HTTP-timeout
 * threshold). `apiKey` is optional — omit it to let the SDK read
 * `ANTHROPIC_API_KEY` from the environment.
 */
export function createLlmClient(apiKey?: string): LlmClient {
  const client = new Anthropic(apiKey ? { apiKey } : {});

  return {
    async structured({ model, system, prompt, schema }): Promise<unknown> {
      const response = await client.messages.create({
        model,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system,
        output_config: { format: { type: "json_schema", schema } },
        messages: [{ role: "user", content: prompt }],
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
      if (!text) {
        throw new Error("LLM returned no text content");
      }
      return JSON.parse(text) as unknown;
    },
  };
}
