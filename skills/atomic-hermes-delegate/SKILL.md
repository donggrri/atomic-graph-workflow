---
name: atomic-hermes-delegate
description: "Hermes-only stage delegation: route plan/explore/review/implement stages to cursor-agent or opencode via hermes-delegate.mjs."
---

# Hermes Atomic delegation

Hermes에서 `/atomic-workflow` 또는 `/atomic-lite`를 실행할 때, **각 그래프 스테이지마다** 부모(Hermes)가 직접 코딩하지 않고 아래 스크립트를 **터미널 도구로만** 호출한다.

## 필수 규칙

1. **스테이지는 순차 실행** — 한 번에 하나의 `run`만 호출하고, 종료·로그를 확인한 뒤 다음 스테이지로 진행한다.
2. **스테이지를 작게 유지** — 긴 파이프라인은 그래프 노드 단위로 나눈다.
3. **터미널만 사용** — Hermes `hermes-cursor-provider` 사용 시 **terminal 툴셋만** 켜고, 아래 명령을 실행하려면 **명시적 `tool_call`** 로 스크립트를 호출한다. 다른 도구로 우회하지 않는다.
4. **오케스트레이터 모델** — 부모 Hermes 세션은 `hermes-cursor-provider` 브리지로 **`grok-4.7-medium`** 을 쓴다. `~/.hermes/config.yaml`에 `model.default: grok-4.7-medium` 을 설정한다(설치 스크립트는 이 파일을 수정하지 않음). 이름에 **`fast`** 가 들어간 모델은 사용하지 않는다.
5. **`--dangerously-skip-permissions` 는 절대 사용하지 않는다.**
6. **브리프는 파일로 작성** — Hermes oneshot은 heredoc과 `node -e`를 막을 수 있다. 스테이지 브리프는 **파일 쓰기 도구**(또는 Hermes가 허용하는 write/edit 도구)로 `<brief.md>` 등에 저장한 뒤 `--prompt-file`로 전달한다.
7. **agy는 명시 설정만** — 기본 라우팅·폴백에는 `agy`가 없다. `graph.yaml` 노드/`hermes.routing` 또는 `ATOMIC_HERMES_ROUTING`으로 executor를 `agy`로 지정한 경우에만 사용한다.

## 명령 (워크플로 패키지 루트 기준)

라우팅 확인:

```bash
node <workflow>/scripts/hermes-delegate.mjs route <stage>
```

스테이지 실행 (프롬프트 파일은 Hermes가 스테이지 브리프를 작성해 저장):

```bash
node <workflow>/scripts/hermes-delegate.mjs run <stage> --workspace <repo> --prompt-file <brief.md>
```

설치된 프로젝트에서는:

```bash
node .atomic/scripts/hermes-delegate.mjs run <stage> --workspace . --prompt-file <brief.md>
```

`route` 출력 JSON: `{ stage, runner, model, fallback, fallbackEnabled }` (알 수 없는 `cursor-agent` 모델이면 `warning` 필드와 stderr 경고 후 `composer-2.5`로 정규화). `run`은 JSONL 로그에 한 줄 추가한다 (`<docsRoot>/hermes-delegate.log` 및 `.atomic/hermes-delegate.log`). 실패 시 `stderrTail`·`message`가 기록된다.

폴백 비활성: `graph.yaml`의 `hermes.fallback: false`, 스테이지별 `hermes.routing.<stage>.fallback: false`, 또는 `ATOMIC_HERMES_ROUTING` JSON의 `"fallback": false` / 스테이지 객체의 `fallback: false`.

### cursor-agent 모델 (Hermes 허용 목록)

| id | 용도 |
| --- | --- |
| `composer-2.5` | execute·fix·docs·wrapup 기본 |
| `claude-haiku-5-5-high` | explore·test 기본 |
| `claude-sonnet-5-5-high` | plan·spec·review 기본 |
| `grok-4.7-high` | plan-review·spec-review·escalate 기본 |

별칭: `haiku-5.5-high`, `sonnet-5.5-high`. **`fast`** 모델명은 거부된다.

### opencode 폴백 모델

기본 폴백 runner는 `opencode` (`opencode run -m <model> <prompt>`, 저장소 cwd, 단일 실행 lock). 허용 예: `opencode/deepseek-v4.1-flash-free`, `opencode/glm-5.3-flash-free`.

기본 자동 라우팅(오버라이드 없을 때): explore·test → cursor-agent haiku (폴백 opencode glm); execute·implement·fix·task·docs → composer-2.5 (폴백 opencode deepseek); plan·spec·review → sonnet (폴백 opencode glm); plan-review·spec-review·escalate → grok-4.7-high (폴백 opencode glm).

`plan`·`plan-review`는 헤드리스에서 권한 차단되지 않도록 `cursor-agent`는 `--trust --force`, `opencode`는 임시 `OPENCODE_CONFIG`(bash/edit allow)로 실행한다. opencode 동시 실행은 `.atomic/opencode-run.lock`으로 직렬화한다(대기: `ATOMIC_OPENCODE_LOCK_WAIT_SEC`, 기본 120).

## Hermes 동작

1. 사용자가 atomic 워크플로를 시작하면 그래프(` .atomic/graph.yaml`)의 현재 스테이지를 결정한다.
2. 각 스테이지마다 브리프를 파일로 쓰고 `hermes-delegate.mjs run …`을 **터미널**로 실행한다.
3. 종료 코드·로그를 읽고, 그래프 엣지(`on: pass|fail|…`)에 따라 다음 스테이지를 고른다.
4. `atomic-workflow` / `atomic-lite` 스킬의 Phase 지침과 이 위임 규칙을 함께 따른다.

기본 라우팅·오버라이드는 `scripts/lib/hermes-routing.mjs`에 정의되어 있다.
