/**
 * Phase 2 원재료(RawMaterial) 타입.
 * "의사결정 서사"의 3요소 = 사용자 프롬프트 + assistant 텍스트 + 도구 호출 시퀀스. (PRD §6.2)
 *
 * 열거형(enum)·namespace·parameter property 등 런타임 영향을 주는 TS 기능은
 * 쓰지 않는다(순수 타입 소거가 가능해야 node --experimental-strip-types로 테스트 가능).
 */

export type Role = "user" | "assistant";

export interface RawMessage {
  role: Role;
  text: string;
  timestamp?: string;
  uuid?: string;
  parentUuid?: string;
}

export interface RawToolUse {
  name: string;
  input: Record<string, unknown>;
  timestamp?: string;
  uuid?: string;
}

export interface RawToolResult {
  text: string;
  timestamp?: string;
}

/** 파싱 통계 — 포맷 변동 감지(임계치 비교)에 사용. (PRD §6.2) */
export interface ParseStats {
  totalLines: number;
  parsedLines: number;
  jsonFailures: number;
  bodyLines: number;
  unknownTypeLines: number;
  unknownTypes: Record<string, number>;
}

export interface RawMaterial {
  source: "session" | "git";
  /** ~/.claude/projects 하위 폴더명(slug) 또는 표시용 프로젝트 경로 */
  project: string;
  /** YYYY-MM-DD (로컬 날짜 필터 기준) */
  date: string;
  userPrompts: RawMessage[];
  assistantTexts: RawMessage[];
  toolSequence: RawToolUse[];
  toolResults: RawToolResult[];
  /** Read/Edit/Write의 file_path + Bash 명령에서 추출한 파일 경로(중복 제거) */
  changedFiles: string[];
  /** 등장한 distinct sessionId 수 (session 소스) */
  sessionCount: number;
  /** 커밋 수 (git 소스) */
  commitCount?: number;
  /** 사용자 턴 수(= userPrompts.length) 또는 커밋 수 */
  turnCount: number;
  stats: ParseStats;
  warnings: string[];
}

/** 포맷 변동 판정 결과 */
export interface FormatHealth {
  ok: boolean;
  jsonFailureRatio: number;
  unknownTypeRatio: number;
  reasons: string[];
}
