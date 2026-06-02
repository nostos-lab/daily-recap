/** LLM 호출 에러 분류 및 사용자 안내 (PRD §6.5). */

export type ErrorKind =
  | "auth" // 401 — 키 재설정 유도
  | "rate_limit" // 429 — 재시도 안내
  | "bad_request" // 400 — 요청 문제(예: Citations+Structured Outputs 동시 사용)
  | "server" // 5xx
  | "network" // fetch 실패
  | "unknown";

export class LLMError extends Error {
  kind: ErrorKind;
  status?: number;
  action?: string; // 호출부가 실행할 명령(예: recap.setApiKey)
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
    return new LLMError("auth", `API 키가 유효하지 않습니다. 키를 다시 설정해 주세요.${snippet}`, {
      status,
      action: "recap.setApiKey",
    });
  }
  if (status === 429) {
    return new LLMError("rate_limit", `요청이 제한되었습니다(429). 잠시 후 다시 시도해 주세요.${snippet}`, {
      status,
      retryable: true,
    });
  }
  if (status === 400) {
    return new LLMError("bad_request", `요청이 거부되었습니다(400).${snippet}`, { status });
  }
  if (status >= 500) {
    return new LLMError("server", `서버 오류(${status}). 잠시 후 다시 시도해 주세요.${snippet}`, {
      status,
      retryable: true,
    });
  }
  return new LLMError("unknown", `예상치 못한 응답(${status}).${snippet}`, { status });
}

/** fetch 자체 실패(네트워크) → LLMError */
export function fromNetwork(err: unknown): LLMError {
  const msg = err instanceof Error ? err.message : String(err);
  return new LLMError("network", `네트워크 오류로 호출에 실패했습니다: ${msg}`, { retryable: true });
}
