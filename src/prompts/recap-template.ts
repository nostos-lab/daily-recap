import type { RawMaterial } from "../types";
import { maskSensitive } from "./masking";

/**
 * recap 프롬프트 템플릿 (PRD §6.3 — 핵심).
 * 순수 함수만 둔다(테스트·튜닝 용이). LLM 호출은 Phase 4.
 *
 * 2단 호출 설계:
 *   stage 1 = buildExtractionPrompt  → (Citations API) 인용·결정·수치 추출
 *   stage 2 = buildRecapPrompt       → 최종 recap 마크다운 생성(§6.4 골격)
 * (Citations API와 Structured Outputs는 같은 호출에서 못 켠다 — 400. §6.3)
 */

export type Lang = "ko" | "en";

export function resolveLang(setting: string | undefined, ideLocale?: string): Lang {
  if (setting === "ko" || setting === "en") {
    return setting;
  }
  // auto: IDE 로케일을 따름
  return (ideLocale ?? "").toLowerCase().startsWith("ko") ? "ko" : "en";
}

export interface PromptPair {
  system: string;
  user: string;
}

export interface SourceBlock {
  tag: string;
  label: string;
  content: string;
}

function hhmmss(ts?: string): string {
  if (!ts) {
    return "??:??:??";
  }
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) {
    return "??:??:??";
  }
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function clip(s: string, max = 1500): string {
  return s.length > max ? s.slice(0, max) + " …(생략)" : s;
}

function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  const fp = input.file_path ?? input.notebook_path;
  if (typeof fp === "string") {
    return fp;
  }
  if (name === "Bash" && typeof input.command === "string") {
    return input.command;
  }
  if (typeof input.pattern === "string") {
    return input.pattern;
  }
  try {
    return clip(JSON.stringify(input), 300);
  } catch {
    return "(직렬화 불가)";
  }
}

/**
 * RawMaterial → 출처 태깅된 소스 블록. 마스킹 적용.
 * 태그: P=사용자 프롬프트, A=assistant 텍스트, T=도구 호출, R=도구 결과.
 * Phase 4에서 이 블록을 Citations 문서로 매핑한다.
 */
export function buildSourceBlocks(rm: RawMaterial): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  rm.userPrompts.forEach((m, i) =>
    blocks.push({
      tag: `P${i + 1}`,
      label: `사용자 프롬프트 @${hhmmss(m.timestamp)}`,
      content: maskSensitive(clip(m.text)),
    })
  );
  rm.assistantTexts.forEach((m, i) =>
    blocks.push({
      tag: `A${i + 1}`,
      label: `assistant 텍스트 @${hhmmss(m.timestamp)}`,
      content: maskSensitive(clip(m.text)),
    })
  );
  rm.toolSequence.forEach((t, i) =>
    blocks.push({
      tag: `T${i + 1}`,
      label: `도구 호출 ${t.name} @${hhmmss(t.timestamp)}`,
      content: maskSensitive(summarizeToolInput(t.name, t.input)),
    })
  );
  rm.toolResults.forEach((r, i) =>
    blocks.push({
      tag: `R${i + 1}`,
      label: `도구 결과 @${hhmmss(r.timestamp)}`,
      content: maskSensitive(clip(r.text, 500)),
    })
  );
  return blocks;
}

export function renderSources(blocks: SourceBlock[]): string {
  return blocks.map((b) => `[${b.tag}] (${b.label})\n${b.content}`).join("\n\n");
}

