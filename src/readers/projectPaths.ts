import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * 워크스페이스 경로 → ~/.claude/projects/<slug> 매핑. (PRD §6.2.2)
 * 폴더명은 프로젝트 절대경로를 인코딩(슬래시 → 하이픈)한 형태.
 * 인코딩 규칙이 버전에 따라 다를 수 있으므로 자동 매칭 실패 시 수동 선택 폴백을 제공한다.
 */

export interface ProjectEntry {
  slug: string;
  dir: string;
}

/** Claude Code projects 디렉터리 경로 (OS별) */
export function getClaudeProjectsDir(home: string = os.homedir()): string {
  return path.join(home, ".claude", "projects");
}

/** 기본 인코딩: 경로 구분자(/, \)를 하이픈으로 치환 (PRD §6.2.2 명시 규칙) */
export function encodeProjectSlug(absPath: string): string {
  return absPath.replace(/[/\\]/g, "-");
}

/**
 * 매칭 후보 slug들. 자동 매칭률을 높이기 위해 실제 Claude Code가 자주 쓰는
 * 변형(`.`·`_`도 하이픈으로)을 부가 후보로 포함. (확정 규칙은 PRD §6.2.2 → 실패 시 수동 선택)
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

/** projects 디렉터리 하위 폴더 목록 */
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
 * 워크스페이스 절대경로로 프로젝트 자동 매칭. 실패 시 undefined → 호출부가 QuickPick 폴백.
 */
export function matchProject(absPath: string, projects: ProjectEntry[]): ProjectEntry | undefined {
  const wanted = new Set(candidateSlugs(absPath));
  return projects.find((p) => wanted.has(p.slug));
}

/** 프로젝트 디렉터리 내 .jsonl 세션 파일 경로 목록 */
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
