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

/** types to extract body (whitelist) */
const BODY_TYPES = new Set<string>(["user", "assistant"]);

/** known ignored types — distinguish unknown (unobserved) */
const KNOWN_IGNORED = new Set<string>([
  "attachment",
  "system",
  "file-history-snapshot",
  "last-prompt",
  "permission-mode",
  "ai-title",
  "summary",
]);

/** tools to collect changed/referenced file paths */
const FILE_PATH_TOOLS = new Set<string>(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"]);

export interface ParseOptions {
  /** YYYY-MM-DD. extract lines only for this local date */
  date: string;
  projectLabel: string;
  unknownTypeThreshold?: number;
  jsonFailureThreshold?: number;
}

const DEFAULT_UNKNOWN_THRESHOLD = 0.3;
const DEFAULT_JSON_FAIL_THRESHOLD = 0.1;

/** timestamp(ISO) → local YYYY-MM-DD. if missing, return undefined */
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

/** Bash command → extract target file paths (only redirection/touch/mv/cp targets) */
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
 * pure function: .jsonl line array → RawMaterial. (PRD §6.2.1 decision algorithm)
 * if field is missing, graceful skip (defensive parsing).
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

    // body type but target date is not the same, skip extraction
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
      // thinking and other blocks are skipped (PRD §6.2.1: thinking body is missing)
    }
  }

  const health = assessFormat(stats, opts);
  const warnings: string[] = [];
  if (!health.ok) {
    warnings.push(
      `Session log format differs from expected (${health.reasons.join(", ")}). Consider using the git fallback.`
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

/** assess parsing failure rate and unknown type ratio against thresholds */
export function assessFormat(stats: ParseStats, opts?: ParseOptions): FormatHealth {
  const unknownT = opts?.unknownTypeThreshold ?? DEFAULT_UNKNOWN_THRESHOLD;
  const jsonT = opts?.jsonFailureThreshold ?? DEFAULT_JSON_FAIL_THRESHOLD;
  const jsonFailureRatio = stats.totalLines > 0 ? stats.jsonFailures / stats.totalLines : 0;
  const unknownTypeRatio = stats.parsedLines > 0 ? stats.unknownTypeLines / stats.parsedLines : 0;
  const reasons: string[] = [];
  if (jsonFailureRatio > jsonT) {
    reasons.push(`JSON parse failure rate ${(jsonFailureRatio * 100).toFixed(1)}%`);
  }
  if (unknownTypeRatio > unknownT) {
    reasons.push(`Unknown type ratio ${(unknownTypeRatio * 100).toFixed(1)}%`);
  }
  return { ok: reasons.length === 0, jsonFailureRatio, unknownTypeRatio, reasons };
}

/** list of dates with actual body in the session log (local date, descending). */
export function listAvailableSessionDates(files: string[]): string[] {
  const dates = new Set<string>();
  for (const f of files) {
    let text = "";
    try {
      text = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (t.length === 0) {
        continue;
      }
      let obj: any;
      try {
        obj = JSON.parse(t);
      } catch {
        continue;
      }
      const type = typeof obj?.type === "string" ? obj.type : "";
      if (!BODY_TYPES.has(type)) {
        continue;
      }
      const d = localDate(obj.timestamp);
      if (d) {
        dates.add(d);
      }
    }
  }
  return [...dates].sort().reverse();
}

/** read multiple .jsonl files and parse them */
export function readSessionFiles(files: string[], opts: ParseOptions): RawMaterial {
  const allLines: string[] = [];
  for (const f of files) {
    let text = "";
    try {
      text = fs.readFileSync(f, "utf8");
    } catch {
      continue; // file read failure is gracefully skipped
    }
    for (const ln of text.split(/\r?\n/)) {
      allLines.push(ln);
    }
  }
  return parseLines(allLines, opts);
}
