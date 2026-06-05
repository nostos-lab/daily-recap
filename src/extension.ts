import * as vscode from "vscode";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { SecretsStore } from "./secrets";
import type { RawMaterial } from "./types";
import { getClaudeProjectsDir, listProjects, matchProject, listSessionFiles, type ProjectEntry } from "./readers/projectPaths";
import { readSessionFiles, listAvailableSessionDates } from "./readers/sessionReader";
import { readGitCommits, makeGitRunner, listAvailableGitDates, mergeGitResult, shouldEnrich, type GitEnrichMode } from "./readers/gitReader";
import { resolveLang, type Lang } from "./prompts/recap-template";
import { runRecap, prepareInputs } from "./llm/recapRunner";
import { getProvider, providerUsesCitations, PROVIDERS } from "./llm/providers";
import { LLMError } from "./llm/errors";
import { makeSink, type SinkKind } from "./sinks";
import { renderMarkdown, getWebviewHtml } from "./preview/render";

export function activate(context: vscode.ExtensionContext) {
  const secrets = new SecretsStore(context.secrets);
  context.subscriptions.push(
    vscode.commands.registerCommand("recap.setApiKey", () => setApiKey(secrets)),
    vscode.commands.registerCommand("recap.manageApiKeys", () => manageApiKeys(secrets)),
    vscode.commands.registerCommand("recap.generate", () => safeGenerate(secrets))
  );
}

export function deactivate() {
  /* no-op */
}

/* ── recap.setApiKey ── */
async function setApiKey(secrets: SecretsStore): Promise<void> {
  const active = vscode.workspace.getConfiguration("recap").get<string>("provider") || "anthropic";
  const ordered = Object.values(PROVIDERS)
    .filter((m) => m.needsKey)
    .sort((a, b) => (a.id === active ? -1 : b.id === active ? 1 : 0));
  const picked = await vscode.window.showQuickPick(
    ordered.map((m) => ({
      label: m.label,
      description: m.id === active ? "Current provider (recap.provider)" : undefined,
      id: m.id,
    })),
    { placeHolder: "Set the API key for which provider?" }
  );
  if (!picked) {
    return;
  }
  await promptAndStoreKey(secrets, picked.id);
}

/** prompt for a key and store it in the given provider's slot. */
async function promptAndStoreKey(secrets: SecretsStore, providerId: string): Promise<void> {
  const meta = PROVIDERS[providerId];
  if (!meta) {
    return;
  }
  const value = await vscode.window.showInputBox({
    title: `DailyRecap — ${meta.label} API Key`,
    prompt: "Your API key is stored only in VS Code SecretStorage — never in settings or logs as plain text.",
    password: true,
    ignoreFocusOut: true,
    placeHolder: meta.keyPlaceholder,
  });
  if (value === undefined) {
    return;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    vscode.window.showWarningMessage("DailyRecap: Empty value was not saved.");
    return;
  }
  await secrets.setApiKey(meta.id, trimmed);
  const active = vscode.workspace.getConfiguration("recap").get<string>("provider") || "anthropic";
  const hint = meta.id === active ? "" : ` (set recap.provider to "${meta.id}" to use it)`;
  vscode.window.showInformationMessage(`DailyRecap: ${meta.label} API key saved.${hint}`);
}

/* ── recap.manageApiKeys (list stored keys + inline delete) ── */
interface KeyItem extends vscode.QuickPickItem {
  id: string;
  hasKey: boolean;
}

async function manageApiKeys(secrets: SecretsStore): Promise<void> {
  const qp = vscode.window.createQuickPick<KeyItem>();
  qp.title = "DailyRecap — API Keys";
  qp.placeholder = "Select a provider to set/replace its key · click the trash icon to delete";
  qp.ignoreFocusOut = true;
  const deleteBtn: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon("trash"),
    tooltip: "Delete this key",
  };
  const active = vscode.workspace.getConfiguration("recap").get<string>("provider") || "anthropic";

  const refresh = async (): Promise<void> => {
    qp.busy = true;
    const items: KeyItem[] = [];
    for (const m of Object.values(PROVIDERS).filter((p) => p.needsKey)) {
      const hasKey = !!(await secrets.getApiKey(m.id));
      items.push({
        label: m.label,
        description: `${hasKey ? "● key stored" : "○ no key"}${m.id === active ? " · current provider" : ""}`,
        detail: hasKey ? "Enter to replace · trash icon to delete" : "Enter to set a key",
        buttons: hasKey ? [deleteBtn] : [],
        id: m.id,
        hasKey,
      });
    }
    qp.items = items;
    qp.busy = false;
  };

  qp.onDidTriggerItemButton(async (e) => {
    const item = e.item;
    const confirm = await vscode.window.showWarningMessage(
      `Delete the ${item.label} API key? This cannot be undone.`,
      { modal: true },
      "Delete"
    );
    if (confirm === "Delete") {
      await secrets.deleteApiKey(item.id);
      vscode.window.showInformationMessage(`DailyRecap: ${item.label} API key deleted.`);
      await refresh();
    }
  });

  qp.onDidAccept(async () => {
    const item = qp.selectedItems[0];
    if (!item) {
      return;
    }
    qp.hide();
    await promptAndStoreKey(secrets, item.id);
  });

  qp.onDidHide(() => qp.dispose());
  await refresh();
  qp.show();
}

