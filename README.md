# DailyRecap

[![Version](https://img.shields.io/visual-studio-marketplace/v/nostos-lab.dailyrecap)](https://marketplace.visualstudio.com/items?itemName=nostos-lab.dailyrecap)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/nostos-lab.dailyrecap)](https://marketplace.visualstudio.com/items?itemName=nostos-lab.dailyrecap)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

Turn a day of AI-assisted coding into a **decision retrospective** — what you decided, *why*, and what it produced — with one command.

Retrospectives are valuable but rarely happen, because writing them is friction. DailyRecap reads your **AI coding session logs** (and git history) and drafts the recap for you, so the day's decisions and context accumulate **with almost no effort**. It's a private journal for *you*, not a publishing tool.

<!-- TODO: add a demo GIF/screenshot here, e.g. ![Demo](images/demo.gif) -->

## Features

- **Decision-first recaps.** Each day is organized into work threads (e.g. *Sign-up*, *UI fixes*, *Backend API*), and every thread gets a structured section: what was decided → why (context & judgment) → result → what got stuck → what's next.
- **Recovers the "why" from your session.** It reads Claude Code session logs (your prompts, the assistant's replies, the tool calls) to reconstruct the reasoning behind each change — not just the diff.
- **Fuses in git results.** The same day's commits and changed files are pulled in as ground-truth evidence for the "result" of each decision.
- **Grounded, not hallucinated.** Facts and numbers must trace to a source; only choices you explicitly made are stated as decisions; quotes carry citations.
- **Writes where you already work.** Appends to local Markdown or an Obsidian vault, organized by date.
- **Your choice of model, your key (BYOK).** Use Anthropic, OpenAI, Gemini, Grok, or a local Ollama model. Cloud keys live only in the editor's secret storage and calls go directly to the provider — never through our servers. Ollama runs entirely on your machine.

## Requirements

- VS Code 1.85+ (or Cursor / other VS Code-compatible editors)
- A model to generate with — either:
  - an API key for a supported cloud provider (Anthropic, OpenAI, Google Gemini, or xAI Grok), with usage credit billed by that provider, **or**
  - a local [Ollama](https://ollama.com) install (free, offline, no key)
- Node.js 18+ is only needed if you build the extension from source

## Getting Started

1. Pick a provider (see [Providers](#providers)). The default is Anthropic.
2. **Cloud provider:** open the Command Palette (`Cmd/Ctrl+Shift+P`) → **DailyRecap: Set API Key**, choose the provider, and paste its key (stored in SecretStorage).
   **Ollama (local):** no key — just set `recap.provider` to `ollama` and `recap.model` to a local tag (see [Using Ollama](#using-ollama-local)).
3. Run **DailyRecap: Generate Recap**.
4. Pick a project → a date (dates that actually have logs are listed first) → confirm.
5. Review the preview, then choose where to save it (Local Markdown or Obsidian).

No Claude Code logs for that day? DailyRecap offers to build the recap from that day's **git commits** instead.

## Providers

DailyRecap is BYOK and provider-agnostic. Choose one via the `recap.provider` setting and set its model in `recap.model`.

| Provider | `recap.provider` | API key | Default base URL | Example `recap.model` |
|---|---|---|---|---|
| Anthropic (Claude) | `anthropic` | required | `https://api.anthropic.com` | `claude-sonnet-4-6` |
| OpenAI (GPT) | `openai` | required | `https://api.openai.com/v1` | `gpt-4o` |
| Google Gemini | `gemini` | required | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-pro` |
| xAI (Grok) | `grok` | required | `https://api.x.ai/v1` | `grok-4` |
| Ollama (local) | `ollama` | none | `http://localhost:11434/v1` | `llama3.1` |

Model names above are examples — check each provider's docs for current names.

**Grounding note.** Anthropic uses the native **Citations API** to tie extracted facts and quotes back to your source material. OpenAI, Gemini, Grok, and Ollama have no Citations API, so they run through an inline text-extraction path instead — recaps still work, but their grounding is slightly weaker (local models most of all).

### Managing keys

Each cloud provider has its own key slot, so you can store several and switch between them by changing `recap.provider` — DailyRecap never has to guess which key is which.

- **DailyRecap: Set API Key** — pick a provider and store/replace its key.
- **DailyRecap: Manage API Keys** — see which providers have a key stored (● stored / ○ none), set/replace by selecting a row, or delete with the trash icon. (Ollama isn't listed because it has no key.)

Keys are stored only in the editor's secret storage (e.g. macOS Keychain) — never in `settings.json`, logs, or any server.

### Using Ollama (local)

Ollama needs no API key; it's configured entirely through settings.

1. Install Ollama from [ollama.com](https://ollama.com) and start it (`ollama serve`).
2. Pull a model, e.g. `ollama pull llama3.1` (or `qwen2.5-coder`, etc.).
3. In VS Code settings (`settings.json` or the Settings UI):

   ```jsonc
   {
     "recap.provider": "ollama",
     "recap.model": "llama3.1",            // must match a model you've pulled
     "recap.baseUrl": ""                    // empty → http://localhost:11434/v1
   }
   ```

> ⚠️ When switching to Ollama, remember to change `recap.model` — the default (`claude-sonnet-4-6`) is an Anthropic model and won't exist locally. If the local server isn't running, DailyRecap will tell you to start it.

## Commands

| Command | ID | Description |
|---|---|---|
| DailyRecap: Set API Key | `recap.setApiKey` | Pick a provider and store its API key in SecretStorage |
| DailyRecap: Manage API Keys | `recap.manageApiKeys` | List which providers have a stored key; set/replace, or delete via the trash icon |
| DailyRecap: Generate Recap | `recap.generate` | Run the full flow: pick project/date → generate → preview → record |

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `recap.provider` | `anthropic` | LLM provider: `anthropic`, `openai`, `gemini`, `grok`, or `ollama`. See [Providers](#providers). |
| `recap.model` | `claude-sonnet-4-6` | Model for the active provider. Change this when you switch providers. |
| `recap.baseUrl` | _(unset)_ | Override the base URL for OpenAI-compatible providers (`openai`/`gemini`/`grok`/`ollama`). Empty uses the provider default. |
| `recap.source` | `session` | Raw-material source: `session` (Claude Code logs) or `git`. |
| `recap.sink` | `local` | Where to record: `local` or `obsidian`. |
| `recap.outputDir` | `./recaps` | Output directory for local Markdown. |
| `recap.obsidianVault` | _(unset)_ | Absolute path to your Obsidian vault. |
| `recap.lang` | `auto` | Recap output language (`auto`/`ko`/`en`); `auto` follows the editor locale. |
| `recap.gitEnrich` | `always` | Enrich the "result" axis with the same day's git commits: `always` / `auto` (only when the session's own result signal is weak) / `off`. |

Recording paths — Local: `<outputDir>/YYYY/MM/DD-recap.md`, Obsidian: `<vault>/_Recap/YYYY/MM/DD.md`. Re-running the same day appends with a separator; identical content is skipped.

## How it works

DailyRecap makes a two-stage LLM call: (1) it extracts decisions, quotes, and numbers from the tagged source material, then (2) generates the topic-segmented recap from that. With Anthropic, stage 1 uses the Citations API for stronger grounding; the other providers use an inline text-extraction path instead. The two stages are separate because Citations and Structured Outputs can't be combined in one call.

Source material is tagged by origin — your prompts, the assistant's replies, tool calls/results, and (when enriched) git commits and changed files — and trimmed to fit a token budget, prioritizing your prompts and the assistant's reasoning over raw tool output.

## Privacy & Security

Your API key is stored only in the editor's secret storage (e.g. macOS Keychain) — never in `settings.json`, logs, or any server. Before raw material is sent to the model, keys, tokens, and emails are masked. Cloud calls go directly to the provider you configured; with Ollama, nothing leaves your machine. The preview webview runs with a strict CSP and no scripts.

## Known limitations

- Auto-matching a workspace to its `~/.claude/projects` folder can fail when the folder-name encoding differs across Claude Code versions — pick the project manually from the list when that happens.
- The "why" reconstructed from git-only days is only as good as your commit messages.
- Anthropic is the only provider with the native Citations API; OpenAI/Gemini/Grok and local Ollama run through an inline extraction path instead, so their grounding is slightly weaker (local models most of all).

## Contributing

Contributions welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Release Notes

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE)
