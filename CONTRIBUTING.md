# Contributing to DailyRecap

Thanks for your interest! Issues and PRs are welcome.

## Development

```bash
npm install
npm run compile   # type-check + build (out/)
npm test          # run the test suites (parser/prompt/llm/sink/e2e/git/fusion)
npm run package   # build the .vsix
```

Press `F5` in VS Code to launch the Extension Development Host and try the commands live.

### Notes

- Tests run TypeScript directly via Node's `--experimental-strip-types`; LLM and git are exercised through injected dependencies (no real network/system).
- Keep the recap prompt's anti-hallucination rules intact: facts/numbers must trace to a source tag, and only explicit user choices count as decisions.
- API keys belong in SecretStorage (extension) or environment variables (any CLI/CI) — never committed.

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for planned direction.
