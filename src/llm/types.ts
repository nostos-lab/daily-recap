/** LLM provider abstraction. v1 implements Anthropic only. */

/** Anthropic Messages API content block (text or document etc.) */
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
  /** 0 recommended to reduce output determinism in extraction phase */
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
  /** non-streaming call (used for stage 1 extraction) */
  complete(req: ChatRequest): Promise<ChatResult>;
  /** call streaming to generate recap (stage 2). pass text chunks to onDelta */
  stream(req: ChatRequest, onDelta: (chunk: string) => void): Promise<ChatResult>;
}
