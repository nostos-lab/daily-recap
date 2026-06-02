# DailyRecap (작업명)

AI 코딩 세션 로그(Claude Code `.jsonl`)를 읽어 **"오늘의 의사결정 recap"** 회고 문서를 자동 생성하고, **Notion / Obsidian / 로컬 마크다운**에 기록(append)하는 무료 VSCode 확장. 사용자가 자신의 API 키를 넣어 쓰는 **BYOK** 모델.

## 개발 실행

```bash
npm install
npm run compile   # 또는 npm run watch
```

VSCode에서 이 폴더를 열고 `F5`를 누르면 확장 개발 호스트가 뜹니다. 명령 팔레트(`Cmd+Shift+P`)에서:

- **DailyRecap: API 키 설정** (`recap.setApiKey`) — Anthropic API 키를 SecretStorage에 저장
- **DailyRecap: recap 생성** (`recap.generate`) — 메인 플로우 (Phase별로 확장 중)

## 진행 상태

- [x] Phase 1 — 스캐폴딩 + BYOK 키 (SecretStorage)
- [x] Phase 2 — 세션 로그 수집기 (`src/readers/`)
- [x] Phase 3 — recap 프롬프트 템플릿 (`src/prompts/`, 2단 호출 설계)
- [x] Phase 4 — LLM 어댑터 + 스트리밍 (`src/llm/`, fetch 직접, Anthropic 구현)
- [x] Phase 5 — 미리보기 + 기록(sink) (`src/sinks/`, `src/preview/`, generate 전체 플로우)
- [ ] Phase 6 — git 폴백 + 도그푸딩 + 튜닝
- [ ] Phase 7 — 패키징(`.vsix`)

> API 키는 VSCode SecretStorage에만 저장되며, 설정 파일·코드·로그에 평문으로 남지 않습니다.
