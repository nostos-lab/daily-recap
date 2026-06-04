import * as vscode from "vscode";

/**
 * BYOK key is stored only in VSCode SecretStorage, not our server.
 * settings.json / code / logs are not stored in plain text.
 */
const API_KEY = "recap.anthropicApiKey";

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
}
