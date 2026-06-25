// Unified model client over Anthropic and OpenAI-compatible providers (OpenAI, DeepSeek).
//
// One small surface so arms can swap models freely: debug on cheap models, run finals on
// capable ones. Returns normalized text + token usage so cost.ts can price every call the
// same way regardless of provider.
//
// The OpenAI-compatible path is loaded lazily (`await import("openai")`) so the Anthropic-only
// scaffold compiles and runs before the `openai` dependency is installed.

import Anthropic from "@anthropic-ai/sdk";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

export interface ModelResponse {
  text: string;
  usage: Usage;
}

export interface ModelSpec {
  /** Stable key used in configs and reports. */
  key: string;
  provider: "anthropic" | "openai-compat";
  /** Exact API model id. Verify capable-model ids before final runs. */
  apiModel: string;
  /** USD per 1M tokens. Approximate — edit to match current pricing before reporting. */
  pricePerMInput: number;
  pricePerMOutput: number;
  /** Base URL for openai-compat providers. */
  baseUrl?: string;
  /** Env var holding the API key. */
  apiKeyEnv: string;
  /** Capable = final-run model; cheap = development/debug model. */
  tier: "capable" | "cheap";
}

// NOTE: prices are approximate and must be confirmed before any reported number.
// Capable model ids in particular should be verified — `claude-haiku-4-5-20251001` is known
// good (used by the mocked benchmark); the Sonnet id below is a placeholder to confirm.
export const MODELS: Record<string, ModelSpec> = {
  "claude-sonnet": {
    key: "claude-sonnet",
    provider: "anthropic",
    apiModel: "claude-sonnet-4-5", // TODO: confirm exact API id before final runs
    pricePerMInput: 3,
    pricePerMOutput: 15,
    apiKeyEnv: "ANTHROPIC_API_KEY",
    tier: "capable",
  },
  "claude-haiku": {
    key: "claude-haiku",
    provider: "anthropic",
    apiModel: "claude-haiku-4-5-20251001",
    pricePerMInput: 0.8,
    pricePerMOutput: 4,
    apiKeyEnv: "ANTHROPIC_API_KEY",
    tier: "cheap",
  },
  "deepseek-chat": {
    key: "deepseek-chat",
    provider: "openai-compat",
    apiModel: "deepseek-chat",
    pricePerMInput: 0.27,
    pricePerMOutput: 1.1,
    baseUrl: "https://api.deepseek.com",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    tier: "cheap",
  },
  "gpt-4o": {
    key: "gpt-4o",
    provider: "openai-compat",
    apiModel: "gpt-4o",
    pricePerMInput: 2.5,
    pricePerMOutput: 10,
    apiKeyEnv: "OPENAI_API_KEY",
    tier: "capable",
  },
  "gpt-4o-mini": {
    key: "gpt-4o-mini",
    provider: "openai-compat",
    apiModel: "gpt-4o-mini",
    pricePerMInput: 0.15,
    pricePerMOutput: 0.6,
    apiKeyEnv: "OPENAI_API_KEY",
    tier: "cheap",
  },
};

// Transient failures (DNS blips, resets, rate limits, 5xx) shouldn't kill a long run.
function isTransient(e: unknown): boolean {
  const s = String((e as { message?: string })?.message ?? e);
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|Connection error/i.test(s)) return true;
  const status = (e as { status?: number })?.status;
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 529;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isTransient(e) || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 800 * 2 ** i));
    }
  }
  throw lastErr;
}

export interface CallParams {
  system: string;
  user: string;
  maxTokens: number;
  /** temperature 0 for reproducibility. */
  temperature?: number;
}

// Minimal shape of the openai client we use, so the lazy import stays typed without a hard
// dependency on the openai package types.
type OpenAiLike = { chat: { completions: { create: (args: unknown) => Promise<unknown> } } };

/** A bound client for one model. Construct once per model, reuse across calls. */
export class ModelClient {
  readonly spec: ModelSpec;
  private anthropic?: Anthropic;
  private openai?: OpenAiLike;

  constructor(spec: ModelSpec) {
    this.spec = spec;
    const key = process.env[spec.apiKeyEnv];
    if (!key) throw new Error(`${spec.apiKeyEnv} is not set (needed for model ${spec.key})`);
    if (spec.provider === "anthropic") {
      this.anthropic = new Anthropic({ apiKey: key });
    }
  }

  async call(params: CallParams): Promise<ModelResponse> {
    return withRetry(() =>
      this.spec.provider === "anthropic" ? this.callAnthropic(params) : this.callOpenAiCompat(params),
    );
  }

  private async callAnthropic(params: CallParams): Promise<ModelResponse> {
    const res = await this.anthropic!.messages.create({
      model: this.spec.apiModel,
      max_tokens: params.maxTokens,
      temperature: params.temperature ?? 0,
      system: params.system,
      messages: [{ role: "user", content: params.user }],
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");
    return {
      text,
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
        cacheCreateTokens: res.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }

  private async callOpenAiCompat(params: CallParams): Promise<ModelResponse> {
    if (!this.openai) {
      // Specifier cast to string defers TS module resolution so the Anthropic-only scaffold
      // compiles before `openai` is installed. Install `openai` to use OpenAI / DeepSeek.
      const { default: OpenAI } = (await import("openai" as string)) as {
        default: new (args: { apiKey: string; baseURL?: string }) => OpenAiLike;
      };
      const key = process.env[this.spec.apiKeyEnv]!;
      this.openai = new OpenAI({ apiKey: key, baseURL: this.spec.baseUrl });
    }
    const res = (await this.openai!.chat.completions.create({
      model: this.spec.apiModel,
      max_tokens: params.maxTokens,
      temperature: params.temperature ?? 0,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
    })) as {
      choices: { message: { content: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: res.choices[0]?.message.content ?? "",
      usage: {
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      },
    };
  }
}
