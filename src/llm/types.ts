/** LLM 프로바이더 추상화 (PRD §6.5). v1 구현은 Anthropic만. */

/** Anthropic Messages API content block (text 또는 document 등) */
export type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "document";
      source: { type: "text"; media_type: "text/plain"; data: string };
      title?: string;
      context?: string;
      citations?: { enabled: boolean };
    }
  | Record<string, unknown>;

export interface ProviderMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ChatRequest {
  model: string;
  system: string;
  messages: ProviderMessage[];
  maxTokens: number;
  /** 추출 단계에서 출력 비결정성 줄이기 위해 0 권장 */
  temperature?: number;
  signal?: AbortSignal;
}

export interface CitationRef {
  citedText: string;
  documentTitle?: string;
}

export interface ChatResult {
  text: string;
  stopReason?: string;
  citations: CitationRef[];
  usage?: { input?: number; output?: number };
}

export interface LLMProvider {
  readonly name: string;
  /** 비스트리밍 호출 (stage 1 추출에 사용) */
  complete(req: ChatRequest): Promise<ChatResult>;
  /** 스트리밍 호출 (stage 2 생성). onDelta로 텍스트 조각 전달 */
  stream(req: ChatRequest, onDelta: (chunk: string) => void): Promise<ChatResult>;
}
