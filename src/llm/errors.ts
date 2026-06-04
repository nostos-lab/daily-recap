/** error classification and user guidance for LLM calls. */

export type ErrorKind =
  | "auth" // 401 — reset key prompt
  | "rate_limit" // 429 — retry guidance
  | "bad_request" // 400 — request problem (e.g. Citations+Structured Outputs simultaneous use)
  | "server" // 5xx
  | "network" // fetch failed
  | "unknown";

export class LLMError extends Error {
  kind: ErrorKind;
  status?: number;
  action?: string; // command to execute (e.g. recap.setApiKey)
  retryable: boolean;

  constructor(kind: ErrorKind, message: string, opts?: { status?: number; action?: string; retryable?: boolean }) {
    super(message);
    this.name = "LLMError";
    this.kind = kind;
    this.status = opts?.status;
    this.action = opts?.action;
    this.retryable = opts?.retryable ?? false;
  }
}

/** HTTP 상태 → LLMError */
export function fromStatus(status: number, bodyText?: string): LLMError {
  const snippet = bodyText ? ` (${bodyText.slice(0, 200)})` : "";
  if (status === 401 || status === 403) {
    return new LLMError("auth", `API key is invalid. Please reset the key.${snippet}`, {
      status,
      action: "recap.setApiKey",
    });
  }
  if (status === 429) {
    return new LLMError("rate_limit", `request limited (429). Please try again later.${snippet}`, {
      status,
      retryable: true,
    });
  }
  if (status === 400) {
    return new LLMError("bad_request", `request denied (400).${snippet}`, { status });
  }
  if (status >= 500) {
    return new LLMError("server", `server error (${status}). Please try again later.${snippet}`, {
      status,
      retryable: true,
    });
  }
  return new LLMError("unknown", `unexpected response (${status}).${snippet}`, { status });
}

/** fetch itself failed (network) → LLMError */
export function fromNetwork(err: unknown): LLMError {
  const msg = err instanceof Error ? err.message : String(err);
  return new LLMError("network", `call failed due to network error: ${msg}`, { retryable: true });
}
