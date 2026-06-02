import * as vscode from "vscode";
import { SecretsStore } from "./secrets";

export function activate(context: vscode.ExtensionContext) {
  const secrets = new SecretsStore(context.secrets);

  context.subscriptions.push(
    vscode.commands.registerCommand("recap.setApiKey", () =>
      setApiKey(secrets)
    ),
    vscode.commands.registerCommand("recap.generate", () =>
      generate(secrets)
    )
  );
}

export function deactivate() {
  // no-op
}

/**
 * recap.setApiKey — API 키를 마스킹 입력받아 SecretStorage에 저장. (PRD §6.1)
 */
async function setApiKey(secrets: SecretsStore): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: "DailyRecap — Anthropic API 키",
    prompt: "API 키는 VSCode SecretStorage에만 저장됩니다. 설정·로그에 평문으로 남지 않습니다.",
    password: true,
    ignoreFocusOut: true,
    placeHolder: "sk-ant-...",
  });

  if (value === undefined) {
    return; // 사용자가 취소
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    vscode.window.showWarningMessage("DailyRecap: 빈 값은 저장하지 않았습니다.");
    return;
  }

  await secrets.setApiKey(trimmed);
  vscode.window.showInformationMessage("DailyRecap: API 키를 저장했습니다.");
}

/**
 * recap.generate — 메인 플로우. Phase 1에서는 키 존재 여부 확인까지만 구현한다.
 * 이후 Phase에서 프로젝트/날짜 선택 → 원재료 수집 → LLM 호출 → 미리보기 → 기록으로 확장. (PRD §6.1)
 */
async function generate(secrets: SecretsStore): Promise<void> {
  const apiKey = await secrets.getApiKey();
  if (!apiKey) {
    const choice = await vscode.window.showInformationMessage(
      "DailyRecap: 먼저 API 키를 설정해야 합니다.",
      "API 키 설정"
    );
    if (choice === "API 키 설정") {
      await vscode.commands.executeCommand("recap.setApiKey");
    }
    return;
  }

  vscode.window.showInformationMessage(
    "DailyRecap: API 키 확인됨. recap 생성 플로우는 다음 Phase에서 구현됩니다."
  );
}
