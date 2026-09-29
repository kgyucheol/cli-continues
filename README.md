# continues (fork)

> **원본:** [yigitkonur/cli-continues](https://github.com/yigitkonur/cli-continues) — MIT © [Yigit Konur](https://github.com/yigitkonur)
> 이 저장소는 원본을 포크해 **최신 Codex(Codex Desktop, CLI 0.153+) 세션을 제대로 읽도록 개선**한 버전입니다. 그 밖의 기능과 사용법은 원본과 같습니다.

AI 코딩 도구를 쓰다가 토큰·사용량 한도에 걸리면, 지금까지의 대화·명령·수정 파일을 정리해 **다른 도구에서 바로 이어서** 작업할 수 있게 해 줍니다.
예: Claude Code 한도 초과 → Codex로 이어서, 또는 그 반대.

## 이 포크에서 달라진 점

최신 Codex는 세션 기록 형식이 바뀌어 원본(v4.1.1)으로는 내용이 대부분 비어 보였습니다.

| 항목 | 원본 v4.1.1 | 이 포크 |
|---|---|---|
| 세션 목록 요약 | `(no summary)` | 실제 첫 요청이 표시됨 |
| 수정한 파일 | 0개로 나옴 | 실제 변경 파일이 모두 나옴 (diff 포함) |
| 실행한 명령 | 내부 JS 코드만 보임 | 명령어·종료 코드가 정리되어 나옴 |
| 자동 승인 검토용 내부 세션 | 목록에 섞여 나옴 | 목록에서 제외 |
| 여러 파일로 나뉜 한 스레드 | 중복으로 나옴 | 하나로 묶이고 `codex resume`이 받는 ID 사용 |
| 최근 대화 | 작업 시작/완료 JSON이 자리를 차지 | 실제 대화만 표시 (중단된 턴은 유지) |

## 설치

[Node.js](https://nodejs.org) **22.5 이상**이 필요합니다 (`node --version`으로 확인).

```bash
npm install -g github:kgyucheol/cli-continues
```

- 설치하면 `continues`와 `cont` 명령을 쓸 수 있습니다. 확인: `continues --version` → `4.1.1-fork.1`
- 원본(npm의 `continues`)이 이미 설치되어 있으면 이 버전으로 교체됩니다.
- 업데이트는 같은 명령을 다시 실행하면 되고, 삭제는 `npm uninstall -g continues`입니다.

## 사용법

```bash
continues                            # 세션을 고르고, 이어서 할 도구를 선택 (대화형)
continues list                       # 세션 목록 (--source codex, -n 10, --json)
continues resume <id> --in claude    # 해당 세션을 Claude Code에서 이어가기
continues resume <id> --in codex     # 해당 세션을 Codex에서 이어가기
continues codex                      # 가장 최근 Codex 세션을 Codex에서 그대로 재개
continues inspect <id> --write-md handoff.md   # 넘겨줄 문서만 파일로 저장
```

- 프로젝트 폴더에서 실행하면 그 폴더의 세션이 먼저 나옵니다.
- 넘겨줄 내용의 양은 `--preset minimal | standard | verbose | full`로 조절합니다 (기본 `standard`).
- 세션 파일은 **읽기만** 하고 수정하지 않습니다. `resume`은 프로젝트 폴더에 `.continues-handoff.md`를 만들므로 `.gitignore`에 추가해 두는 것을 권장합니다.

## 지원 도구

Claude Code · Codex · GitHub Copilot CLI · Gemini CLI · Cursor · Amp · Cline · Roo Code · Kilo Code · Kiro · Crush · OpenCode · Factory Droid · Antigravity · Kimi CLI · Qwen Code

도구별 저장 위치와 전체 옵션은 [원본 README](https://github.com/yigitkonur/cli-continues#readme)를 참고하세요.

## 개발

```bash
git clone https://github.com/kgyucheol/cli-continues && cd cli-continues
pnpm install     # 설치 시 자동 빌드
pnpm test
```

## 라이선스

MIT — 원저작권 © Yigit Konur. 이 포크의 변경 사항도 같은 MIT 라이선스를 따릅니다. 자세한 내용은 [LICENSE](LICENSE).
