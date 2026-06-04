/**
 * Phase 5 검증. 실행: node --experimental-strip-types --import ./test/register-ts.mjs test/sink.test.ts
 */
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { LocalSink, ObsidianSink, makeSink, dateParts } from "../src/sinks/index.ts";
import { renderMarkdown, renderInline, getWebviewHtml } from "../src/preview/render.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  }
}

const tmp = path.join(os.tmpdir(), `dr-sink-${Date.now()}`);

console.log("[sinks · 경로]");
const local = new LocalSink(path.join(tmp, "recaps"));
check("LocalSink 경로 YYYY/MM/DD-recap.md", local.filePathFor("2026-06-01").endsWith(path.join("2026", "06", "01-recap.md")));
const obs = new ObsidianSink(path.join(tmp, "vault"));
check("ObsidianSink 경로 _Recap/YYYY/MM/DD.md", obs.filePathFor("2026-06-01").endsWith(path.join("_Recap", "2026", "06", "01.md")));

console.log("\n[sinks · append/dedup]");
const r1 = await local.append("# recap A\n내용1", "2026-06-01");
check("새 파일 생성", r1.created === true && r1.appended === false);
check("파일 실제 존재", (await fs.readFile(r1.path, "utf8")).includes("recap A"));

const r2 = await local.append("# recap A\n내용1", "2026-06-01");
check("동일 내용 → skip", r2.skipped === true);

const r3 = await local.append("# recap B\n내용2", "2026-06-01");
const merged = await fs.readFile(r3.path, "utf8");
check("다른 내용 → append", r3.appended === true);
check("구분선 포함", merged.includes("---"));
check("두 recap 모두 보존", merged.includes("recap A") && merged.includes("recap B"));

const ro = await obs.append("# recap O", "2026-06-01");
const obody = await fs.readFile(ro.path, "utf8");
check("Obsidian frontmatter 생성", obody.startsWith("---\ndate: 2026-06-01") && obody.includes("tags: [recap, dailyrecap]"));

console.log("\n[sinks · 팩토리/검증]");
check("makeSink local", makeSink("local", { outputDir: tmp }).name === "local");
let notionThrew = false;
try {
  makeSink("notion", {});
} catch {
  notionThrew = true;
}
check("notion → 미구현 throw", notionThrew);
let badDate = false;
try {
  dateParts("2026/06/01");
} catch {
  badDate = true;
}
check("잘못된 날짜 형식 throw", badDate);
let noVault = false;
try {
  new ObsidianSink("");
} catch {
  noVault = true;
}
check("vault 미설정 throw", noVault);

console.log("\n[render · markdown→HTML]");
check("h1", renderMarkdown("# 제목").includes("<h1>제목</h1>"));
check("h2", renderMarkdown("## 소제목").includes("<h2>소제목</h2>"));
check("bold", renderInline("**굵게**") === "<strong>굵게</strong>");
check("italic", renderInline("*기울임*") === "<em>기울임</em>");
check("code", renderInline("`코드`") === "<code>코드</code>");
check("link", renderInline("[링크](https://x.io)") === '<a href="https://x.io">링크</a>');
check("HTML escape", renderInline("<script>alert(1)</script>").includes("&lt;script&gt;"));
check("목록", renderMarkdown("- 항목1\n- 항목2").includes("<ul><li>항목1</li><li>항목2</li></ul>"));
check("인용", renderMarkdown("> 오늘 한 줄").includes("<blockquote>오늘 한 줄</blockquote>"));
check("수평선", renderMarkdown("내용\n\n---\n\n다음").includes("<hr>"));
const table = renderMarkdown("| 무엇 | 결과 |\n|---|---|\n| 파일 | 2개 |");
check("표 헤더", table.includes("<th>무엇</th>") && table.includes("<th>결과</th>"));
check("표 본문", table.includes("<td>파일</td>") && table.includes("<td>2개</td>"));

console.log("\n[render · 웹뷰 HTML/CSP]");
const html = getWebviewHtml("<h1>x</h1>", { nonce: "N0NCE", cspSource: "vscode-resource:" });
check("CSP 포함", html.includes("Content-Security-Policy") && html.includes("'nonce-N0NCE'"));
check("본문 임베드", html.includes("<h1>x</h1>"));
check("style nonce", html.includes('<style nonce="N0NCE">'));

await fs.rm(tmp, { recursive: true, force: true });

console.log(`\n${failures === 0 ? "ALL PASS ✅" : `FAILURES: ${failures} ❌`}`);
process.exit(failures === 0 ? 0 : 1);
