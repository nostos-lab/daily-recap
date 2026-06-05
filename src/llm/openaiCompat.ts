import type { ChatRequest, ChatResult, ContentBlock, LLMProvider } from "./types";
import { LLMError, fromNetwork, fromStatus } from "./errors";

type FetchLike = (url: string, init: any) => Promise<any>;

export interface OpenAICompatOptions {
  /** provider id used as `name` (e.g. "openai" | "grok" | "gemini"). */
  name: string;
  apiKey: string;
  /** base URL WITHOUT the trailing /chat/completions (e.g. https://api.openai.com/v1). */
  baseUrl: string;
  fetchImpl?: FetchLike;
}

/**
 * OpenAI Chat Completions-compatible adapter.
 * Covers OpenAI, xAI Grok (https://api.x.ai/v1), and Gemini's OpenAI-compat
 * layer (https://generativelanguage.googleapis.com/v1beta/openai) with one
 * implementation — only the baseUrl/model differ.
 *
 * These providers have no Citations API, so the recap runner uses the inline
 * text-extraction path (useCitations:false) with them. Returned citations are
 * therefore always empty here.
 */
export class OpenAICompatProvider implements LLMProvider {
  readonly name: string;
  private apiKey: string;
  private baseUrl: string;
  private fetchImpl: FetchLike;

  constructor(opts: OpenAICompatOptions) {
    this.name = opts.name;
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? ((globalThis as any).fetch as FetchLike);
    if (!this.fetchImpl) {
      throw new LLMError("unknown", "fetch is not available (Node 18+ or injection required).");
    }
  }

  /** flatten ProviderMessage content to plain text (OpenAI takes string content). */
  private static toText(content: string | ContentBlock[]): string {
    if (typeof content === "string") {
      return content;
    }
    return content
      .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }

  private body(req: ChatRequest, stream: boolean): string {
    const messages: Array<{ role: string; content: string }> = [];
    if (req.system) {
      messages.push({ role: "system", content: req.system });
    }
    for (const m of req.messages) {
      messages.push({ role: m.role, content: OpenAICompatProvider.toText(m.content) });
    }
    return JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      messages,
      stream,
    });
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.apiKey}`,
      "content-type": "application/json",
    };
  }

  private async post(req: ChatRequest, stream: boolean): Promise<any> {
    let res: any;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
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
    const choice = json?.choices?.[0];
    const text = typeof choice?.message?.content === "string" ? choice.message.content : "";
    return {
      text,
      stopReason: choice?.finish_reason,
      citations: [],
      usage: { input: json?.usage?.prompt_tokens, output: json?.usage?.completion_tokens },
    };
  }

  async stream(req: ChatRequest, onDelta: (chunk: string) => void): Promise<ChatResult> {
    const res = await this.post(req, true);
    if (!res.body || typeof res.body.getReader !== "function") {
      throw new LLMError("unknown", "cannot read streaming response body.");
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let text = "";
    let stopReason: string | undefined;
    let usageIn: number | undefined;
    let usageOut: number | undefined;

    const handle = (ev: any) => {
      const choice = ev?.choices?.[0];
      const delta = choice?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        text += delta;
        onDelta(delta);
      }
      if (choice?.finish_reason) {
        stopReason = choice.finish_reason;
      }
      if (ev?.usage) {
        usageIn = ev.usage.prompt_tokens ?? usageIn;
        usageOut = ev.usage.completion_tokens ?? usageOut;
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

    return { text, stopReason, citations: [], usage: { input: usageIn, output: usageOut } };
  }
}
