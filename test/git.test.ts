/**
 * Phase 6 검증. 실행: node --experimental-strip-types --import ./test/register-ts.mjs test/git.test.ts
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readGitCommits, listAvailableGitDates, type GitRunner } from "../src/readers/gitReader.ts";
import { listAvailableSessionDates } from "../src/readers/sessionReader.ts";
import { buildSourceBlocks, buildExtractionInstruction } from "../src/prompts/recap-template.ts";

const S = "\x1f";
const R = "\x1e";
let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  }
}

const ISO1 = "2026-06-02T10:00:00+09:00";
const ISO2 = "2026-06-02T11:00:00+09:00";

const runner: GitRunner = (args) => {
  if (args[0] === "log" && args.some((a) => a.startsWith("--after"))) {
    return `h1${S}${ISO1}${S}지형${S}feat: 토큰 버킷 추가${S}버스트 제어를 위해${R}h2${S}${ISO2}${S}지형${S}fix: 리필 보정${S}${R}`;
  }
  if (args[0] === "log") {
    return `${ISO1}\n${ISO2}\n2026-06-01T09:00:00+09:00`;
  }
  if (args[0] === "show") {
    const hash = args[args.length - 1];
    return hash === "h1" ? "M\tsrc/rateLimiter.ts\nA\tsrc/middleware.ts" : "M\tsrc/rateLimiter.ts";
  }
  return "";
};

console.log("[gitReader · readGitCommits]");
const rm = readGitCommits("dev-funnel", "2026-06-02", runner);
check("source = git", rm.source === "git");
check("커밋 2개 → userPrompts 2", rm.userPrompts.length === 2, rm.userPrompts.length);
check("커밋 메시지(subject+body) 보존", rm.userPrompts[0].text.includes("feat: 토큰 버킷 추가") && rm.userPrompts[0].text.includes("버스트 제어를 위해"));
check("변경 파일 시퀀스 3건", rm.toolSequence.length === 3, rm.toolSequence.length);
check("changedFiles 중복 제거 2개", JSON.stringify(rm.changedFiles.sort()) === JSON.stringify(["src/middleware.ts", "src/rateLimiter.ts"]), rm.changedFiles);
check("commitCount 2", rm.commitCount === 2);

console.log("\n[gitReader · listAvailableGitDates]");
check("커밋 날짜 내림차순 distinct", JSON.stringify(listAvailableGitDates(runner)) === JSON.stringify(["2026-06-02", "2026-06-01"]), listAvailableGitDates(runner));

console.log("\n[git 라벨/facts]");
const blocks = buildSourceBlocks(rm);
check("P 블록 라벨 = 커밋 메시지", blocks.find((b) => b.tag === "P1")?.label.startsWith("커밋 메시지") === true, blocks[0]?.label);
check("T 블록 라벨 = 변경 파일", blocks.find((b) => b.tag === "T1")?.label.startsWith("변경 파일") === true, blocks.find((b) => b.tag === "T1")?.label);
check("factsLine에 git 커밋 출처 표기", buildExtractionInstruction(rm, "ko").user.includes("출처: git 커밋"));

console.log("\n[listAvailableSessionDates]");
const here = path.dirname(fileURLToPath(import.meta.url));
const dates = listAvailableSessionDates([path.join(here, "fixtures", "sample-session.jsonl")]);
check("세션 로그 활동 날짜(내림차순)", JSON.stringify(dates) === JSON.stringify(["2026-06-01", "2026-05-31"]), dates);

console.log(`\n${failures === 0 ? "ALL PASS ✅" : `FAILURES: ${failures} ❌`}`);
process.exit(failures === 0 ? 0 : 1);
