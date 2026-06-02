import * as fs from "node:fs";
import type {
  RawMaterial,
  RawMessage,
  RawToolUse,
  RawToolResult,
  Role,
  ParseStats,
  FormatHealth,
} from "../types";

/** 본문을 추출할 type (PRD §6.2.1 화이트리스트) */
const BODY_TYPES = new Set<string>(["user", "assistant"]);

/** 알려진 무시 type — 미관측(unknown)과 구분하기 위함 */
const KNOWN_IGNORED = new Set<string>([
  "attachment",
  "system",
  "file-history-snapshot",
  "last-prompt",
  "permission-mode",
  "ai-title",
  "summary",
]);

/** 변경/참조 파일 경로를 수집할 도구 (PRD §6.2) */
const FILE_PATH_TOOLS = new Set<string>(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"]);

export interface ParseOptions {
  /** YYYY-MM-DD. 이 로컬 날짜의 라인만 본문 추출 */
  date: string;
  projectLabel: string;
  unknownTypeThreshold?: number;
  jsonFailureThreshold?: number;
}

const DEFAULT_UNKNOWN_THRESHOLD = 0.3;
const DEFAULT_JSON_FAIL_THRESHOLD = 0.1;

/** timestamp(ISO) → 로컬 YYYY-MM-DD. 없으면 undefined */
function localDate(ts: unknown): string | undefined {
  if (typeof ts !== "string" || ts.length === 0) {
    return undefined;
  }
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) {
    return undefined;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Bash 명령에서 보수적으로 대상 파일 경로 추출(리다이렉션/touch/mv/cp 대상만) */
function extractBashPaths(command: unknown): string[] {
  if (typeof command !== "string") {
    return [];
  }
  const found: string[] = [];
  const patterns = [
    /(?:^|\s)>>?\s*("?)([^\s"'|;&]+)\1/g, // > file, >> file
    /\b(?:touch|mv|cp)\s+(?:-\S+\s+)*("?)([^\s"'|;&]+)\1/g,
  ];
  for (const re of patterns) {
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(command)) !== null) {
      const p = mm[2];
      if (p && /[./]/.test(p)) {
        found.push(p);
      }
    }
  }
  return found;
}

function pushUnique(arr: string[], seen: Set<string>, value: unknown): void {
  if (typeof value === "string" && value.length > 0 && !seen.has(value)) {
    seen.add(value);
    arr.push(value);
  }
}

function stringifyResult(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && typeof (b as any).text === "string" ? (b as any).text : ""))
      .filter((s) => s.length > 0)
      .join("\n");
  }
  return "";
}

/**
 * 순수 함수: .jsonl 라인 배열 → RawMaterial. (PRD §6.2.1 의사알고리즘)
 * 필드가 없으면 graceful skip(방어적 파싱).
 */
