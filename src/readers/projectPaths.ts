import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * workspace path → ~/.claude/projects/<slug> mapping.
 * folder name is the absolute path of the project encoded (slash → hyphen).
 * encoding rules may vary by version, so provide a manual fallback selection if auto-matching fails.
 */

export interface ProjectEntry {
  slug: string;
  dir: string;
}

/** Claude Code projects directory path (OS-specific) */
export function getClaudeProjectsDir(home: string = os.homedir()): string {
  return path.join(home, ".claude", "projects");
}

/** default encoding: replace path separators (/,\,) with hyphens */
export function encodeProjectSlug(absPath: string): string {
  return absPath.replace(/[/\\]/g, "-");
}

/**
 * matching candidate slugs. to improve auto-matching rate, include actual Claude Code variants (`.`, `_` also as hyphens).
 */
export function candidateSlugs(absPath: string): string[] {
  const primary = encodeProjectSlug(absPath);
  const dotted = absPath.replace(/[/\\._]/g, "-");
  const out = [primary];
  if (dotted !== primary) {
    out.push(dotted);
  }
  return out;
}

/** list of subfolders in the projects directory */
export function listProjects(projectsDir: string): ProjectEntry[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => ({ slug: e.name, dir: path.join(projectsDir, e.name) }));
}

/**
 * auto-match project by workspace absolute path. if fails, return undefined → caller's QuickPick fallback.
 */
export function matchProject(absPath: string, projects: ProjectEntry[]): ProjectEntry | undefined {
  const wanted = new Set(candidateSlugs(absPath));
  return projects.find((p) => wanted.has(p.slug));
}

/** list of .jsonl session files inside the project directory */
export function listSessionFiles(projectDir: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(projectDir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.toLowerCase().endsWith(".jsonl"))
    .map((n) => path.join(projectDir, n));
}