function factsLine(rm: RawMaterial): string {
  const files = rm.changedFiles.length;
  return `날짜=${rm.date} · 프로젝트=${rm.project} · 사용자 턴=${rm.turnCount} · 세션=${rm.sessionCount} · 변경/참조 파일=${files}개`;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Stage 1: 추출 프롬프트 (Citations API)                                    */
/* ──────────────────────────────────────────────────────────────────────── */

const EXTRACTION_SYSTEM: Record<Lang, string> = {
  ko: `당신은 개발자의 AI 코딩 세션 로그에서 "의사결정 서사"의 재료를 추출하는 분석가다.
규칙:
1) 근거는 오직 제공된 원재료(사용자 프롬프트·assistant 텍스트·도구 호출/결과)에서만 가져온다. 원재료에 없는 사실·수치·결정을 지어내지 않는다.
2) 결정(decision)으로 단정할 수 있는 것은 사용자가 "명시적으로 선택하거나 지시한 것"뿐이다(암묵적 수용 가드레일). 모호하면 결정으로 올리지 말고 맥락(context)으로만 남긴다.
3) 모든 항목에는 출처 태그(예: P1, A2, T3, R1)를 단다. 출처가 없으면 그 항목을 만들지 않는다.
4) 수치·결과는 원재료에 실제로 등장한 경우에만 적는다. 없으면 "기록되지 않음".
출력은 아래 JSON 한 개만. 설명 산문 금지.`,
  en: `You analyze a developer's AI coding session log to extract the raw material of a "decision narrative".
Rules:
1) Ground every item ONLY in the provided source material (user prompts, assistant text, tool calls/results). Never invent facts, numbers, or decisions absent from the sources.
2) Only treat something as a "decision" if the user EXPLICITLY chose or instructed it (implicit-acceptance guardrail). If ambiguous, record it as context, not a decision.
3) Attach a source tag (e.g., P1, A2, T3, R1) to every item. If there is no source, do not create the item.
4) Record numbers/results only if they actually appear in the sources. Otherwise "not recorded".
Output exactly one JSON object below. No prose.`,
};

function extractionSchemaHint(lang: Lang): string {
  const note =
    lang === "ko"
      ? "// 각 항목의 cite는 출처 태그 배열. 비어 있으면 항목을 생성하지 말 것."
      : "// 'cite' is an array of source tags. Do not emit an item with empty cite.";
  return `${note}
{
  "decisions": [{ "statement": "", "cite": ["P1"] }],
  "context":   [{ "note": "", "cite": ["A1"] }],
  "alternatives": [{ "option": "", "rejected_because": "", "cite": [] }],
  "results":   [{ "what": "", "value": "", "cite": ["R1"] }],
  "surprises": [{ "note": "", "cite": [] }],
  "next":      [{ "item": "", "cite": [] }]
}`;
}

export function buildExtractionPrompt(rm: RawMaterial, lang: Lang): PromptPair {
  const intro =
    lang === "ko"
      ? `다음은 ${factsLine(rm)} 의 세션 원재료다. 위 규칙대로 JSON을 추출하라.`
      : `Below is the session material for ${factsLine(rm)}. Extract JSON per the rules.`;
  const schemaLabel = lang === "ko" ? "출력 JSON 스키마:" : "Output JSON schema:";
  const srcLabel = lang === "ko" ? "원재료:" : "Source material:";
  const user = `${intro}

${schemaLabel}
${extractionSchemaHint(lang)}

${srcLabel}
${renderSources(buildSourceBlocks(rm))}`;
  return { system: EXTRACTION_SYSTEM[lang], user };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Stage 2: recap 생성 프롬프트                                              */
/* ──────────────────────────────────────────────────────────────────────── */

/** §6.4 출력 골격. recap-skeleton.md와 동기화(테스트로 보장). */
export const RECAP_SKELETON = `# {YYYY-MM-DD} · {프로젝트명} 의사결정 recap

> **오늘 한 줄**: {그날 가장 중요한 결정 1개를 25단어 이내로}

## 오늘 어떤 결정을 내렸나?

{40~75단어 자기완결 단락. 사용자 프롬프트 verbatim 인용 가능하면 출처와 함께.}

- {결정 1 — 한 줄}
- {결정 2 — 한 줄}

## 그 결정을 왜 그렇게 내렸나? (맥락과 판단)

{각 주요 결정에 대해 Y-Statement로:
"~한 맥락에서, ~를 우려해, ~를 택했고, ~를 감수했다."}

- **트리거** — {세션/커밋에서 가져온 짧은 verbatim 인용 + 출처}
- **고려한 대안** — {등장한 대안과 기각 이유. 없으면 "기록되지 않음"}

## 그 결정으로 어떤 결과를 얻었나?

{40~75단어. 구체 결과를 우선: 변경 파일 수, 통과한 테스트, 해결한 에러, 소요 시간. 없으면 "이번 세션에서는 측정되지 않음".}

| 무엇 | 결과 |
|---|---|
| {항목} | {결과/수치} |

## 막혔거나 의외였던 점은?

{40~75단어. 잘못된 가정을 중간에 바로잡은 것, API 함정 등. verbatim 인용 + 출처.}

## 내일/다음에 이어서 볼 것은?

{40~75단어. 구체적 다음 행동. 불명확하면 열린 질문 1~2개.}

---
*기록: {YYYY-MM-DD} · 세션 {N}턴 · 커밋 {N}개 · DailyRecap 자동 생성*
`;

const RECAP_SYSTEM: Record<Lang, string> = {
  ko: `당신은 개발자의 하루 코딩 세션을 "의사결정 회고(recap)"로 정리하는 회고 편집자다.
반드시 지킬 것:
1) 아래 골격(템플릿)의 제목·섹션·순서·표를 그대로 따른다. 섹션을 추가/삭제하지 않는다.
2) 결정은 사용자가 명시적으로 선택/지시한 것만 단정한다(암묵적 수용 가드레일). 모호한 것은 맥락으로만.
3) 원재료(출처 태그가 달린 소스)에 없는 사실·수치·인용을 지어내지 않는다. 없으면 골격이 지시한 "기록되지 않음"/"측정되지 않음"을 쓴다.
4) 각 결정의 '왜'는 Y-Statement로: "~한 맥락에서, ~를 우려해, ~를 택했고, ~를 감수했다."
5) verbatim 인용에는 출처 태그(P/A/T/R)를 괄호로 덧붙인다. 예: ("…" — P1)
6) 분량 가이드(섹션별 40~75단어, 오늘 한 줄 25단어 이내)를 지킨다.
출력은 채워진 마크다운 recap 한 편만. 코드펜스로 감싸지 말 것.`,
  en: `You are a retrospective editor who turns a developer's day of coding into a "decision recap".
Rules:
1) Follow the skeleton below exactly — same title, sections, order, and table. Do not add or remove sections.
2) Assert a decision only if the user explicitly chose/instructed it (implicit-acceptance guardrail). Ambiguous items go in context only.
3) Never invent facts, numbers, or quotes absent from the tagged source material. If missing, use the skeleton's "not recorded"/"not measured".
4) Each "why" uses a Y-Statement: "In the context of X, concerned about Y, we chose Z, accepting trade-off W."
5) Attach source tags (P/A/T/R) in parentheses to verbatim quotes, e.g., ("…" — P1).
6) Respect length guidance (40–75 words per section; one-liner under 25 words).
Output only the filled markdown recap. Do not wrap it in a code fence.`,
};

export function buildRecapPrompt(rm: RawMaterial, extractionResult: string, lang: Lang): PromptPair {
  const intro =
    lang === "ko"
      ? `대상: ${factsLine(rm)}. 아래 추출 결과와 원재료만 근거로, 골격을 채운 recap을 ${lang === "ko" ? "한국어" : ""}로 작성하라.`
      : `Target: ${factsLine(rm)}. Using only the extraction and source material, fill the skeleton in English.`;
  const skLabel = lang === "ko" ? "골격(이 형식을 그대로 따를 것):" : "Skeleton (follow this exactly):";
  const exLabel = lang === "ko" ? "stage1 추출 결과(JSON):" : "Stage-1 extraction (JSON):";
  const srcLabel = lang === "ko" ? "원재료(출처 태그 포함):" : "Source material (tagged):";
  const user = `${intro}

${skLabel}
${RECAP_SKELETON}

${exLabel}
${extractionResult || "(추출 결과 없음 — 원재료에서 직접 작성하되 규칙 준수)"}

${srcLabel}
${renderSources(buildSourceBlocks(rm))}`;
  return { system: RECAP_SYSTEM[lang], user };
}
