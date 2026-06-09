import type { SourceBlock } from "../prompts/recap-template";

/**
 * input length guardrail
 * if estimated token count exceeds the limit, trim the source and warn. show approximate token size before calling.
 */

/** conservative (overestimated) token estimation: ~3 chars/token for mixed English/Korean */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / 3);
}

function blockTokens(b: SourceBlock): number {
  return estimateTokens(b.label) + estimateTokens(b.content) + 8;
}

/** priority (higher means preserved): user prompt > assistant > git result > tool call > tool result */
function priority(tag: string): number {
  const c = tag.charAt(0);
  if (c === "P") return 4;
  if (c === "A") return 3;
  if (c === "G") return 2; // git result evidence (v1.1) — preserved like P/A
  if (c === "T") return 1;
  return 0; // R etc.
}

export interface BudgetResult {
  blocks: SourceBlock[];
  estTokens: number;
  droppedTags: string[];
  truncated: boolean;
}

/**
 * trim source blocks to fit within maxTokens budget
 * 1) start from lowest priority (R→T), then remove from back for same priority
 * 2) if only P/A remains, trim the longest block content progressively
 */
export function enforceBudget(input: SourceBlock[], maxTokens: number): BudgetResult {
  const blocks = input.map((b) => ({ ...b }));
  const droppedTags: string[] = [];
  let truncated = false;

  const total = () => blocks.reduce((s, b) => s + blockTokens(b), 0);

  while (total() > maxTokens) {
    // select the lowest priority candidate among removable (T·R) blocks, then remove from back for tie
    let dropIdx = -1;
    for (let i = 0; i < blocks.length; i++) {
      const p = priority(blocks[i].tag);
      if (p >= 2) {
        continue; // P/A are preserved
      }
      if (dropIdx === -1) {
        dropIdx = i;
        continue;
      }
      const bp = priority(blocks[dropIdx].tag);
      if (p < bp || (p === bp && i > dropIdx)) {
        dropIdx = i;
      }
    }
    if (dropIdx >= 0) {
      droppedTags.push(blocks[dropIdx].tag);
      blocks.splice(dropIdx, 1);
      continue;
    }
    // if only P/A remains, trim the longest block content progressively
    let longest = -1;
    let longestLen = 0;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].content.length > longestLen) {
        longestLen = blocks[i].content.length;
        longest = i;
      }
    }
    if (longest < 0 || longestLen < 80) {
      break; // cannot trim anymore
    }
    const cut = Math.floor(blocks[longest].content.length * 0.7);
    blocks[longest].content = blocks[longest].content.slice(0, cut) + " …(budget exceeded, truncated)";
    truncated = true;
  }

  if (droppedTags.length > 0) {
    truncated = true;
  }
  return { blocks, estTokens: total(), droppedTags, truncated };
}