export function parseLines(lines: string[], opts: ParseOptions): RawMaterial {
  const userPrompts: RawMessage[] = [];
  const assistantTexts: RawMessage[] = [];
  const toolSequence: RawToolUse[] = [];
  const toolResults: RawToolResult[] = [];
  const changedFiles: string[] = [];
  const fileSeen = new Set<string>();
  const sessionIds = new Set<string>();

  const stats: ParseStats = {
    totalLines: 0,
    parsedLines: 0,
    jsonFailures: 0,
    bodyLines: 0,
    unknownTypeLines: 0,
    unknownTypes: {},
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      continue;
    }
    stats.totalLines++;

    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      stats.jsonFailures++;
      continue;
    }
    stats.parsedLines++;

    const type = typeof obj?.type === "string" ? obj.type : "(missing)";

    if (!BODY_TYPES.has(type)) {
      if (!KNOWN_IGNORED.has(type)) {
        stats.unknownTypeLines++;
        stats.unknownTypes[type] = (stats.unknownTypes[type] ?? 0) + 1;
      }
      continue;
    }

    // 본문 타입이지만 대상 날짜가 아니면 추출하지 않음
    const lineDate = localDate(obj.timestamp);
    if (lineDate !== undefined && lineDate !== opts.date) {
      continue;
    }

    const msg = obj.message;
    if (!msg || typeof msg !== "object") {
      continue;
    }
    stats.bodyLines++;

    if (typeof obj.sessionId === "string") {
      sessionIds.add(obj.sessionId);
    }

    const role: Role = msg.role === "assistant" ? "assistant" : "user";
    const meta = { timestamp: obj.timestamp, uuid: obj.uuid, parentUuid: obj.parentUuid };
    const content = msg.content;

    if (typeof content === "string") {
      const text = content.trim();
      if (text.length > 0) {
        (role === "assistant" ? assistantTexts : userPrompts).push({ role, text, ...meta });
      }
      continue;
    }

    if (!Array.isArray(content)) {
      continue;
    }

    for (const b of content) {
      if (!b || typeof b !== "object") {
        continue;
      }
      const btype = (b as any).type;
      if (btype === "text") {
        const text = typeof (b as any).text === "string" ? (b as any).text.trim() : "";
        if (text.length > 0) {
          (role === "assistant" ? assistantTexts : userPrompts).push({ role, text, ...meta });
        }
      } else if (btype === "tool_use") {
        const name = typeof (b as any).name === "string" ? (b as any).name : "(unknown)";
        const input = (b as any).input && typeof (b as any).input === "object" ? (b as any).input : {};
        toolSequence.push({ name, input, timestamp: obj.timestamp, uuid: obj.uuid });
        if (FILE_PATH_TOOLS.has(name)) {
          pushUnique(changedFiles, fileSeen, input.file_path);
          pushUnique(changedFiles, fileSeen, input.notebook_path);
        }
        if (name === "Bash") {
          for (const p of extractBashPaths(input.command)) {
            pushUnique(changedFiles, fileSeen, p);
          }
        }
      } else if (btype === "tool_result") {
        const text = stringifyResult((b as any).content);
        if (text.length > 0) {
          toolResults.push({ text, timestamp: obj.timestamp });
        }
      }
      // thinking 및 기타 블록은 스킵 (PRD §6.2.1: thinking 본문 없음)
    }
  }

  const health = assessFormat(stats, opts);
  const warnings: string[] = [];
  if (!health.ok) {
    warnings.push(
      `세션 로그 포맷이 예상과 다릅니다(${health.reasons.join(", ")}). git 폴백 사용을 권장합니다.`
    );
  }

  return {
    source: "session",
    project: opts.projectLabel,
    date: opts.date,
    userPrompts,
    assistantTexts,
    toolSequence,
    toolResults,
    changedFiles,
    sessionCount: sessionIds.size,
    turnCount: userPrompts.length,
    stats,
    warnings,
  };
}

/** 파싱 실패율·미관측 type 비율이 임계치를 넘는지 판정 (PRD §6.2) */
export function assessFormat(stats: ParseStats, opts?: ParseOptions): FormatHealth {
  const unknownT = opts?.unknownTypeThreshold ?? DEFAULT_UNKNOWN_THRESHOLD;
  const jsonT = opts?.jsonFailureThreshold ?? DEFAULT_JSON_FAIL_THRESHOLD;
  const jsonFailureRatio = stats.totalLines > 0 ? stats.jsonFailures / stats.totalLines : 0;
  const unknownTypeRatio = stats.parsedLines > 0 ? stats.unknownTypeLines / stats.parsedLines : 0;
  const reasons: string[] = [];
  if (jsonFailureRatio > jsonT) {
    reasons.push(`JSON 파싱 실패율 ${(jsonFailureRatio * 100).toFixed(1)}%`);
  }
  if (unknownTypeRatio > unknownT) {
    reasons.push(`미관측 type 비율 ${(unknownTypeRatio * 100).toFixed(1)}%`);
  }
  return { ok: reasons.length === 0, jsonFailureRatio, unknownTypeRatio, reasons };
}

/** 여러 .jsonl 파일을 읽어 합쳐서 파싱 */
export function readSessionFiles(files: string[], opts: ParseOptions): RawMaterial {
  const allLines: string[] = [];
  for (const f of files) {
    let text = "";
    try {
      text = fs.readFileSync(f, "utf8");
    } catch {
      continue; // 읽기 실패 파일은 graceful skip
    }
    for (const ln of text.split(/\r?\n/)) {
      allLines.push(ln);
    }
  }
  return parseLines(allLines, opts);
}
