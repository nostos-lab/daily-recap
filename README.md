# DailyRecap

AI 코딩 세션 로그(Claude Code `.jsonl`)를 읽어 **"오늘의 의사결정 recap"** 회고 문서를 자동 생성하고, **로컬 마크다운 / Obsidian**에 기록(append)하는 무료 VSCode·Cursor 확장입니다.

회고는 누구나 하고 싶어 하지만 *쓰는 마찰* 때문에 거의 못 합니다. DailyRecap은 그 마찰을 거의 0으로 만들어, "오늘 무슨 결정을 왜 내렸고 어떤 결과를 얻었는지"가 **노력 없이 매일 쌓이게** 합니다. 발행·수익화와 무관한 **개인 회고/지식 보존 도구**이며, 사용자가 자신의 API 키를 넣어 쓰는 **BYOK(Bring Your Own Key)** 모델입니다.

> 상태: v1 (개인용). 마켓플레이스 게시는 선택이며, 기본은 로컬 `.vsix` 설치입니다.

## 특징

- **원재료 = AI 세션 로그**: `~/.claude/projects/*.jsonl`에서 사용자 프롬프트·assistant 응답·도구 호출을 복원해 "왜"의 맥락을 살립니다.
- **git 커밋 폴백**: 세션 로그가 없거나 비어 있으면 그날 커밋·변경 파일로 recap을 만듭니다.
- **의사결정 회고 골격**: 결정 → 맥락/판단(Y-Statement) → 결과 → 막힌 점 → 다음, 4축 구조 고정.
- **환각 억제**: 원재료에 없는 사실·수치는 쓰지 않고, 수치·인용에는 출처 태그를 강제합니다. 사용자가 명시적으로 선택한 것만 "결정"으로 단정합니다.
- **기록 목적지**: 로컬 마크다운, Obsidian vault(파일 직접 쓰기, 앱·인증 불필요).
- **BYOK·프라이버시**: API 키는 우리 서버를 거치지 않고 OS 보안 저장소(SecretStorage)에만 저장. 원재료는 LLM 전송 전 키·토큰·이메일을 마스킹합니다.

## 동작 방식

`recap.generate` 한 번으로: 프로젝트 선택 → 날짜 선택 → 원재료 수집 → (2단 LLM 호출) → 미리보기 → 기록까지 한 흐름으로 진행됩니다.

LLM은 2단계로 호출합니다. (1) Citations API로 인용·결정·수치를 추출하고, (2) 그 결과로 recap 마크다운을 생성합니다. (Citations와 Structured Outputs는 같은 호출에서 못 쓰므로 분리합니다.)

## 설치

