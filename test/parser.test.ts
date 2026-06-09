/**
 * Phase 2 검증 테스트. 컴파일 없이 실행:
 *   node --experimental-strip-types test/parser.test.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLines, assessFormat } from "../src/readers/sessionReader.ts";
import {
  encodeProjectSlug,
  candidateSlugs,
  matchProject,
} from "../src/readers/projectPaths.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(here, "fixtures", "sample-session.jsonl"), "utf8");
const lines = fixture.split(/\r?\n/);

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  }
}

console.log("[parseLines · date=2026-06-01]");
const rm = parseLines(lines, { date: "2026-06-01", projectLabel: "proj" });

check("사용자 프롬프트 2개", rm.userPrompts.length === 2, rm.userPrompts.map((p) => p.text));
check("assistant 텍스트 5개", rm.assistantTexts.length === 5, rm.assistantTexts.length);
check("도구 시퀀스 4개(Read/Write/Bash/Edit)", rm.toolSequence.length === 4, rm.toolSequence.map((t) => t.name));
check(
  "도구 순서 보존",
  JSON.stringify(rm.toolSequence.map((t) => t.name)) === JSON.stringify(["Read", "Write", "Bash", "Edit"]),
  rm.toolSequence.map((t) => t.name)
);
check("tool_result 3개", rm.toolResults.length === 3, rm.toolResults.length);
check(
  "변경 파일 2개(중복 제거)",
  JSON.stringify(rm.changedFiles.sort()) ===
    JSON.stringify(["/Users/dev/proj/src/middleware.ts", "/Users/dev/proj/src/rateLimiter.ts"]),
  rm.changedFiles
);
check("sessionCount 1", rm.sessionCount === 1, rm.sessionCount);
check("turnCount 2", rm.turnCount === 2, rm.turnCount);

// 결정 서사 3요소가 모두 채워짐 (Phase 2 성공 기준)
check(
  "3요소 모두 채워짐",
  rm.userPrompts.length > 0 && rm.assistantTexts.length > 0 && rm.toolSequence.length > 0
);

// thinking 스킵: 빈 텍스트 항목 없음
check("빈 텍스트 미포함(thinking 스킵)", rm.assistantTexts.every((t) => t.text.length > 0));

// 날짜 필터: 05-31 라인 제외
const allText = [...rm.userPrompts, ...rm.assistantTexts].map((m) => m.text).join(" ");
check("전날(05-31) 라인 제외", !allText.includes("제외돼야") && !allText.includes("포함되면 안"));

// 통계
check("JSON 실패 1건 집계", rm.stats.jsonFailures === 1, rm.stats.jsonFailures);
check("미관측 type telemetry 집계", rm.stats.unknownTypes["telemetry"] === 1, rm.stats.unknownTypes);
check("known 무시 type은 unknown 미집계", rm.stats.unknownTypeLines === 1, rm.stats.unknownTypeLines);
check("정상 포맷이라 경고 없음", rm.warnings.length === 0, rm.warnings);

console.log("\n[assessFormat]");
const health = assessFormat(rm.stats);
check("포맷 healthy", health.ok === true, health);

console.log("\n[parseLines · 본문 없는 날짜는 빈 결과]");
const empty = parseLines(lines, { date: "2099-01-01", projectLabel: "proj" });
check("빈 날짜 → 프롬프트 0", empty.userPrompts.length === 0);
check("빈 날짜 → 도구 0", empty.toolSequence.length === 0);

console.log("\n[포맷 변동 감지]");
const bad = parseLines(
  ["nope", "also bad", '{"type":"weird1"}', '{"type":"weird2"}', '{"type":"user"}'],
  { date: "2026-06-01", projectLabel: "proj" }
);
check("불량 입력 → 경고 발생", bad.warnings.length > 0, bad.warnings);

console.log("\n[projectPaths]");
check(
  "슬래시→하이픈 인코딩",
  encodeProjectSlug("/Users/dev/proj") === "-Users-dev-proj",
  encodeProjectSlug("/Users/dev/proj")
);
check("점 포함 경로 → 부가 후보 생성", candidateSlugs("/Users/dev/my.app").length === 2, candidateSlugs("/Users/dev/my.app"));
const projects = [
  { slug: "-Users-dev-proj", dir: "/home/.claude/projects/-Users-dev-proj" },
  { slug: "-Users-dev-other", dir: "/home/.claude/projects/-Users-dev-other" },
];
check("워크스페이스 자동 매칭", matchProject("/Users/dev/proj", projects)?.slug === "-Users-dev-proj");
check("매칭 실패 시 undefined(수동 폴백)", matchProject("/Users/dev/nope", projects) === undefined);

console.log(`\n${failures === 0 ? "ALL PASS ✅" : `FAILURES: ${failures} ❌`}`);
process.exit(failures === 0 ? 0 : 1);
