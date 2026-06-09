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
 * 2-stage call orchestration.
 *   stage 1: extract citations, decisions, numbers using Citations API (non-streaming)
 *   stage 2: generate recap markdown (streaming)
 * do not enable Citations and Structured Outputs in the same call (avoid 400). extract as text.
 */

const DEFAULT_MAX_INPUT_TOKENS = 150000;
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

export interface RunOptions {
  model: string;
  lang: Lang;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  /** false means inline text extraction (Citations disabled) */
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

/** prepare inputs before calling + apply budget (show approximate token size). */
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
      `input too large, trimmed some sources (estimated ${prepared.estTokens} tokens, dropped ${prepared.droppedTags.length} tags).`
    );
  }
  const blocks = prepared.blocks;

  // ── stage 1: extraction ──
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

  // ── stage 2: generate recap (streaming) ──
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