### 요구사항
- Node.js 18+ (권장 20+)
- VSCode 1.85+ 또는 Cursor
- Anthropic API 키 (https://console.anthropic.com/account/keys — 사용량은 구독과 별개로 크레딧 충전 필요)

### 개발 모드로 실행
```bash
npm install
npm run compile        # 또는 npm run watch
```
이 폴더를 VSCode/Cursor로 열고 `F5` → 확장 개발 호스트가 뜹니다.

### `.vsix`로 빌드해서 로컬 설치
```bash
npm run package        # vsce package → dailyrecap-x.y.z.vsix 생성
code --install-extension dailyrecap-0.0.1.vsix    # Cursor는: cursor --install-extension ...
```

## 사용법

1. 명령 팔레트(`Cmd/Ctrl+Shift+P`) → **DailyRecap: API 키 설정** (`recap.setApiKey`)으로 Anthropic 키 저장.
2. **DailyRecap: recap 생성** (`recap.generate`) 실행.
3. 프로젝트 선택 → 날짜 선택(로그가 있는 날짜가 우선 표시) → 토큰 규모 확인 → 생성.
4. 미리보기 패널 확인 후 기록 위치(로컬 / Obsidian) 선택 → append.

세션 로그가 없는 프로젝트라면 git 커밋으로 진행할지 물어봅니다.

## 설정

| 설정 | 기본값 | 설명 |
|---|---|---|
| `recap.provider` | `anthropic` | LLM 제공자 (v1은 anthropic 고정) |
| `recap.model` | `claude-sonnet-4-6` | Anthropic 모델명 (최신값은 https://docs.claude.com 확인) |
| `recap.source` | `session` | 원재료 소스. `session`(세션 로그) 또는 `git`(커밋) |
| `recap.sink` | `local` | 기록 목적지 기본값 (`local`/`obsidian`/`notion`) |
| `recap.outputDir` | `./recaps` | 로컬 기록 디렉터리 |
| `recap.obsidianVault` | (없음) | Obsidian vault 절대 경로 |
| `recap.lang` | `auto` | recap 언어 (`auto`는 IDE 로케일을 따름) |

기록 경로: 로컬은 `<outputDir>/YYYY/MM/DD-recap.md`, Obsidian은 `<vault>/_Recap/YYYY/MM/DD.md`. 같은 날짜 파일이 있으면 구분선과 함께 append하고, 동일 내용은 건너뜁니다.

## 프라이버시·보안

- API 키는 **SecretStorage(macOS 키체인 등)**에만 저장되며 `settings.json`·코드·로그·외부 서버 어디에도 평문으로 남지 않습니다.
- 호출은 사용자의 키로 Anthropic에 **직접** 이뤄집니다(우리 서버 미경유).
- 원재료를 프롬프트에 넣기 전 API 키·토큰·이메일·JWT 등을 정규식으로 마스킹합니다.

## 폴더 구조

```
dailyrecap/
├─ src/
│  ├─ extension.ts          # 진입점: 명령 등록 + recap.generate 전체 플로우
│  ├─ secrets.ts            # SecretStorage(BYOK) 키 저장/조회
│  ├─ types.ts              # RawMaterial 등 핵심 타입
│  ├─ readers/
│  │  ├─ sessionReader.ts   # Claude Code .jsonl 방어적 파서
│  │  ├─ projectPaths.ts    # 워크스페이스 → ~/.claude/projects 매핑
│  │  └─ gitReader.ts       # git 커밋 폴백 리더
│  ├─ prompts/
│  │  ├─ recap-template.ts  # 2단 프롬프트(추출/생성) + Y-Statement + anti-hallucination
│  │  ├─ recap-skeleton.md  # 출력 골격(4축)
│  │  └─ masking.ts         # 민감정보 마스킹
│  ├─ llm/
│  │  ├─ types.ts / errors.ts / budget.ts
│  │  ├─ anthropic.ts       # fetch 직접 호출 + 스트리밍 + Citations
│  │  ├─ providers.ts       # getProvider 팩토리 (OpenAI/Ollama는 stub)
│  │  └─ recapRunner.ts     # 2단 호출 오케스트레이션
│  ├─ sinks/index.ts        # LocalSink / ObsidianSink (Notion stub)
│  └─ preview/render.ts     # 마크다운→HTML + 웹뷰(CSP)
├─ test/                    # node --experimental-strip-types 기반 테스트
├─ ROADMAP.md
└─ package.json
```

## 개발 / 테스트

```bash
npm test          # 6개 스위트(parser/prompt/llm/sink/e2e/git), 컴파일 없이 실행
npm run compile   # tsc 타입 검사 + out/ 빌드
```

테스트는 Node의 `--experimental-strip-types`로 TypeScript를 직접 실행하며, LLM·git은 주입형 의존성으로 실제 네트워크/시스템 없이 검증합니다.

## 로드맵

[ROADMAP.md](./ROADMAP.md) 참고. 다음 우선순위: ① 세션+git 융합으로 "결과" 축 보강 → ② 사후 grounding 검증기 → ③ Ollama(로컬) 프로바이더.

## 라이선스

[MIT](./LICENSE)
