/**
 * Phase 5 end-to-end(비 VSCode) 검증: 파싱 → 2단 runRecap → 렌더 → 기록.
 * 실행: node --experimental-strip-types --import ./test/register-ts.mjs test/e2e.test.ts
 */
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import { fileURLToPath } from "node:url";
import { parseLines } from "../src/readers/sessionReader.ts";
import { runRecap } from "../src/llm/recapRunner.ts";
import { renderMarkdown } from "../src/preview/render.ts";
import { LocalSink } from "../src/sinks/index.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = fsSync.readFileSync(path.join(here, "fixtures", "sample-session.jsonl"), "utf8");
const rm = parseLines(fixture.split(/\r?\n/), { date: "2026-06-01", projectLabel: "dev-funnel" });

const RECAP = `# 2026-06-01 · dev-funnel 의사결정 recap

> **오늘 한 줄**: 버스트 제어를 위해 토큰 버킷 레이트리미터를 채택했다.

## 오늘 어떤 결정을 내렸나?

토큰 버킷 방식을 선택했다 ("토큰 버킷으로 가자" — P2).

- 토큰 버킷 채택 (capacity 10, refill 1/s)

## 그 결정을 왜 그렇게 내렸나? (맥락과 판단)

- **트리거** — "버스트 처리가 중요하니까" (P2)
- **고려한 대안** — 고정 윈도우 (경계 버스트 우려로 기각, A1)

## 그 결정으로 어떤 결과를 얻었나?

| 무엇 | 결과 |
|---|---|
| 테스트 | 4 passed |

## 막혔거나 의외였던 점은?

이번 세션에서는 측정되지 않음.

## 내일/다음에 이어서 볼 것은?

미들웨어 통합 검증.
`;

const fakeProvider: any = {
  name: "fake",
  async complete() {
    return { text: '{"decisions":[{"statement":"토큰 버킷 채택","cite":["P2"]}]}', citations: [], stopReason: "end_turn" };
  },
  async stream(_req: any, onDelta: (t: string) => void) {
    for (const chunk of RECAP.match(/.{1,40}/gs) ?? [RECAP]) {
      onDelta(chunk);
    }
    return { text: RECAP, citations: [], stopReason: "end_turn" };
  },
};

const tmp = path.join(os.tmpdir(), `dr-e2e-${Date.now()}`);

console.log("[e2e · 파싱→runRecap→렌더→기록]");
let streamed = "";
const out = await runRecap(fakeProvider, rm, { model: "claude-sonnet-4-6", lang: "ko", onDelta: (t) => (streamed += t) });

check("recap 생성됨", out.recap.includes("의사결정 recap"));
check("스트리밍 누적 == 최종", streamed === out.recap);

const html = renderMarkdown(out.recap);
const sections = ["오늘 어떤 결정을 내렸나?", "왜 그렇게 내렸나", "어떤 결과를 얻었나?", "막혔거나 의외였던", "이어서 볼 것은?"];
check("렌더 HTML에 4축 섹션 모두 존재", sections.every((s) => html.includes(s)), sections.filter((s) => !html.includes(s)));
check("렌더에 결과 표 포함", html.includes("<table>") && html.includes("<td>4 passed</td>"));

const sink = new LocalSink(path.join(tmp, "recaps"));
const res = await sink.append(out.recap, "2026-06-01");
const written = await fs.readFile(res.path, "utf8");
check("기록 파일 생성", res.created === true);
check("기록 내용 일치", written.includes("토큰 버킷 채택"));
check("경로 규칙 준수", res.path.endsWith(path.join("2026", "06", "01-recap.md")));

await fs.rm(tmp, { recursive: true, force: true });

console.log(`\n${failures === 0 ? "ALL PASS ✅" : `FAILURES: ${failures} ❌`}`);
process.exit(failures === 0 ? 0 : 1);
