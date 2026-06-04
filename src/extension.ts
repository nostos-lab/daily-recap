import * as vscode from "vscode";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { SecretsStore } from "./secrets";
import type { RawMaterial } from "./types";
import { getClaudeProjectsDir, listProjects, matchProject, listSessionFiles, type ProjectEntry } from "./readers/projectPaths";
import { readSessionFiles, listAvailableSessionDates } from "./readers/sessionReader";
import { readGitCommits, makeGitRunner, listAvailableGitDates } from "./readers/gitReader";
import { resolveLang, type Lang } from "./prompts/recap-template";
import { runRecap, prepareInputs } from "./llm/recapRunner";
import { getProvider } from "./llm/providers";
import { LLMError } from "./llm/errors";
import { makeSink, type SinkKind } from "./sinks";
import { renderMarkdown, getWebviewHtml } from "./preview/render";

export function activate(context: vscode.ExtensionContext) {
  const secrets = new SecretsStore(context.secrets);
  context.subscriptions.push(
    vscode.commands.registerCommand("recap.setApiKey", () => setApiKey(secrets)),
    vscode.commands.registerCommand("recap.generate", () => safeGenerate(secrets))
  );
}

export function deactivate() {
  /* no-op */
}

/* ── recap.setApiKey ── (PRD §6.1) */
async function setApiKey(secrets: SecretsStore): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: "DailyRecap — Anthropic API 키",
    prompt: "API 키는 VSCode SecretStorage에만 저장됩니다. 설정·로그에 평문으로 남지 않습니다.",
    password: true,
    ignoreFocusOut: true,
    placeHolder: "sk-ant-...",
  });
  if (value === undefined) {
    return;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    vscode.window.showWarningMessage("DailyRecap: 빈 값은 저장하지 않았습니다.");
    return;
  }
  await secrets.setApiKey(trimmed);
  vscode.window.showInformationMessage("DailyRecap: API 키를 저장했습니다.");
}

