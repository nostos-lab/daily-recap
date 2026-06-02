import type { SourceBlock } from "../prompts/recap-template";

/**
 * 입력 길이 가드레일 (PRD §6.5).
 * 토큰 추정치가 상한을 넘으면 소스를 잘라내고 경고. 호출 전 대략 토큰 규모를 표시.
 */

/** 보수적(과대) 토큰 추정: 한/영 혼합 대비 ~3자/토큰 */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / 3);
}

function blockTokens(b: SourceBlock): number {
  return estimateTokens(b.label) + estimateTokens(b.content) + 8;
}

/** 태그 우선순위(클수록 보존): 사용자 프롬프트 > assistant > 도구호출 > 도구결과 */
function priority(tag: string): number {
  const c = tag.charAt(0);
  if (c === "P") return 3;
  if (c === "A") return 2;
  if (c === "T") return 1;
  return 0; // R 등
}

export interface BudgetResult {
  blocks: SourceBlock[];
  estTokens: number;
  droppedTags: string[];
  truncated: boolean;
}

/**
 * 소스 블록을 maxTokens 예산 안으로 맞춘다.
 * 1) 낮은 우선순위(R→T)부터, 같은 우선순위는 뒤쪽부터 제거
 * 2) P/A만 남아도 초과하면 가장 긴 블록 본문을 점진적으로 클립
 */
export function enforceBudget(input: SourceBlock[], maxTokens: number): BudgetResult {
  const blocks = input.map((b) => ({ ...b }));
  const droppedTags: string[] = [];
  let truncated = false;

  const total = () => blocks.reduce((s, b) => s + blockTokens(b), 0);

  while (total() > maxTokens) {
    // 제거 가능한(T·R) 후보 중 가장 낮은 우선순위, 동률이면 뒤쪽 블록 선택
    let dropIdx = -1;
    for (let i = 0; i < blocks.length; i++) {
      const p = priority(blocks[i].tag);
      if (p >= 2) {
        continue; // P/A는 보존
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
    // P/A만 남음 → 가장 긴 본문 클립
    let longest = -1;
    let longestLen = 0;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].content.length > longestLen) {
        longestLen = blocks[i].content.length;
        longest = i;
      }
    }
    if (longest < 0 || longestLen < 80) {
      break; // 더 줄일 수 없음
    }
    const cut = Math.floor(blocks[longest].content.length * 0.7);
    blocks[longest].content = blocks[longest].content.slice(0, cut) + " …(예산 초과로 생략)";
    truncated = true;
  }

  if (droppedTags.length > 0) {
    truncated = true;
  }
  return { blocks, estTokens: total(), droppedTags, truncated };
}
