import type { RawMaterial } from "../types";
import type { LLMProvider, CitationRef } from "./types";
import type { Lang, SourceBlock } from "../prompts/recap-template";
import {
  buildSourceBlocks,
  buildCitationDocuments,
  buildExtractionInstruction,
  buildExtractionPrompt,
  buildRecapPrompt,
} from "../prompts/recap-template";
import { enforceBudget } from "./budget";

/**
 * 2단 호출 오케스트레이션 (PRD §6.3, §6.5).
 *   stage 1: Citations API로 인용·결정·수치 추출 (비스트리밍)
 *   stage 2: recap 마크다운 생성 (스트리밍)
 * Citations와 Structured Outputs를 같은 호출에서 켜지 않는다(400 회피). 추출은 JSON을 텍스트로 받는다.
 */

const DEFAULT_MAX_INPUT_TOKENS = 150000;
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

export interface RunOptions {
  model: string;
  lang: Lang;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  /** false면 인라인 텍스트 추출(Citations 미사용) */
  useCitations?: boolean;
  onDelta?: (chunk: string) => void;
  signal?: AbortSignal;
}

export interface PreparedInput {
  blocks: SourceBlock[];
  estTokens: number;
  droppedTags: string[];
  truncated: boolean;
}

export interface RunResult {
  recap: string;
  extraction: string;
  citations: CitationRef[];
  estInputTokens: number;
  droppedTags: string[];
  warnings: string[];
}

/** 호출 전 입력 준비 + 예산 적용(대략 토큰 규모 표시용). */
export function prepareInputs(rm: RawMaterial, maxInputTokens = DEFAULT_MAX_INPUT_TOKENS): PreparedInput {
  const budget = enforceBudget(buildSourceBlocks(rm), maxInputTokens);
  return {
    blocks: budget.blocks,
    estTokens: budget.estTokens,
    droppedTags: budget.droppedTags,
    truncated: budget.truncated,
  };
}

export async function runRecap(provider: LLMProvider, rm: RawMaterial, opts: RunOptions): Promise<RunResult> {
  const warnings = [...rm.warnings];
  const maxOut = opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const prepared = prepareInputs(rm, opts.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS);
  if (prepared.truncated) {
    warnings.push(
      `입력이 커서 일부 소스를 줄였습니다(추정 ${prepared.estTokens} 토큰, 제외 ${prepared.droppedTags.length}개).`
    );
  }
  const blocks = prepared.blocks;

  // ── stage 1: 추출 ──
  let extraction = "";
  let citations: CitationRef[] = [];
  if (opts.useCitations !== false) {
    const instr = buildExtractionInstruction(rm, opts.lang);
    const docs = buildCitationDocuments(blocks);
    const res = await provider.complete({
      model: opts.model,
      system: instr.system,
      maxTokens: maxOut,
      temperature: 0,
      messages: [{ role: "user", content: [...docs, { type: "text", text: instr.user }] }],
      signal: opts.signal,
    });
    extraction = res.text;
    citations = res.citations;
  } else {
    const ep = buildExtractionPrompt(rm, opts.lang, blocks);
    const res = await provider.complete({
      model: opts.model,
      system: ep.system,
      maxTokens: maxOut,
      temperature: 0,
      messages: [{ role: "user", content: ep.user }],
      signal: opts.signal,
    });
    extraction = res.text;
  }

  // ── stage 2: recap 생성(스트리밍) ──
  const rp = buildRecapPrompt(rm, extraction, opts.lang, blocks);
  const gen = await provider.stream(
    {
      model: opts.model,
      system: rp.system,
      maxTokens: maxOut,
      temperature: 0.3,
      messages: [{ role: "user", content: rp.user }],
      signal: opts.signal,
    },
    opts.onDelta ?? (() => {})
  );

  return {
    recap: gen.text,
    extraction,
    citations,
    estInputTokens: prepared.estTokens,
    droppedTags: prepared.droppedTags,
    warnings,
  };
}
