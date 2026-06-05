# Changelog

## [Unreleased]

### Added
- 외부 멀티 프로바이더 지원: OpenAI 호환 어댑터 1개로 **OpenAI·Google Gemini·xAI Grok** 커버(설정 `recap.provider`, 필요 시 `recap.baseUrl`로 엔드포인트 오버라이드). Citations API는 Anthropic 전용이라 외부 모델은 인라인 추출 경로 사용.
- **Ollama(로컬) 프로바이더**: 같은 OpenAI 호환 어댑터를 재사용(`http://localhost:11434/v1`). API 키 불필요(더미 Bearer 자동 주입), 서버 미기동 시 안내 메시지. 무료·오프라인 옵션.
- 프로바이더별 키 슬롯: `recap.apiKey.<provider>`로 각 프로바이더 키를 따로 저장. `Set API Key`가 어느 프로바이더 키인지 먼저 묻고 해당 슬롯에 저장(키 자동 감지 없음). 기존 단일 anthropic 키는 첫 사용 시 자동 마이그레이션.

### Changed
- UI 영문화: 명령 이름·설정 설명·알림/QuickPick·마켓플레이스 설명을 영어로 통일(글로벌 발견·설치 대비). recap 출력 언어는 `recap.lang`이 별도로 제어.
- 일일 recap 포맷을 **주제별 섹션**으로: 하루를 응집된 작업 주제(예: 회원가입/UI/백엔드)로 나눠 주제마다 4축 섹션을 생성(단일 호출, raw에서 1회 정제 — 이중 정제 손실 없음). 주제 지어내기 금지·모호 시 병합 가드레일.

### Added
- 세션+git 융합: session 소스로 생성 시 같은 날짜의 git 커밋·변경 파일을 "결과" 축 근거(G 태그)로 보강. 설정 `recap.gitEnrich`: `always`(기본, 커밋 있으면 항상) / `auto`(세션 결과 신호 빈약할 때만) / `off`.

## [0.0.2] - 2026-06-04

### Changed
- 마켓플레이스용 제품 README로 재작성(배지 추가), 설명문에서 미구현 Notion 제거.
- 올빼미 마스코트 아이콘 적용.

### Security
- 미리보기 렌더러 XSS 심층 방어(따옴표 이스케이프 + 링크 URL 화이트리스트), CSP `img-src` 축소.
- 미사용 Notion 토큰 코드 제거.

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
