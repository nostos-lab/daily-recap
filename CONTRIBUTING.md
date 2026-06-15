# Contributing to DailyRecap

Thanks for your interest. This document describes how to propose changes so they can be reviewed and merged smoothly. By participating you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Branching model

We follow a trunk-based flow.

- `main` is the only long-lived branch and is always release-shaped (CI green, packageable).
- Work happens on short-lived branches cut off `main`:
  - `feat/<short-topic>` — new features
  - `fix/<short-topic>` — bug fixes
  - `docs/<short-topic>` — docs-only changes
  - `ci/<short-topic>` — CI / build / repo plumbing
  - `chore/<short-topic>` — refactors, dependency bumps, internal cleanup
- Branches are deleted after merge (auto-delete on merge is enabled).
- Releases are cut from `main` as annotated git tags `vX.Y.Z`; we do not maintain `release/*` branches.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) so the type prefix tells the reader the intent at a glance.

```
<type>(<optional scope>): <imperative summary>

<optional body — what & why, wrap at ~72 cols>

<optional footers — e.g. BREAKING CHANGE: ...>
```

Common types: `feat`, `fix`, `docs`, `ci`, `build`, `chore`, `refactor`, `test`, `perf`, `security`.

## Pull requests

1. Open a PR against `main`.
2. Fill in the PR template — summary, test plan, and any user-facing impact.
3. CI must pass (`build/test/package`).
4. PRs are merged with **Squash and merge** so `main` keeps a clean, one-commit-per-change history. The PR title becomes the squash commit subject — keep it conventional-commits-shaped.
5. Approval is required from a code owner (see [`CODEOWNERS`](./.github/CODEOWNERS)).
6. Force-pushes to `main` and direct pushes that bypass review are disabled.

## Local development

```bash
npm install
npm run compile   # type-check + build (out/)
npm test          # run the test suites (parser/prompt/llm/sink/e2e/git/fusion)
npm run package   # build the .vsix
```

Press `F5` in VS Code to launch the Extension Development Host and try the commands live.

### Notes

- Tests run TypeScript directly via Node's `--experimental-strip-types` (Node 22.6+; CI is pinned to Node 24).
- LLM and git are exercised through injected dependencies — no real network or system access from the test suite.
- Keep the recap prompt's anti-hallucination rules intact: facts/numbers must trace to a source tag, and only explicit user choices count as decisions.
- API keys belong in `SecretStorage` (extension) or environment variables (any CLI/CI) — never committed.

## Security

If you believe you have found a security vulnerability, please **do not** open a public issue. Follow [SECURITY.md](./SECURITY.md) for the private reporting channel.

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for planned direction.
