import type { ChatRequest, ChatResult, LLMProvider } from "./types";
import { LLMError } from "./errors";
import { AnthropicProvider } from "./anthropic";

/**
 * provider factory.
 * v1 implements Anthropic only. OpenAI·Ollama are NotImplemented stub(v1.1).
 */

class NotImplementedProvider implements LLMProvider {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  private fail(): never {
    throw new LLMError("unknown", `${this.name} provider is not implemented yet (v1.1 planned).`);
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
  baseUrl?: string;
}

export function getProvider(cfg: ProviderConfig): LLMProvider {
  switch (cfg.provider) {
    case "anthropic":
      return new AnthropicProvider({ apiKey: cfg.apiKey, fetchImpl: cfg.fetchImpl, baseUrl: cfg.baseUrl });
    case "openai":
      return new NotImplementedProvider("openai");
    case "ollama":
      return new NotImplementedProvider("ollama");
    default:
      throw new LLMError("unknown", `unknown provider: ${cfg.provider}`);
  }
}
