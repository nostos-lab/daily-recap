/**
 * v1.1 ① 검증: 세션 + git 융합("결과" 축 보강).
 * 실행: node --experimental-strip-types --import ./test/register-ts.mjs test/fusion.test.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLines } from "../src/readers/sessionReader.ts";
import { readGitCommits, mergeGitResult, type GitRunner } from "../src/readers/gitReader.ts";
import { buildSourceBlocks, buildExtractionInstruction, buildRecapPrompt, renderSources } from "../src/prompts/recap-template.ts";
import { enforceBudget } from "../src/llm/budget.ts";

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

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(here, "fixtures", "sample-session.jsonl"), "utf8");
const session = parseLines(fixture.split(/\r?\n/), { date: "2026-06-01", projectLabel: "dev-funnel" });

const runner: GitRunner = (args) => {
  if (args[0] === "log" && args.some((a) => a.startsWith("--after"))) {
    return `h1${S}2026-06-01T19:00:00+09:00${S}지형${S}feat: 토큰 버킷 구현${S}${R}h2${S}2026-06-01T20:00:00+09:00${S}지형${S}test: 레이트리미터 테스트 통과${S}${R}`;
  }
  if (args[0] === "show") {
    const hash = args[args.length - 1];
    return hash === "h1" ? "A\tsrc/rateLimiter.ts" : "M\ttest/rateLimiter.test.ts";
  }
  return "";
};
const git = readGitCommits("dev-funnel", "2026-06-01", runner);
const merged = mergeGitResult(session, git);

console.log("[mergeGitResult]");
check("git 컨텍스트 부착", !!merged.git);
check("commitCount 2", merged.git?.commitCount === 2, merged.git?.commitCount);
check("changedFiles 2", merged.git?.changedFiles.length === 2, merged.git?.changedFiles);
check("commits 2", merged.git?.commits.length === 2);
check("세션 원본 보존(userPrompts 2)", merged.userPrompts.length === 2);
check("source는 여전히 session", merged.source === "session");

console.log("\n[buildSourceBlocks · G 블록]");
const blocks = buildSourceBlocks(merged);
const tags = blocks.map((b) => b.tag);
check("세션 블록 유지(P1/A1/T1)", ["P1", "A1", "T1"].every((t) => tags.includes(t)), tags);
check("git 커밋 블록 G1/G2", tags.includes("G1") && tags.includes("G2"));
check("git 변경파일 블록 GF", tags.includes("GF"));
check("GF에 파일 포함", renderSources(blocks).includes("src/rateLimiter.ts"));

console.log("\n[factsLine · git 카운트]");
const exUser = buildExtractionInstruction(merged, "ko").user;
check("git 커밋 수 표기", exUser.includes("git 커밋=2개"), exUser.slice(0, 120));
check("git 변경 파일 수 표기", exUser.includes("git 변경 파일=2개"));

console.log("\n[recap 프롬프트 · 결과 축 규칙]");
const rp = buildRecapPrompt(merged, "{}", "ko");
check("system: 결과 축 git 우선 규칙", rp.system.includes("git 결과") && rp.system.includes("G 태그"));
check("user: G1 소스 포함", rp.user.includes("[G1]"));

console.log("\n[budget · G는 T/R보다 보존]");
const big = "X".repeat(600);
const b = enforceBudget(
  [
    { tag: "P1", label: "u", content: big },
    { tag: "G1", label: "g", content: big },
    { tag: "T1", label: "t", content: big },
    { tag: "R1", label: "r", content: big },
  ],
  300
);
const kept = b.blocks.map((x) => x.tag);
check("R1·T1 우선 제외", b.droppedTags.includes("R1") && b.droppedTags.includes("T1"), b.droppedTags);
check("G1 보존(P/A/G 우선)", kept.includes("G1"), kept);

console.log(`\n${failures === 0 ? "ALL PASS ✅" : `FAILURES: ${failures} ❌`}`);
process.exit(failures === 0 ? 0 : 1);
