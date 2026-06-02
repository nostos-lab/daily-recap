import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * 기록 목적지 어댑터 (PRD §6.6).
 * append(recap, date) → 기록 위치. 같은 날짜 파일이 있으면 append(중복 방지), 새 날짜면 생성.
 * 순수 node(fs)로 구현해 테스트 가능. Notion은 Phase 6(시간 남으면).
 */

export interface SinkResult {
  path: string;
  created: boolean;
  appended: boolean;
  skipped: boolean; // 동일 내용이 이미 있어 중복 기록을 건너뜀
}

export interface RecapSink {
  readonly name: string;
  append(recap: string, date: string): Promise<SinkResult>;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function dateParts(date: string): { y: string; m: string; d: string } {
  const m = DATE_RE.exec(date);
  if (!m) {
    throw new Error(`날짜 형식이 올바르지 않습니다(YYYY-MM-DD): ${date}`);
  }
  return { y: m[1], m: m[2], d: m[3] };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** 파일 생성 또는 append(중복 내용 skip). frontmatter는 새 파일 생성 시에만 1회. */
export async function writeOrAppend(filePath: string, recap: string, frontmatter?: string): Promise<SinkResult> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const body = recap.trimEnd();
  if (await pathExists(filePath)) {
    const existing = await fs.readFile(filePath, "utf8");
    if (existing.includes(body)) {
      return { path: filePath, created: false, appended: false, skipped: true };
    }
    await fs.appendFile(filePath, `\n\n---\n\n${body}\n`);
    return { path: filePath, created: false, appended: true, skipped: false };
  }
  const head = frontmatter ? `${frontmatter}\n` : "";
  await fs.writeFile(filePath, `${head}${body}\n`);
  return { path: filePath, created: true, appended: false, skipped: false };
}

/** 로컬: <outputDir>/YYYY/MM/DD-recap.md */
export class LocalSink implements RecapSink {
  readonly name = "local";
  private outputDir: string;
  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }
  filePathFor(date: string): string {
    const { y, m, d } = dateParts(date);
    return path.join(this.outputDir, y, m, `${d}-recap.md`);
  }
  append(recap: string, date: string): Promise<SinkResult> {
    return writeOrAppend(this.filePathFor(date), recap);
  }
}

/** Obsidian: <vault>/_Recap/YYYY/MM/DD.md (파일시스템 직접, 앱/인증 불필요) */
export class ObsidianSink implements RecapSink {
  readonly name = "obsidian";
  private vault: string;
  constructor(vaultPath: string) {
    if (!vaultPath || vaultPath.trim().length === 0) {
      throw new Error("Obsidian vault 경로(recap.obsidianVault)가 설정되지 않았습니다.");
    }
    this.vault = vaultPath;
  }
  filePathFor(date: string): string {
    const { y, m, d } = dateParts(date);
    return path.join(this.vault, "_Recap", y, m, `${d}.md`);
  }
  append(recap: string, date: string): Promise<SinkResult> {
    const frontmatter = `---\ndate: ${date}\ntags: [recap, dailyrecap]\n---`;
    return writeOrAppend(this.filePathFor(date), recap, frontmatter);
  }
}

export type SinkKind = "local" | "obsidian" | "notion";

export interface SinkConfig {
  outputDir?: string; // local
  vaultPath?: string; // obsidian
}

export function makeSink(kind: SinkKind, cfg: SinkConfig): RecapSink {
  switch (kind) {
    case "local":
      return new LocalSink(cfg.outputDir ?? "./recaps");
    case "obsidian":
      return new ObsidianSink(cfg.vaultPath ?? "");
    case "notion":
      throw new Error("Notion 기록은 아직 구현되지 않았습니다(Phase 6 예정).");
    default:
      throw new Error(`알 수 없는 기록 목적지: ${kind}`);
  }
}
