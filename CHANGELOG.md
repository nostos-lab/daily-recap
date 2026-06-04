# Changelog

## [0.0.1] - 2026-06-04

첫 동작 버전(v1).

### Added
- `recap.setApiKey` / `recap.generate` 명령.
- Claude Code 세션 로그(`.jsonl`) 방어적 파서 + 워크스페이스 자동 매칭(+ 수동 선택 폴백).
- git 커밋 폴백 리더, 세션 비어있을 때 git 폴백 제안.
- 2단 LLM 호출(Citations 추출 → recap 생성), Anthropic 어댑터(fetch, 스트리밍).
- 의사결정 회고 골격(4축) + Y-Statement + anti-hallucination + 암묵적 수용 가드레일.
- 기록 목적지: 로컬 마크다운, Obsidian vault (append/중복 방지).
- BYOK(SecretStorage) + 원재료 민감정보 마스킹.
- 날짜 선택 시 실제 로그/커밋이 있는 날짜 우선 표시, 프로젝트 재선택(뒤로가기).

### Notes
- OpenAI/Ollama 프로바이더, Notion 기록은 stub(향후). [ROADMAP.md](./ROADMAP.md) 참고.
