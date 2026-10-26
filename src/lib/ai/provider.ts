import Anthropic from "@anthropic-ai/sdk";

export type AiProviderName = "anthropic" | "openrouter";

export interface AiConfig {
  provider: AiProviderName;
  model: string;
  /** shown to users, e.g. "claude-haiku-4-5 (Anthropic)" */
  label: string;
}

export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
}

export interface Completion {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export type Complete = (req: CompletionRequest) => Promise<Completion>;

const DEFAULT_MODELS: Record<AiProviderName, string> = {
  anthropic: "claude-haiku-4-5",
  openrouter: "anthropic/claude-haiku-4.5",
};
const PROVIDER_LABEL: Record<AiProviderName, string> = { anthropic: "Anthropic", openrouter: "OpenRouter" };

const anthropicKey = () => process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
const openrouterKey = () => process.env.OPENROUTER_API_KEY;

/**
 * Picks the provider from AI_PROVIDER, or the first one with a key
 * (OpenRouter, then Anthropic). Returns undefined when no key is set.
 */
export function aiConfig(): AiConfig | undefined {
  const wanted = process.env.AI_PROVIDER?.trim().toLowerCase();
  let provider: AiProviderName | undefined;
  if (wanted === "anthropic" || wanted === "openrouter") provider = wanted;
  else if (openrouterKey()) provider = "openrouter";
  else if (anthropicKey()) provider = "anthropic";
  if (!provider) return undefined;
  if (provider === "anthropic" ? !anthropicKey() : !openrouterKey()) return undefined;
  const model = (provider === "anthropic" ? process.env.ANTHROPIC_MODEL : process.env.OPENROUTER_MODEL)?.trim() || DEFAULT_MODELS[provider];
  return { provider, model, label: `${model} (${PROVIDER_LABEL[provider]})` };
}

export function aiAvailable(): boolean {
  return !!aiConfig();
}

export function missingKeyMessage(): string {
  const wanted = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (wanted === "anthropic") return "AI_PROVIDER=anthropic, tetapi CLAUDE_API_KEY belum diatur di .env";
  if (wanted === "openrouter") return "AI_PROVIDER=openrouter, tetapi OPENROUTER_API_KEY belum diatur di .env";
  return "Kunci API AI belum diatur di .env (OPENROUTER_API_KEY atau CLAUDE_API_KEY)";
}

export function createCompleter(cfg: AiConfig): Complete {
  return cfg.provider === "anthropic" ? anthropicCompleter(cfg.model) : openrouterCompleter(cfg.model);
}

function anthropicCompleter(model: string): Complete {
  const client = new Anthropic({ apiKey: anthropicKey(), maxRetries: 2, timeout: 90_000 });
  return async ({ system, user, maxTokens, temperature }) => {
    const res = await client.messages.create({ model, max_tokens: maxTokens, temperature, system, messages: [{ role: "user", content: user }] });
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    return { text, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
  };
}

interface OpenRouterResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: number };
}

/** OpenRouter speaks the OpenAI chat-completions format. */
function openrouterCompleter(model: string): Complete {
  const MAX_RETRIES = 2;
  const REASONING_HEADROOM = 2048;
  return async ({ system, user, maxTokens, temperature }) => {
    const body = JSON.stringify({
      model,
      // some models (e.g. GLM) reason whether asked or not, and reasoning
      // tokens count against max_tokens, so leave room for them
      max_tokens: maxTokens + REASONING_HEADROOM,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      reasoning: { effort: "low", exclude: true },
    });
    for (let attempt = 0; ; attempt++) {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${openrouterKey()}`, "Content-Type": "application/json", "X-Title": "Pemeriksa Format Skripsi" },
        body,
        signal: AbortSignal.timeout(90_000),
      });
      const data = (await res.json().catch(() => ({}))) as OpenRouterResponse;
      const retryable = res.status === 429 || res.status >= 500;
      if ((!res.ok || data.error) && retryable && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      if (!res.ok || data.error) throw new Error(`OpenRouter ${res.status}: ${data.error?.message ?? res.statusText}`);
      return {
        text: data.choices?.[0]?.message?.content ?? "",
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      };
    }
  };
}
