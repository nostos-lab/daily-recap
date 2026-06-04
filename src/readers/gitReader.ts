import { execFileSync } from "node:child_process";
import type { RawMaterial, RawMessage, RawToolUse, ParseStats } from "../types";

/**
 * git commit fallback reader.
 * when session log is missing (or user chooses git source), use that day's commits and changed files as raw material.
 * git execution is separated into a injectable runner for pure testing.
 */

export type GitRunner = (args: string[]) => string;

const SEP = "\x1f"; // unit separator
const REC = "\x1e"; // record separator

interface Commit {
  hash: string;
  iso: string;
  author: string;
  subject: string;
  body: string;
}

function isoToLocalDate(iso: string): string | undefined {
  if (!iso) {
    return undefined;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return undefined;
  }
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** actual git execution runner (default). if fails, return empty string → handled by higher level. */
export function makeGitRunner(repoPath: string): GitRunner {
  return (args) => {
    try {
      return execFileSync("git", ["-C", repoPath, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    } catch {
      return "";
    }
  };
}

/** list of dates with commits (descending). */
export function listAvailableGitDates(run: GitRunner): string[] {
  const out = run(["log", "--pretty=format:%aI"]);
  const dates = new Set<string>();
  for (const line of out.split(/\r?\n/)) {
    const d = isoToLocalDate(line.trim());
    if (d) {
      dates.add(d);
    }
  }
  return [...dates].sort().reverse();
}

/** commits for a specific date → RawMaterial(source:'git'). */
export function readGitCommits(projectLabel: string, date: string, run: GitRunner): RawMaterial {
  const logOut = run([
    "log",
    `--after=${date} 00:00:00`,
    `--before=${date} 23:59:59`,
    `--pretty=format:%H${SEP}%aI${SEP}%an${SEP}%s${SEP}%b${REC}`,
  ]);

  const commits: Commit[] = [];
  for (const rawRec of logOut.split(REC)) {
    const recd = rawRec.replace(/^\r?\n/, "").trim();
    if (!recd) {
      continue;
    }
    const parts = recd.split(SEP);
    if (parts.length < 4) {
      continue;
    }
    commits.push({
      hash: parts[0],
      iso: parts[1],
      author: parts[2],
      subject: parts[3],
      body: (parts[4] ?? "").trim(),
    });
  }

  const userPrompts: RawMessage[] = [];
  const toolSequence: RawToolUse[] = [];
  const changedFiles: string[] = [];
  const seen = new Set<string>();

  for (const c of commits) {
    // commit message = developer's explicit intention → map to user prompt (P)
    const text = c.body ? `${c.subject}\n\n${c.body}` : c.subject;
    userPrompts.push({ role: "user", text, timestamp: c.iso, uuid: c.hash });

    const filesOut = run(["show", "--name-status", "--pretty=format:", c.hash]);
    for (const line of filesOut.split(/\r?\n/)) {
      const m = /^([A-Z])\d*\t(.+)$/.exec(line.trim());
      if (!m) {
        continue;
      }
      const status = m[1];
      const file = m[2];
      toolSequence.push({ name: "git-change", input: { status, file_path: file }, timestamp: c.iso });
      if (!seen.has(file)) {
        seen.add(file);
        changedFiles.push(file);
      }
    }
  }

  const stats: ParseStats = {
    totalLines: commits.length,
    parsedLines: commits.length,
    jsonFailures: 0,
    bodyLines: commits.length,
    unknownTypeLines: 0,
    unknownTypes: {},
  };

  return {
    source: "git",
    project: projectLabel,
    date,
    userPrompts,
    assistantTexts: [],
    toolSequence,
    toolResults: [],
    changedFiles,
    sessionCount: 0,
    commitCount: commits.length,
    turnCount: commits.length,
    stats,
    warnings: [],
  };
}
