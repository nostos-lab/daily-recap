import type { ChatRequest, ChatResult, LLMProvider } from "./types";
import { LLMError } from "./errors";
import { AnthropicProvider } from "./anthropic";

/**
 * 프로바이더 팩토리 (PRD §6.5).
 * v1은 Anthropic만 구현. OpenAI·Ollama는 NotImplemented stub(v1.1).
 */

class NotImplementedProvider implements LLMProvider {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  private fail(): never {
    throw new LLMError("unknown", `${this.name} 프로바이더는 아직 구현되지 않았습니다(v1.1 예정).`);
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
      throw new LLMError("unknown", `알 수 없는 프로바이더: ${cfg.provider}`);
  }
}
