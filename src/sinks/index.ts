import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * recording destination adapter.
 * append(recap, date) → recording location. if same date file exists, append (avoid duplicates), if new date, create.
 * pure node(fs) implementation for testing. Notion is reserved for Phase 6 (if time permits).
 */

export interface SinkResult {
  path: string;
  created: boolean;
  appended: boolean;
  skipped: boolean; // same content already exists, skip recording
}

export interface RecapSink {
  readonly name: string;
  append(recap: string, date: string): Promise<SinkResult>;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function dateParts(date: string): { y: string; m: string; d: string } {
  const m = DATE_RE.exec(date);
  if (!m) {
    throw new Error(`Invalid date format (expected YYYY-MM-DD): ${date}`);
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

/** file creation or append (skip duplicate content). frontmatter is only once on new file creation. */
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

/** local: <outputDir>/YYYY/MM/DD-recap.md */
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

/** Obsidian: <vault>/_Recap/YYYY/MM/DD.md (filesystem direct, app/auth not required) */
export class ObsidianSink implements RecapSink {
  readonly name = "obsidian";
  private vault: string;
  constructor(vaultPath: string) {
    if (!vaultPath || vaultPath.trim().length === 0) {
      throw new Error("Obsidian vault path (recap.obsidianVault) is not set.");
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
      throw new Error("Notion recording is not implemented yet.");
    default:
      throw new Error(`Unknown recording destination: ${kind}`);
  }
}
