/**
 * Phase 3 검증. 실행: node --experimental-strip-types test/prompt.test.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLines } from "../src/readers/sessionReader.ts";
import { maskSensitive } from "../src/prompts/masking.ts";
import {
  resolveLang,
  buildExtractionPrompt,
  buildRecapPrompt,
  buildSourceBlocks,
  renderSources,
  RECAP_SKELETON,
} from "../src/prompts/recap-template.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(here, "fixtures", "sample-session.jsonl"), "utf8");
const rm = parseLines(fixture.split(/\r?\n/), { date: "2026-06-01", projectLabel: "dev-funnel" });

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  }
}

console.log("[masking · §6.8]");
check("이메일 마스킹", maskSensitive("연락처 arbor8207@gmail.com 입니다").includes("[REDACTED_EMAIL]"));
check("이메일 원문 제거", !maskSensitive("arbor8207@gmail.com").includes("gmail"));
check("Anthropic 키 마스킹", maskSensitive("sk-ant-api03-AbC123def456GhI789").includes("[REDACTED_KEY]"));
check("OpenAI 키 마스킹", maskSensitive("sk-proj1234567890abcdefABCDEF12").includes("[REDACTED_KEY]"));
check("JWT 마스킹", maskSensitive("token eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NTY.SflKxwRJSMeKKF2QT").includes("[REDACTED_JWT]"));
check("할당식 password 마스킹", /password\s*=\s*"\[REDACTED\]"/.test(maskSensitive('password="hunter2secret"')));
check("Bearer 토큰 마스킹", maskSensitive("Authorization: Bearer abcdef123456ghijkl").includes("[REDACTED_TOKEN]"));
check("일반 텍스트는 보존", maskSensitive("토큰 버킷으로 가자") === "토큰 버킷으로 가자");

console.log("\n[skeleton ↔ recap-skeleton.md 동기화]");
const mdFile = fs.readFileSync(path.join(here, "..", "src", "prompts", "recap-skeleton.md"), "utf8");
check("RECAP_SKELETON == recap-skeleton.md", mdFile.trim() === RECAP_SKELETON.trim());

console.log("\n[buildRecapPrompt · 4축 구조 강제]");
const recap = buildRecapPrompt(rm, "{}", "ko");
const sections = [
  "어떤 결정을 내렸나?",
  "왜 그렇게 내렸나?",
  "어떤 결과를 얻었나?",
  "막혔거나 의외였던 점은?",
  "다음에 이어서 볼 것은?",
];
for (const s of sections) {
  check(`섹션 지시 포함: ${s}`, recap.user.includes(s));
}
check("오늘 한 줄 포함", recap.user.includes("오늘 한 줄"));
check("주제 블록 포함", recap.user.includes("## 주제:"));
check("결과 표 포함", recap.user.includes("| 무엇 | 결과 |"));
check("system: Y-Statement 강제", recap.system.includes("Y-Statement"));
check("system: anti-hallucination", recap.system.includes("지어내지 않는다"));
check("system: 암묵적 수용 가드레일", recap.system.includes("암묵적 수용"));
check("system: 골격 그대로", recap.system.includes("골격"));
check("system: 주제 세그멘테이션 규칙", recap.system.includes("작업 주제") && recap.system.includes("반복"));

console.log("\n[buildRecapPrompt · 영어 골격]");
const recapEn = buildRecapPrompt(rm, "{}", "en");
check("en: 영어 주제 헤더", recapEn.user.includes("## Topic:"));
check("en: 영어 섹션 헤더", recapEn.user.includes("What decisions were made?") && recapEn.user.includes("What result did it produce?"));
check("en: 한국어 헤더 미포함", !recapEn.user.includes("## 주제:") && !recapEn.user.includes("어떤 결정을 내렸나?"));
check("en: system 영어 세그멘테이션 규칙", recapEn.system.includes("Segment the day"));

console.log("\n[buildExtractionPrompt · Citations용]");
const ext = buildExtractionPrompt(rm, "ko");
check("system: 지어내기 금지", ext.system.includes("지어내지 않는다"));
check("system: 암묵적 수용 가드레일", ext.system.includes("암묵적 수용"));
check("user: JSON 스키마 포함", ext.user.includes('"decisions"'));
check("user: 출처 태그 P1 포함", ext.user.includes("[P1]"));
check("user: 도구 태그 T1 포함", ext.user.includes("[T1]"));

console.log("\n[source blocks]");
const blocks = buildSourceBlocks(rm);
const tags = blocks.map((b) => b.tag);
check("프롬프트/텍스트/도구/결과 태그 모두 존재", ["P1", "A1", "T1", "R1"].every((t) => tags.includes(t)), tags);
check("변경 파일이 도구 소스에 반영", renderSources(blocks).includes("rateLimiter.ts"));

console.log("\n[source 마스킹 적용]");
const sensitive = parseLines(
  [
    JSON.stringify({
      type: "user",
      sessionId: "s",
      uuid: "1",
      timestamp: "2026-06-01T10:00:00Z",
      message: { role: "user", content: "내 키는 sk-ant-api03-SECRET1234567890 이고 메일은 me@example.com" },
    }),
  ],
  { date: "2026-06-01", projectLabel: "p" }
);
const rendered = renderSources(buildSourceBlocks(sensitive));
check("소스 직렬화 시 키 마스킹", rendered.includes("[REDACTED_KEY]") && !rendered.includes("SECRET1234567890"));
check("소스 직렬화 시 이메일 마스킹", rendered.includes("[REDACTED_EMAIL]"));

console.log("\n[resolveLang]");
check("auto + ko 로케일 → ko", resolveLang("auto", "ko-KR") === "ko");
check("auto + en 로케일 → en", resolveLang("auto", "en-US") === "en");
check("명시 ko → ko", resolveLang("ko", "en-US") === "ko");

console.log(`\n${failures === 0 ? "ALL PASS ✅" : `FAILURES: ${failures} ❌`}`);
process.exit(failures === 0 ? 0 : 1);