/* ── recap.generate (전체 플로우) ── */
async function safeGenerate(secrets: SecretsStore): Promise<void> {
  try {
    await generate(secrets);
  } catch (e) {
    if (e instanceof LLMError) {
      if (e.action === "recap.setApiKey") {
        const c = await vscode.window.showErrorMessage(e.message, "API 키 설정");
        if (c === "API 키 설정") {
          await vscode.commands.executeCommand("recap.setApiKey");
        }
        return;
      }
      vscode.window.showErrorMessage(`DailyRecap: ${e.message}`);
      return;
    }
    vscode.window.showErrorMessage(`DailyRecap 오류: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function generate(secrets: SecretsStore): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("recap");

  // 1) 키 확인
  const apiKey = await secrets.getApiKey();
  if (!apiKey) {
    const c = await vscode.window.showInformationMessage("DailyRecap: 먼저 API 키를 설정해야 합니다.", "API 키 설정");
    if (c === "API 키 설정") {
      await vscode.commands.executeCommand("recap.setApiKey");
    }
    return;
  }

  // 2) 원재료 수집 (소스: session 기본 / git 폴백) — PRD §6.2
  const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  let source: "session" | "git" = cfg.get<string>("source") === "git" ? "git" : "session";
  let rm: RawMaterial | undefined;
  let date = "";
  let label = "";

  if (source === "git") {
    if (!wsPath) {
      vscode.window.showWarningMessage("DailyRecap: git 소스는 워크스페이스 폴더가 필요합니다.");
      return;
    }
    const runner = makeGitRunner(wsPath);
    const picked = await pickDate(listAvailableGitDates(runner), false);
    if (!picked || picked === "BACK") {
      return;
    }
    date = picked;
    label = path.basename(wsPath);
    rm = readGitCommits(label, date, runner);
  } else {
    const projectsDir = getClaudeProjectsDir();
    const projects = listProjects(projectsDir);
    if (projects.length === 0) {
      if (!wsPath) {
        vscode.window.showWarningMessage(`세션 로그를 찾지 못했습니다(${projectsDir}).`);
        return;
      }
      const c = await vscode.window.showInformationMessage(
        "세션 로그를 찾지 못했습니다. git 커밋으로 진행할까요?",
        "git으로 진행",
        "취소"
      );
      if (c !== "git으로 진행") {
        return;
      }
      const runner = makeGitRunner(wsPath);
      const picked = await pickDate(listAvailableGitDates(runner), false);
      if (!picked || picked === "BACK") {
        return;
      }
      date = picked;
      label = path.basename(wsPath);
      source = "git";
      rm = readGitCommits(label, date, runner);
    } else {
      // 프로젝트 → 날짜 (뒤로가기 지원)
      let project: ProjectEntry | undefined;
      let step = 0;
      for (;;) {
        if (step === 0) {
          project = await pickProject(projects, wsPath);
          if (!project) {
            return;
          }
          step = 1;
        } else {
          const picked = await pickDate(listAvailableSessionDates(listSessionFiles(project!.dir)), true);
          if (!picked) {
            return;
          }
          if (picked === "BACK") {
            step = 0;
            continue;
          }
          date = picked;
          break;
        }
      }
      label = project!.slug;
      rm = readSessionFiles(listSessionFiles(project!.dir), { date, projectLabel: project!.slug });
      for (const w of rm.warnings) {
        vscode.window.showWarningMessage(`DailyRecap: ${w}`);
      }
      // 빈 상태/포맷 경고 → git 폴백 제안 (PRD §6.2, §6.8)
      const empty = rm.userPrompts.length === 0 && rm.assistantTexts.length === 0 && rm.toolSequence.length === 0;
      if (empty || rm.warnings.length > 0) {
        if (wsPath) {
          const c = await vscode.window.showInformationMessage(
            empty
              ? `${date}에 세션 결정 서사가 없습니다. git 커밋으로 시도할까요?`
              : "세션 로그 포맷 경고가 있습니다. git 커밋으로 시도할까요?",
            "git으로 시도",
            "취소"
          );
          if (c === "git으로 시도") {
            source = "git";
            label = path.basename(wsPath);
            rm = readGitCommits(label, date, makeGitRunner(wsPath));
          } else if (empty) {
            return;
          }
        } else if (empty) {
          vscode.window.showInformationMessage(`${date}에 결정 서사가 없습니다 — 다른 날짜를 선택해 보세요.`);
          return;
        }
      }
    }
  }

  if (!rm || (rm.userPrompts.length === 0 && rm.toolSequence.length === 0)) {
    vscode.window.showInformationMessage(`${date || "선택한 날짜"}에 기록을 찾지 못했습니다 — 다른 날짜를 선택해 보세요.`);
    return;
  }

  // 5) 토큰 규모 표시 + 확인
  const prep = prepareInputs(rm);
  const go = await vscode.window.showInformationMessage(
    `recap을 생성할까요? (출처: ${source === "git" ? "git 커밋" : "세션 로그"}, 대략 입력 ${prep.estTokens.toLocaleString()} 토큰${prep.truncated ? ", 일부 소스 축소됨" : ""})`,
    { modal: true },
    "생성"
  );
  if (go !== "생성") {
    return;
  }

  // 6) LLM 호출 (진행 상태바, 스트리밍은 상태 메시지로 — PRD §6.5 폴백)
  const lang: Lang = resolveLang(cfg.get<string>("lang"), vscode.env.language);
  const model = cfg.get<string>("model") || "claude-sonnet-4-6";
  const provider = getProvider({ provider: cfg.get<string>("provider") || "anthropic", apiKey });

  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "DailyRecap: recap 생성 중", cancellable: true },
    async (progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());
      let chars = 0;
      return runRecap(provider, rm!, {
        model,
        lang,
        signal: controller.signal,
        onDelta: (t) => {
          chars += t.length;
          progress.report({ message: `${chars}자 생성됨…` });
        },
      });
    }
  );

  if (!result.recap.trim()) {
    vscode.window.showWarningMessage("DailyRecap: 빈 응답을 받았습니다 — 다시 시도해 주세요.");
    return;
  }

  // 7) 미리보기 (웹뷰)
  const panel = vscode.window.createWebviewPanel(
    "dailyrecap.preview",
    `Recap ${date} · ${label}`,
    vscode.ViewColumn.Beside,
    { enableScripts: false }
  );
  const nonce = getNonce();
  panel.webview.html = getWebviewHtml(renderMarkdown(result.recap), {
    nonce,
    cspSource: panel.webview.cspSource,
    title: `Recap ${date}`,
  });

  // 8) 기록 목적지 선택 + append
  const sinkKind = await pickSink();
  if (!sinkKind) {
    return;
  }
  const sink = await buildSink(sinkKind, cfg);
  if (!sink) {
    return;
  }
  const res = await sink.append(result.recap, date);
  const status = res.skipped
    ? "이미 동일한 recap이 있어 건너뜀"
    : res.appended
      ? "기존 파일에 추가함"
      : "새 파일로 기록함";
  const open = await vscode.window.showInformationMessage(`DailyRecap: ${status} — ${res.path}`, "파일 열기");
  if (open === "파일 열기") {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(res.path));
    await vscode.window.showTextDocument(doc);
  }
}

/* ── helpers ── */

/** 프로젝트 선택. 자동 매칭 항목을 맨 위에 추천으로 두되 항상 변경 가능. */
async function pickProject(projects: ProjectEntry[], wsPath?: string): Promise<ProjectEntry | undefined> {
  const matched = wsPath ? matchProject(wsPath, projects) : undefined;
  const items: Array<{ label: string; description?: string; entry: ProjectEntry }> = [];
  if (matched) {
    items.push({ label: matched.slug, description: "현재 워크스페이스 (자동 매칭)", entry: matched });
  }
  for (const p of projects) {
    if (!matched || p.slug !== matched.slug) {
      items.push({ label: p.slug, description: p.dir, entry: p });
    }
  }
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "세션 로그 프로젝트를 선택하세요 (자동 매칭 항목이 맨 위)",
  });
  return picked?.entry;
}

/**
 * 날짜 선택. 오늘/어제 + 실제 로그/커밋이 있는 날짜 + 직접입력.
 * allowBack이면 "← 프로젝트 다시 선택" 제공(반환 "BACK"). 취소는 undefined.
 */
async function pickDate(available: string[], allowBack: boolean): Promise<string | undefined> {
  const today = localDateStr(new Date());
  const yesterday = localDateStr(new Date(Date.now() - 86400000));

  interface DItem {
    label: string;
    value?: string;
    back?: boolean;
    kind?: vscode.QuickPickItemKind;
  }
  const items: DItem[] = [];
  if (allowBack) {
    items.push({ label: "← 프로젝트 다시 선택", back: true });
  }
  items.push({ label: `오늘 (${today})`, value: today });
  items.push({ label: `어제 (${yesterday})`, value: yesterday });

  const extra = available.filter((d) => d !== today && d !== yesterday).slice(0, 30);
  if (extra.length > 0) {
    items.push({ label: "로그가 있는 날짜", kind: vscode.QuickPickItemKind.Separator });
    for (const d of extra) {
      items.push({ label: `📄 ${d}`, value: d });
    }
  }
  items.push({ label: "직접 입력…", value: "" });

  const picked = await vscode.window.showQuickPick(items, { placeHolder: "어느 날짜의 recap을 만들까요?" });
  if (!picked) {
    return undefined;
  }
  if (picked.back) {
    return "BACK";
  }
  if (picked.value) {
    return picked.value;
  }
  const input = await vscode.window.showInputBox({
    prompt: "날짜를 YYYY-MM-DD 형식으로 입력하세요",
    value: today,
    validateInput: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? undefined : "YYYY-MM-DD 형식이어야 합니다"),
  });
  return input || undefined;
}

async function pickSink(): Promise<SinkKind | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: "로컬 마크다운", description: "<outputDir>/YYYY/MM/DD-recap.md", sinkKind: "local" as SinkKind },
      { label: "Obsidian vault", description: "<vault>/_Recap/YYYY/MM/DD.md", sinkKind: "obsidian" as SinkKind },
    ],
    { placeHolder: "recap을 어디에 기록할까요?" }
  );
  return picked?.sinkKind;
}

async function buildSink(kind: SinkKind, cfg: vscode.WorkspaceConfiguration) {
  if (kind === "local") {
    const raw = cfg.get<string>("outputDir") || "./recaps";
    const base = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const outputDir = path.isAbsolute(raw) ? raw : path.join(base, raw);
    return makeSink("local", { outputDir });
  }
  // obsidian
  let vault = cfg.get<string>("obsidianVault") || "";
  if (!vault) {
    vault =
      (await vscode.window.showInputBox({
        title: "Obsidian vault 경로",
        prompt: "recap을 기록할 vault의 절대 경로를 입력하세요(설정 recap.obsidianVault에 저장 권장).",
        ignoreFocusOut: true,
      })) || "";
    if (!vault) {
      vscode.window.showWarningMessage("DailyRecap: vault 경로가 없어 기록을 취소했습니다.");
      return undefined;
    }
  }
  return makeSink("obsidian", { vaultPath: vault });
}

function localDateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function getNonce(): string {
  return crypto.randomBytes(16).toString("base64");
}