/* ── recap.generate (full flow) ── */
async function safeGenerate(secrets: SecretsStore): Promise<void> {
  try {
    await generate(secrets);
  } catch (e) {
    if (e instanceof LLMError) {
      if (e.action === "recap.setApiKey") {
        const c = await vscode.window.showErrorMessage(e.message, "Set API Key");
        if (c === "Set API Key") {
          await vscode.commands.executeCommand("recap.setApiKey");
        }
        return;
      }
      vscode.window.showErrorMessage(`DailyRecap: ${e.message}`);
      return;
    }
    vscode.window.showErrorMessage(`DailyRecap error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function generate(secrets: SecretsStore): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("recap");

  // 1) check API key for the active provider (local providers like Ollama need none)
  const providerId = cfg.get<string>("provider") || "anthropic";
  const needsKey = PROVIDERS[providerId]?.needsKey !== false;
  const apiKey = await secrets.getApiKey(providerId);
  if (needsKey && !apiKey) {
    const meta = PROVIDERS[providerId];
    const c = await vscode.window.showInformationMessage(
      `DailyRecap: Please set your ${meta?.label ?? providerId} API key first.`,
      "Set API Key"
    );
    if (c === "Set API Key") {
      await vscode.commands.executeCommand("recap.setApiKey");
    }
    return;
  }

  // 2) collect raw material (source: session default / git fallback)
  const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  let source: "session" | "git" = cfg.get<string>("source") === "git" ? "git" : "session";
  let rm: RawMaterial | undefined;
  let date = "";
  let label = "";

  if (source === "git") {
    if (!wsPath) {
      vscode.window.showWarningMessage("DailyRecap: The git source requires an open workspace folder.");
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
        vscode.window.showWarningMessage(`No session logs found (${projectsDir}).`);
        return;
      }
      const c = await vscode.window.showInformationMessage(
        "No session logs found. Proceed with git commits?",
        "Use git",
        "Cancel"
      );
      if (c !== "Use git") {
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
      // project → date (back button support)
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
      // empty state/format warning → git fallback suggestion
      const empty = rm.userPrompts.length === 0 && rm.assistantTexts.length === 0 && rm.toolSequence.length === 0;
      if (empty || rm.warnings.length > 0) {
        if (wsPath) {
          const c = await vscode.window.showInformationMessage(
            empty
              ? `No session decision narrative for ${date}. Try git commits?`
              : "The session log format raised a warning. Try git commits?",
            "Try git",
            "Cancel"
          );
          if (c === "Try git") {
            source = "git";
            label = path.basename(wsPath);
            rm = readGitCommits(label, date, makeGitRunner(wsPath));
          } else if (empty) {
            return;
          }
        } else if (empty) {
          vscode.window.showInformationMessage(`No decision narrative for ${date} — try another date.`);
          return;
        }
      }
    }
  }

  if (!rm || (rm.userPrompts.length === 0 && rm.toolSequence.length === 0)) {
    vscode.window.showInformationMessage(`No record found for ${date || "the selected date"} — try another date.`);
    return;
  }

  // v1.1 ①: session 소스면 같은 날짜 git 결과(커밋·변경 파일)로 "결과" 축을 보강
  const gitEnrich = (cfg.get<string>("gitEnrich") as GitEnrichMode) || "always";
  if (source === "session" && wsPath && gitEnrich !== "off") {
    const gitRm = readGitCommits(path.basename(wsPath), date, makeGitRunner(wsPath));
    if (shouldEnrich(gitEnrich, rm, gitRm.commitCount ?? 0)) {
      rm = mergeGitResult(rm, gitRm);
    }
  }

  // 5) show token size + confirm
  const prep = prepareInputs(rm);
  const go = await vscode.window.showInformationMessage(
    `Generate recap? (source: ${source === "git" ? "git commits" : "session logs"}, ~${prep.estTokens.toLocaleString()} input tokens${prep.truncated ? ", some sources trimmed" : ""})`,
    { modal: true },
    "Generate"
  );
  if (go !== "Generate") {
    return;
  }

  // 6) LLM call (progress bar, streaming is status message — PRD §6.5 fallback)
  const lang: Lang = resolveLang(cfg.get<string>("lang"), vscode.env.language);
  const model = cfg.get<string>("model") || "claude-sonnet-4-6";
  const baseUrl = cfg.get<string>("baseUrl") || undefined;
  const provider = getProvider({ provider: providerId, apiKey: apiKey ?? "", baseUrl });
  const useCitations = providerUsesCitations(providerId);

  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "DailyRecap: generating recap", cancellable: true },
    async (progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());
      let chars = 0;
      return runRecap(provider, rm!, {
        model,
        lang,
        useCitations,
        signal: controller.signal,
        onDelta: (t) => {
          chars += t.length;
          progress.report({ message: `${chars} chars generated…` });
        },
      });
    }
  );

  if (!result.recap.trim()) {
    vscode.window.showWarningMessage("DailyRecap: Received an empty response — please try again.");
    return;
  }

  // 7) preview (webview)
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

  // 8) pick recording destination + append
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
    ? "Skipped (identical recap already exists)"
    : res.appended
      ? "Appended to existing file"
      : "Written to a new file";
  const open = await vscode.window.showInformationMessage(`DailyRecap: ${status} — ${res.path}`, "Open file");
  if (open === "Open file") {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(res.path));
    await vscode.window.showTextDocument(doc);
  }
}

/* ── helpers ── */

/** pick project. automatically recommended at the top, but always changeable. */
async function pickProject(projects: ProjectEntry[], wsPath?: string): Promise<ProjectEntry | undefined> {
  const matched = wsPath ? matchProject(wsPath, projects) : undefined;
  const items: Array<{ label: string; description?: string; entry: ProjectEntry }> = [];
  if (matched) {
    items.push({ label: matched.slug, description: "Current workspace (auto-matched)", entry: matched });
  }
  for (const p of projects) {
    if (!matched || p.slug !== matched.slug) {
      items.push({ label: p.slug, description: p.dir, entry: p });
    }
  }
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a session-log project (auto-matched item is on top)",
  });
  return picked?.entry;
}

/**
 * pick date. today/yesterday + actual logs/commits + direct input.
 * if allowBack, provide "← project reselect" (return "BACK"). cancel is undefined.
 */
async function pickDate(available: string[], allowBack: boolean): Promise<string | undefined> {
  const today = localDateStr(new Date());
  const yesterday = localDateStr(new Date(Date.now() - 86400000));
  const suffix = (d: string) => (d === today ? " (today)" : d === yesterday ? " (yesterday)" : "");

  interface DItem {
    label: string;
    value?: string;
    back?: boolean;
    kind?: vscode.QuickPickItemKind;
  }
  const items: DItem[] = [];
  if (allowBack) {
    items.push({ label: "← Choose a different project", back: true });
  }

  const dates = available.slice(0, 60);
  const hasLogs = dates.length > 0;
  if (hasLogs) {
    // show dates with logs (today/yesterday are only shown if in the list)
    items.push({ label: "Dates with logs", kind: vscode.QuickPickItemKind.Separator });
    for (const d of dates) {
      items.push({ label: `📄 ${d}${suffix(d)}`, value: d });
    }
  } else {
    // no logs available, explicitly state
    items.push({ label: "No logs available", kind: vscode.QuickPickItemKind.Separator });
  }
  items.push({ label: "Enter manually…", value: "" });

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: hasLogs
      ? "Which date's recap?"
      : "No logs available — enter a date manually or go back",
  });
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
    prompt: "Enter a date in YYYY-MM-DD format",
    value: today,
    validateInput: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? undefined : "Must be in YYYY-MM-DD format"),
  });
  return input || undefined;
}

async function pickSink(): Promise<SinkKind | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: "Local Markdown", description: "<outputDir>/YYYY/MM/DD-recap.md", sinkKind: "local" as SinkKind },
      { label: "Obsidian vault", description: "<vault>/_Recap/YYYY/MM/DD.md", sinkKind: "obsidian" as SinkKind },
    ],
    { placeHolder: "Where to record the recap?" }
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
        title: "Obsidian vault path",
        prompt: "Enter the absolute path to the vault for recording recaps (recommended: save it in recap.obsidianVault).",
        ignoreFocusOut: true,
      })) || "";
    if (!vault) {
      vscode.window.showWarningMessage("DailyRecap: No vault path — recording canceled.");
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
