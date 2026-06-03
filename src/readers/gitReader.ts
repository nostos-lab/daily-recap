import { execFileSync } from "node:child_process";
import type { RawMaterial, RawMessage, RawToolUse, ParseStats } from "../types";

/**
 * git 커밋 폴백 리더 (PRD §6.2 GitCommitReader).
 * 세션 로그가 없을 때(또는 사용자가 git 소스를 택할 때) 그날 커밋·변경 파일을 원재료로 삼는다.
 * git 실행은 주입형 러너로 분리해 순수 테스트 가능.
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

/** 실제 git 실행 러너(기본). 실패 시 빈 문자열 → 상위에서 빈 결과 처리. */
export function makeGitRunner(repoPath: string): GitRunner {
  return (args) => {
    try {
      return execFileSync("git", ["-C", repoPath, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    } catch {
      return "";
    }
  };
}

/** 저장소가 커밋을 가진 날짜 목록(내림차순). */
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

/** 특정 날짜의 커밋 → RawMaterial(source:'git'). */
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
    // 커밋 메시지 = 개발자가 명시한 의도 → 사용자 프롬프트(P)로 매핑
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
