import * as vscode from "vscode";

/**
 * BYOK keys are stored only in VS Code SecretStorage, not on our server.
 * settings.json / code / logs never hold the key in plain text.
 *
 * Each provider gets its own slot (`recap.apiKey.<provider>`) so the user can
 * keep keys for several providers and switch between them via `recap.provider`
 * — we never have to guess which key belongs to which provider.
 */
const SLOT_PREFIX = "recap.apiKey.";
/** legacy single-slot key (pre per-provider); migrated for anthropic. */
const LEGACY_ANTHROPIC = "recap.anthropicApiKey";

function slot(provider: string): string {
  return `${SLOT_PREFIX}${provider}`;
}

export class SecretsStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getApiKey(provider: string): Promise<string | undefined> {
    const v = await this.secrets.get(slot(provider));
    if (v) {
      return v;
    }
    // migrate the old single-slot anthropic key on first read.
    if (provider === "anthropic") {
      const legacy = await this.secrets.get(LEGACY_ANTHROPIC);
      if (legacy) {
        await this.secrets.store(slot(provider), legacy);
        await this.secrets.delete(LEGACY_ANTHROPIC);
        return legacy;
      }
    }
    return undefined;
  }

  setApiKey(provider: string, value: string): Thenable<void> {
    return this.secrets.store(slot(provider), value);
  }

  deleteApiKey(provider: string): Thenable<void> {
    return this.secrets.delete(slot(provider));
  }
}
