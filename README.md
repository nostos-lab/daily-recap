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
- **Bring your own key (BYOK).** Your API key lives only in the editor's secret storage; calls go directly to Anthropic — never through our servers.

## Requirements

- VS Code 1.85+ (or Cursor / other VS Code-compatible editors)
- An [Anthropic API key](https://console.anthropic.com/account/keys) with usage credit (billed separately from any subscription)
- Node.js 18+ is only needed if you build the extension from source

## Getting Started

1. Open the Command Palette (`Cmd/Ctrl+Shift+P`) → **DailyRecap: Set API Key** and paste your Anthropic key (stored in SecretStorage).
2. Run **DailyRecap: Generate Recap**.
3. Pick a project → a date (dates that actually have logs are listed first) → confirm.
4. Review the preview, then choose where to save it (Local Markdown or Obsidian).

No Claude Code logs for that day? DailyRecap offers to build the recap from that day's **git commits** instead.

## Commands

| Command | ID | Description |
|---|---|---|
| DailyRecap: Set API Key | `recap.setApiKey` | Store your Anthropic API key in SecretStorage |
| DailyRecap: Generate Recap | `recap.generate` | Run the full flow: pick project/date → generate → preview → record |

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `recap.provider` | `anthropic` | LLM provider (v1 is fixed to `anthropic`). |
| `recap.model` | `claude-sonnet-4-6` | Anthropic model to use. |
| `recap.source` | `session` | Raw-material source: `session` (Claude Code logs) or `git`. |
| `recap.sink` | `local` | Where to record: `local` or `obsidian`. |
| `recap.outputDir` | `./recaps` | Output directory for local Markdown. |
| `recap.obsidianVault` | _(unset)_ | Absolute path to your Obsidian vault. |
| `recap.lang` | `auto` | Recap output language (`auto`/`ko`/`en`); `auto` follows the editor locale. |
| `recap.gitEnrich` | `always` | Enrich the "result" axis with the same day's git commits: `always` / `auto` (only when the session's own result signal is weak) / `off`. |

Recording paths — Local: `<outputDir>/YYYY/MM/DD-recap.md`, Obsidian: `<vault>/_Recap/YYYY/MM/DD.md`. Re-running the same day appends with a separator; identical content is skipped.

## How it works

DailyRecap makes a two-stage LLM call: (1) it uses the Citations API to extract decisions, quotes, and numbers from the tagged source material, then (2) generates the topic-segmented recap from that. The two stages are separate because Citations and Structured Outputs can't be combined in one call.

## Privacy & Security

Your API key is stored only in the editor's secret storage (e.g. macOS Keychain) — never in `settings.json`, logs, or any server. Before raw material is sent to the model, keys, tokens, and emails are masked. The preview webview runs with a strict CSP and no scripts.

## Known limitations

- Auto-matching a workspace to its `~/.claude/projects` folder can fail when the folder-name encoding differs across Claude Code versions — pick the project manually from the list when that happens.
- The "why" reconstructed from git-only days is only as good as your commit messages.
- Provider support is Anthropic-only in v1 (OpenAI/Ollama are planned).

## Roadmap

See [ROADMAP.md](./ROADMAP.md). Next up: a grounding verifier and a local (Ollama) provider.

## Contributing

```bash
npm install
npm run compile   # type-check + build
npm test          # run the test suites
npm run package   # build the .vsix
```

Issues and PRs welcome.

## Release Notes

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE)
