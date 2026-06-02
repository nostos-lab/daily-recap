import * as vscode from "vscode";

/**
 * BYOK 키는 우리 서버를 거치지 않고 VSCode SecretStorage에만 저장한다.
 * settings.json / 코드 / 로그에 평문으로 남기지 않는다. (PRD §5, 작업규칙 4)
 */
const API_KEY = "recap.anthropicApiKey";
const NOTION_TOKEN = "recap.notionToken";

export class SecretsStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  getApiKey(): Thenable<string | undefined> {
    return this.secrets.get(API_KEY);
  }

  setApiKey(value: string): Thenable<void> {
    return this.secrets.store(API_KEY, value);
  }

  deleteApiKey(): Thenable<void> {
    return this.secrets.delete(API_KEY);
  }

  getNotionToken(): Thenable<string | undefined> {
    return this.secrets.get(NOTION_TOKEN);
  }

  setNotionToken(value: string): Thenable<void> {
    return this.secrets.store(NOTION_TOKEN, value);
  }
}
