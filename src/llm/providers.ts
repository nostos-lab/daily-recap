import type { ChatRequest, ChatResult, LLMProvider } from "./types";
import { LLMError } from "./errors";
import { AnthropicProvider } from "./anthropic";
import { OpenAICompatProvider } from "./openaiCompat";

/**
 * provider factory.
 * - anthropic: native Messages API (Citations supported).
 * - openai / grok / gemini: one OpenAI-compatible adapter, only baseUrl/model differ.
 *   They have no Citations API → the recap runner uses the inline extraction path.
 * - ollama: local provider, NotImplemented stub (planned).
 */

export interface ProviderMeta {
  id: string;
  /** human label for the picker. */
  label: string;
  /** placeholder shown in the key input box. */
  keyPlaceholder: string;
  /** default base URL for OpenAI-compatible providers. */
  defaultBaseUrl?: string;
  /** whether this provider needs an API key. */
  needsKey: boolean;
  /** whether the native Citations API is available (Anthropic only). */
  useCitations: boolean;
}

/** providers the user can store a key for and select. */
export const PROVIDERS: Record<string, ProviderMeta> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    keyPlaceholder: "sk-ant-...",
    needsKey: true,
    useCitations: true,
  },
  openai: {
    id: "openai",
    label: "OpenAI (GPT)",
    keyPlaceholder: "sk-...",
    defaultBaseUrl: "https://api.openai.com/v1",
    needsKey: true,
    useCitations: false,
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    keyPlaceholder: "AIza...",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    needsKey: true,
    useCitations: false,
  },
  grok: {
    id: "grok",
    label: "xAI (Grok)",
    keyPlaceholder: "xai-...",
    defaultBaseUrl: "https://api.x.ai/v1",
    needsKey: true,
    useCitations: false,
  },
};

/** does the given provider use the native Citations extraction path? */
export function providerUsesCitations(provider: string): boolean {
  return PROVIDERS[provider]?.useCitations ?? false;
}

class NotImplementedProvider implements LLMProvider {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  private fail(): never {
    throw new LLMError("unknown", `${this.name} provider is not implemented yet (planned).`);
  }
  async complete(_req: ChatRequest): Promise<ChatResult> {
    this.fail();
  }
  async stream(_req: ChatRequest, _onDelta: (chunk: string) => void): Promise<ChatResult> {
    this.fail();
  }
}

export interface ProviderConfig {
  provider: string;
  apiKey: string;
  fetchImpl?: (url: string, init: any) => Promise<any>;
  /** override base URL (OpenAI-compatible providers); falls back to the provider default. */
  baseUrl?: string;
}

export function getProvider(cfg: ProviderConfig): LLMProvider {
  switch (cfg.provider) {
    case "anthropic":
      return new AnthropicProvider({ apiKey: cfg.apiKey, fetchImpl: cfg.fetchImpl, baseUrl: cfg.baseUrl });
    case "openai":
    case "grok":
    case "gemini": {
      const baseUrl = cfg.baseUrl || PROVIDERS[cfg.provider].defaultBaseUrl!;
      return new OpenAICompatProvider({ name: cfg.provider, apiKey: cfg.apiKey, baseUrl, fetchImpl: cfg.fetchImpl });
    }
    case "ollama":
      return new NotImplementedProvider("ollama");
    default:
      throw new LLMError("unknown", `unknown provider: ${cfg.provider}`);
  }
}
