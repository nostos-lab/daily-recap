/**
 * Phase 2 raw material (RawMaterial) type.
 * "decision narrative" = user prompt + assistant text + tool call sequence.
 *
 * avoid runtime-affecting TS features (enum, namespace, parameter property etc.)
 * to enable pure type elimination for testing with node --experimental-strip-types.
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

/** parsing stats — used for format variation detection (threshold comparison) */
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
  /** ~/.claude/projects subfolder name (slug) or display project path */
  project: string;
  /** YYYY-MM-DD (local date filter basis) */
  date: string;
  userPrompts: RawMessage[];
  assistantTexts: RawMessage[];
  toolSequence: RawToolUse[];
  toolResults: RawToolResult[];
  /** Read/Edit/Write file_path + Bash command extracted file paths (deduplicated) */
  changedFiles: string[];
  /** number of distinct sessionIds seen (session source) */
  sessionCount: number;
  /** number of commits (git source) */
  commitCount?: number;
  /** number of user turns (= userPrompts.length) or commits */
  turnCount: number;
  stats: ParseStats;
  warnings: string[];
}

/** format variation detection result */
export interface FormatHealth {
  ok: boolean;
  jsonFailureRatio: number;
  unknownTypeRatio: number;
  reasons: string[];
}
