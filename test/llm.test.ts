/**
 * Phase 4 검증. 실행: node --experimental-strip-types --import ./test/register-ts.mjs test/llm.test.ts
 * 실제 네트워크 호출 없이 주입형 fetch로 검증.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { estimateTokens, enforceBudget } from "../src/llm/budget.ts";
import { LLMError, fromStatus, fromNetwork } from "../src/llm/errors.ts";
import { AnthropicProvider } from "../src/llm/anthropic.ts";
import { getProvider } from "../src/llm/providers.ts";
import { runRecap } from "../src/llm/recapRunner.ts";
import { parseLines } from "../src/readers/sessionReader.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(here, "fixtures", "sample-session.jsonl"), "utf8");
const rm = parseLines(fixture.split(/\r?\n/), { date: "2026-06-01", projectLabel: "dev-funnel" });

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  }
}

function sseResponse(events: any[]) {
  const text = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  const size = Math.max(1, Math.ceil(bytes.length / 6)); // 일부러 이벤트 경계를 가로질러 분할
  let i = 0;
  return {
    ok: true,
    body: {
      getReader() {
        return {
          read() {
            if (i >= bytes.length) return Promise.resolve({ done: true, value: undefined });
            const chunk = bytes.slice(i, i + size);
            i += size;
            return Promise.resolve({ done: false, value: chunk });
          },
        };
      },
    },
  };
}

console.log("[budget]");
check("estimateTokens 대략 len/3", estimateTokens("abcdef") === 2, estimateTokens("abcdef"));
const blocks = [
  { tag: "P1", label: "u", content: "X".repeat(300) },
  { tag: "A1", label: "a", content: "Y".repeat(300) },
  { tag: "T1", label: "t", content: "Z".repeat(300) },
  { tag: "R1", label: "r", content: "W".repeat(300) },
  { tag: "R2", label: "r", content: "Q".repeat(300) },
];
const b1 = enforceBudget(blocks, 250);
check("예산 초과 시 R→T부터 제외", JSON.stringify(b1.droppedTags) === JSON.stringify(["R2", "R1", "T1"]), b1.droppedTags);
check("P/A는 보존", JSON.stringify(b1.blocks.map((b) => b.tag)) === JSON.stringify(["P1", "A1"]), b1.blocks.map((b) => b.tag));
check("원본 불변(droppedTags 반영)", blocks.length === 5);
const b2 = enforceBudget([{ tag: "P1", label: "u", content: "X".repeat(3000) }], 100);
check("P만 남아도 초과 시 클립", b2.truncated === true && b2.blocks[0].content.length < 3000, b2.blocks[0].content.length);

console.log("\n[errors]");
check("401→auth + setApiKey", (() => { const e = fromStatus(401); return e.kind === "auth" && e.action === "recap.setApiKey"; })());
check("429→rate_limit + retryable", (() => { const e = fromStatus(429); return e.kind === "rate_limit" && e.retryable; })());
check("400→bad_request", fromStatus(400).kind === "bad_request");
check("500→server + retryable", (() => { const e = fromStatus(500); return e.kind === "server" && e.retryable; })());
check("network 분류", fromNetwork(new Error("ECONNREFUSED")).kind === "network");

console.log("\n[AnthropicProvider.complete]");
const calls: any[] = [];
const completeFetch = async (url: string, init: any) => {
  calls.push({ url, init });
  return {
    ok: true,
    json: async () => ({
      content: [{ type: "text", text: '{"decisions":[]}', citations: [{ cited_text: "레이트리미터", document_title: "P1" }] }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
  };
};
const cp = new AnthropicProvider({ apiKey: "secret-key", fetchImpl: completeFetch });
const cres = await cp.complete({ model: "m1", system: "s", maxTokens: 100, messages: [{ role: "user", content: "hi" }] });
check("complete 텍스트 추출", cres.text === '{"decisions":[]}');
check("complete citations 추출", cres.citations.length === 1 && cres.citations[0].citedText === "레이트리미터");
check("엔드포인트 /v1/messages", String(calls[0].url).endsWith("/v1/messages"));
check("x-api-key 헤더", calls[0].init.headers["x-api-key"] === "secret-key");
check("anthropic-version 헤더", calls[0].init.headers["anthropic-version"] === "2023-06-01");
check("body: stream=false, model 반영", (() => { const b = JSON.parse(calls[0].init.body); return b.stream === false && b.model === "m1"; })());

console.log("\n[AnthropicProvider.stream]");
const scap: any[] = [];
const streamFetch = async (_url: string, init: any) => {
  scap.push(init);
  return sseResponse([
    { type: "message_start", message: { usage: { input_tokens: 50 } } },
    { type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } },
    { type: "content_block_delta", delta: { type: "text_delta", text: "world" } },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } },
  ]);
};
const sp = new AnthropicProvider({ apiKey: "k", fetchImpl: streamFetch });
let acc = "";
const sres = await sp.stream({ model: "m", system: "s", maxTokens: 100, messages: [{ role: "user", content: "hi" }] }, (t) => (acc += t));
check("delta 누적", acc === "Hello world", acc);
check("stream 최종 텍스트", sres.text === "Hello world");
check("stop_reason 파싱", sres.stopReason === "end_turn");
check("usage 파싱(in/out)", sres.usage?.input === 50 && sres.usage?.output === 7, sres.usage);
check("body: stream=true", JSON.parse(scap[0].body).stream === true);

console.log("\n[error 응답 매핑]");
let threw: any;
try {
  await new AnthropicProvider({ apiKey: "k", fetchImpl: async () => ({ ok: false, status: 401, text: async () => "invalid" }) }).complete({
    model: "m", system: "s", maxTokens: 10, messages: [{ role: "user", content: "x" }],
  });
} catch (e) {
  threw = e;
}
check("401 응답→LLMError auth", threw instanceof LLMError && threw.kind === "auth");

console.log("\n[providers 팩토리]");
check("anthropic 생성", getProvider({ provider: "anthropic", apiKey: "k", fetchImpl: completeFetch }).name === "anthropic");
let stubThrew: any;
try {
  await getProvider({ provider: "openai", apiKey: "" }).complete({ model: "m", system: "", maxTokens: 1, messages: [] });
} catch (e) {
  stubThrew = e;
}
check("openai stub→NotImplemented", stubThrew instanceof LLMError);
let unknownThrew = false;
try {
  getProvider({ provider: "xyz", apiKey: "" });
} catch {
  unknownThrew = true;
}
check("알 수 없는 provider→throw", unknownThrew);

console.log("\n[runRecap · 2단 흐름]");
const fake: any = {
  name: "fake",
  calls: [],
  async complete(req: any) {
    this.calls.push({ stage: "complete", req });
    return { text: '{"decisions":[{"statement":"토큰 버킷 채택","cite":["P2"]}]}', citations: [{ citedText: "토큰 버킷", documentTitle: "P2" }], stopReason: "end_turn" };
  },
  async stream(req: any, onDelta: (t: string) => void) {
    this.calls.push({ stage: "stream", req });
    onDelta("# recap ");
    onDelta("본문");
    return { text: "# recap 본문", citations: [], stopReason: "end_turn" };
  },
};
let streamed = "";
const out = await runRecap(fake, rm, { model: "m", lang: "ko", useCitations: true, onDelta: (t) => (streamed += t) });
check("최종 recap 반환", out.recap === "# recap 본문");
check("스트리밍 델타 전달", streamed === "# recap 본문");
check("추출 결과 포함", out.extraction.includes("토큰 버킷 채택"));
check("citations 전달", out.citations.length === 1);
check("호출 순서 complete→stream", fake.calls[0].stage === "complete" && fake.calls[1].stage === "stream");
const stage1Content = fake.calls[0].req.messages[0].content;
check("stage1: document 블록 첨부", Array.isArray(stage1Content) && stage1Content.some((b: any) => b.type === "document" && b.citations?.enabled === true));
check("stage1: 텍스트 지시문 동봉", Array.isArray(stage1Content) && stage1Content.some((b: any) => b.type === "text"));
check("stage2: 프롬프트에 추출 결과 주입", String(fake.calls[1].req.messages[0].content).includes("토큰 버킷 채택"));

console.log("\n[runRecap · 입력 예산 경고]");
const rmBig = parseLines(
  [JSON.stringify({ type: "user", uuid: "1", sessionId: "s", timestamp: "2026-06-01T10:00:00Z", message: { role: "user", content: "X".repeat(5000) } })],
  { date: "2026-06-01", projectLabel: "p" }
);
const outBig = await runRecap(fake, rmBig, { model: "m", lang: "ko", useCitations: false, maxInputTokens: 50 });
check("예산 초과 경고 추가", outBig.warnings.some((w) => w.includes("입력이 커서")), outBig.warnings);

console.log(`\n${failures === 0 ? "ALL PASS ✅" : `FAILURES: ${failures} ❌`}`);
process.exit(failures === 0 ? 0 : 1);
