# DailyRecap

[![Version](https://img.shields.io/visual-studio-marketplace/v/nostos-lab.dailyrecap)](https://marketplace.visualstudio.com/items?itemName=nostos-lab.dailyrecap)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/nostos-lab.dailyrecap)](https://marketplace.visualstudio.com/items?itemName=nostos-lab.dailyrecap)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

**오늘 무슨 결정을 왜 내렸고, 그래서 무엇을 얻었는지** — AI 코딩 세션이 끝나면 명령 하나로 "의사결정 회고(recap)"를 자동으로 만들어 줍니다.

회고는 누구나 하고 싶어 하지만 *쓰는 마찰* 때문에 거의 못 합니다. DailyRecap은 그 마찰을 거의 0으로 만들어, 하루의 결정과 맥락이 **노력 없이 매일 쌓이게** 합니다. 발행이 아니라 **나를 위한 기록**입니다.

## 무엇을 해주나요

- **결정 중심 회고**: 오늘 한 줄 → 어떤 결정을 내렸나 → 왜 그렇게 판단했나 → 어떤 결과를 얻었나 → 막힌 점 → 다음. 일관된 구조로 정리됩니다.
- **세션에서 "왜"를 복원**: Claude Code 세션 로그를 읽어 그날의 프롬프트·판단·작업 흐름에서 결정의 맥락을 되살립니다.
- **지어내지 않습니다**: 기록에 없는 사실·수치는 쓰지 않고, 인용에는 출처를 답니다. 당신이 명시적으로 선택한 것만 "결정"으로 적습니다.
- **바로 적립**: 결과물을 띄우고 끝나는 게 아니라, **로컬 마크다운**이나 **Obsidian vault**에 날짜별로 기록합니다.
- **내 키, 내 데이터(BYOK)**: API 키는 OS 보안 저장소에만 저장되고, 호출은 당신의 키로 직접 이뤄집니다. 우리 서버를 거치지 않습니다.

## 설치

**VS Code**: 확장 패널(`Cmd/Ctrl+Shift+X`)에서 **"DailyRecap"** 검색 → Install. 또는 [마켓플레이스 페이지](https://marketplace.visualstudio.com/items?itemName=nostos-lab.dailyrecap)에서 설치.

**Cursor / 기타**: `.vsix`를 받아 확장 패널 `…` → *Install from VSIX*로 설치하면 됩니다.

준비물: 사용량 크레딧이 있는 [Anthropic API 키](https://console.anthropic.com/account/keys) (구독과 별개로 청구됩니다).

## 사용법

1. 명령 팔레트(`Cmd/Ctrl+Shift+P`) → **DailyRecap: API 키 설정** 으로 키를 한 번 저장합니다.
2. **DailyRecap: recap 생성** 실행.
3. 프로젝트 → 날짜(로그가 있는 날짜가 우선 표시됨) 선택 → 미리보기 확인 → 기록 위치(로컬 / Obsidian) 선택.

세션 로그가 없는 날에는 그날의 **git 커밋**으로 대신 만들 수 있습니다.

## 설정

| 설정 | 기본값 | 설명 |
|---|---|---|
| `recap.model` | `claude-sonnet-4-6` | 사용할 Anthropic 모델 |
| `recap.source` | `session` | 원재료 소스 (`session` 또는 `git`) |
| `recap.sink` | `local` | 기록 위치 (`local` / `obsidian`) |
| `recap.outputDir` | `./recaps` | 로컬 기록 폴더 |
| `recap.obsidianVault` | (없음) | Obsidian vault 절대 경로 |
| `recap.lang` | `auto` | 출력 언어 (`auto`는 에디터 언어를 따름) |

기록 경로 — 로컬: `<outputDir>/YYYY/MM/DD-recap.md`, Obsidian: `<vault>/_Recap/YYYY/MM/DD.md`. 같은 날 다시 만들면 이어 붙이고, 동일 내용은 건너뜁니다.

## 프라이버시

API 키는 에디터의 보안 저장소(SecretStorage, macOS는 키체인)에만 저장되며 설정 파일·로그·외부 서버 어디에도 평문으로 남지 않습니다. 원재료를 모델에 보내기 전 키·토큰·이메일은 자동으로 가려집니다.

## 라이선스

[MIT](./LICENSE)

---

### 개발 (기여자용)

```bash
npm install
npm run compile      # 타입 검사 + 빌드
npm test             # 테스트
npm run package      # .vsix 빌드
```

진행 중인 방향은 [ROADMAP.md](./ROADMAP.md) 참고. 이슈·PR 환영합니다.
