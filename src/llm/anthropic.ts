import type { ChatRequest, ChatResult, CitationRef, LLMProvider } from "./types";
import { LLMError, fromNetwork, fromStatus } from "./errors";

type FetchLike = (url: string, init: any) => Promise<any>;

export interface AnthropicOptions {
  apiKey: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
  version?: string;
}

const DEFAULT_BASE = "https://api.anthropic.com";
const DEFAULT_VERSION = "2023-06-01";

/** Anthropic Messages API 어댑터. fetch 직접 사용(외부 의존성 0). (PRD §6.5) */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private apiKey: string;
  private fetchImpl: FetchLike;
  private baseUrl: string;
  private version: string;

  constructor(opts: AnthropicOptions) {
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? ((globalThis as any).fetch as FetchLike);
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.version = opts.version ?? DEFAULT_VERSION;
    if (!this.fetchImpl) {
      throw new LLMError("unknown", "fetch를 사용할 수 없습니다(Node 18+ 또는 주입 필요).");
    }
  }

  private body(req: ChatRequest, stream: boolean): string {
    return JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages,
      temperature: req.temperature,
      stream,
    });
  }

  private headers(): Record<string, string> {
    return {
      "x-api-key": this.apiKey,
      "anthropic-version": this.version,
      "content-type": "application/json",
    };
  }

  private async post(req: ChatRequest, stream: boolean): Promise<any> {
    let res: any;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: this.headers(),
        body: this.body(req, stream),
        signal: req.signal,
      });
    } catch (e) {
      throw fromNetwork(e);
    }
    if (!res.ok) {
      let text = "";
      try {
        text = await res.text();
      } catch {
        /* ignore */
      }
      throw fromStatus(res.status, text);
    }
    return res;
  }

  async complete(req: ChatRequest): Promise<ChatResult> {
    const res = await this.post(req, false);
    const json = await res.json();
    const citations: CitationRef[] = [];
    let text = "";
    for (const block of json?.content ?? []) {
      if (block?.type === "text" && typeof block.text === "string") {
        text += block.text;
        for (const c of block.citations ?? []) {
          citations.push({ citedText: c?.cited_text ?? "", documentTitle: c?.document_title });
        }
      }
    }
    return {
      text,
      stopReason: json?.stop_reason,
      citations,
      usage: { input: json?.usage?.input_tokens, output: json?.usage?.output_tokens },
    };
  }

  async stream(req: ChatRequest, onDelta: (chunk: string) => void): Promise<ChatResult> {
    const res = await this.post(req, true);
    if (!res.body || typeof res.body.getReader !== "function") {
      throw new LLMError("unknown", "스트리밍 응답 본문을 읽을 수 없습니다.");
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let text = "";
    const citations: CitationRef[] = [];
    let stopReason: string | undefined;
    let usageOut: number | undefined;
    let usageIn: number | undefined;

    const handle = (ev: any) => {
      if (!ev || typeof ev.type !== "string") {
        return;
      }
      if (ev.type === "error") {
        throw new LLMError("unknown", `스트림 오류: ${ev.error?.message ?? "unknown"}`);
      }
      if (ev.type === "message_start") {
        usageIn = ev.message?.usage?.input_tokens ?? usageIn;
      } else if (ev.type === "content_block_delta") {
        if (ev.delta?.type === "text_delta" && typeof ev.delta.text === "string") {
          text += ev.delta.text;
          onDelta(ev.delta.text);
        } else if (ev.delta?.type === "citations_delta" && ev.delta.citation) {
          citations.push({
            citedText: ev.delta.citation.cited_text ?? "",
            documentTitle: ev.delta.citation.document_title,
          });
        }
      } else if (ev.type === "message_delta") {
        stopReason = ev.delta?.stop_reason ?? stopReason;
        usageOut = ev.usage?.output_tokens ?? usageOut;
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of chunk.split("\n")) {
          const m = /^data:\s?(.*)$/.exec(line);
          if (!m) {
            continue;
          }
          const payload = m[1];
          if (payload === "[DONE]" || payload.length === 0) {
            continue;
          }
          let ev: any;
          try {
            ev = JSON.parse(payload);
          } catch {
            continue;
          }
          handle(ev);
        }
      }
    }

    return { text, stopReason, citations, usage: { input: usageIn, output: usageOut } };
  }
}
