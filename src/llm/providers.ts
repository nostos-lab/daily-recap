import type { LLMProvider } from "./types";
import { LLMError } from "./errors";
import { AnthropicProvider } from "./anthropic";
import { OpenAICompatProvider } from "./openaiCompat";

/**
 * provider factory.
 * - anthropic: native Messages API (Citations supported).
 * - openai / grok / gemini / ollama: one OpenAI-compatible adapter, only
 *   baseUrl/model differ. They have no Citations API → the recap runner uses
 *   the inline extraction path. Ollama is local and needs no API key.
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
  ollama: {
    id: "ollama",
    label: "Ollama (local)",
    keyPlaceholder: "",
    defaultBaseUrl: "http://localhost:11434/v1",
    needsKey: false,
    useCitations: false,
  },
};

/** does the given provider use the native Citations extraction path? */
export function providerUsesCitations(provider: string): boolean {
  return PROVIDERS[provider]?.useCitations ?? false;
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
    case "gemini":
    case "ollama": {
      const baseUrl = cfg.baseUrl || PROVIDERS[cfg.provider].defaultBaseUrl!;
      // local Ollama needs no key; send a dummy bearer it ignores.
      const apiKey = cfg.provider === "ollama" ? cfg.apiKey || "ollama" : cfg.apiKey;
      const connectionHint =
        cfg.provider === "ollama"
          ? "Is Ollama running? Start it (`ollama serve`) and pull a model (e.g. `ollama pull llama3.1`)."
          : undefined;
      return new OpenAICompatProvider({ name: cfg.provider, apiKey, baseUrl, fetchImpl: cfg.fetchImpl, connectionHint });
    }
    default:
      throw new LLMError("unknown", `unknown provider: ${cfg.provider}`);
  }
}
