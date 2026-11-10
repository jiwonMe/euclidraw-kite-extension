# Penrose Studio (`penrose.studio`)

alid(EucliDraw) 캔버스에서 **Penrose** 도해를 그리고, 자유도가 있는 객체를 기즈모로 직접 움직이는 확장입니다. Penrose의 Domain · Substance · Style trio를 그대로 쓰고, `@penrose/core` 3.3.1(MIT)을 이 확장의 Worker 안에 내장합니다.

- 스코프 엔티티가 다이어그램 전체를 한 레이어로 그립니다.
- Substance 객체(또는 컬렉션) 하나가 **멤버 엔티티** 하나입니다. 선택, 연결선 앵커, `layoutBounds`가 일반 캔버스 객체처럼 동작합니다.
- 정본에는 trio, `variation`, `topologyDigest`, 마지막 수렴 입력(`varyingValues`), 핀, 멤버 바인딩만 저장합니다. 화면 기하는 전부 파생입니다.
- 읽기·페인트·내보내기는 문서를 쓰지 않습니다. 드래그는 놓을 때 한 번만 커밋합니다.

## 설치

1. alid → 확장 관리 → "저장소에서 설치"에 `jiwonme/euclidraw-kite-extension`을 입력합니다.
2. 설치기는 `alid.extension.json`의 `sha256`으로 `dist/plugin.js`(약 3.1 MiB)를 검증합니다.
3. 선택 의존성: `core.select-suite`, `core.clipboard`, `vector.pen-suite`. 없으면 해당 기능만 꺼집니다(베이킹은 `vector.path`가 필요).

개발 중에는 `pnpm dev`로 감시 빌드 서버(`http://127.0.0.1:5174`)를 띄우고 alid의 "개발 중인 확장 연결"에 주소를 넣습니다. 워커 소스(`src/penrose/engine`, `labels.ts`, `wire.ts`, `schema.ts`)를 고치면 워커를 자동 재빌드합니다.

## 사용법

- 도구 선반의 **Penrose 도해** 또는 `M-x penrose.studio:insert-scope`로 예제를 넣습니다.
- 캔버스 에이전트는 `workspace.tools`에서 **`penrose.studio:create-scope`** 로 새 스코프를 제안할 수 있습니다(`x`/`y`는 새 스코프의 중심, 생략 시 뷰포트 중앙). 툴 콜백은 문서를 직접 쓰지 않고 승인 카드용 변경 계획만 만들며, 적용은 호스트가 합니다. `penrose.studio:list-scopes`는 기존 스코프의 위치·크기·적용 여부를 돌려줘 "아래에 하나 더" 같은 배치를 계산할 수 있게 합니다. `penrose.scope`·`penrose.member`는 엔티티 디스크립터로도 노출됩니다.
- 기즈모는 **선택했을 때만** 보입니다. 스코프를 선택하면 그 안의 모든 자유 입력에, 멤버를 선택하면 그 객체의 자유 입력에 핸들이 생깁니다. 선택이 없으면 표시하지 않습니다. 기즈모는 호스트 선택 핸들과 같은 팔레트의 원형(흰 채움 + `var(--alid-accent)` 테두리)으로 HUD에 그려지고, 도형 드래그뿐 아니라 스코프 이동 미리보기(ScratchOverlay)도 즉시 따라갑니다. 내보내기 SVG에는 포함되지 않으며 스코프 캔버스 밖 좌표에는 표시하지 않으며, 도해 본문은 스코프 뷰포트로 클립됩니다. 핀이 걸린 입력, 읽기 전용 스코프, 식으로 계산된 속성에는 핸들이 없습니다.
- 핸들을 끄는 동안 포인터 목표는 이징 없이 그대로 워커로 전달되고(포인터가 멈춰도 16ms마다 다시 보내 수렴을 이어갑니다), 문서는 바뀌지 않으며, 워커가 매 프레임 최대 **10ms 예산**으로 주변을 다시 수렴시키며 AutoLabel·`Label` 텍스트도 소유자 점을 따라 함께 이동합니다(수렴·재핀 3회 교대, penalty weight는 도해 크기에 따라 1e8/1e7/1e5). 투영 핸들은 마지막에 포인터 위치로 정확히 보정합니다. 놓을 때는 **같은 드래그 스테이지에서 짧게(120ms) 재수렴**하고 끈 입력을 되돌리며, 악화되는 프레임은 버려 점프를 막은 뒤 한 트랜잭션으로 커밋하며, Undo 한 번으로 원복됩니다. Esc·blur·pointercancel은 아무것도 쓰지 않습니다. `solverConfig.dragBudgetMs`(기본 10ms)로 예산을 조정하고, 0이면 고정 2스텝을 씁니다.
- **투영 핸들**: 화면의 점이 자유 입력의 계산 결과여도(예: 3D 점을 원근 투영한 삼각형 꼭짓점) 그 점을 직접 끌 수 있습니다. 확장은 컴파일 시 각 점의 2D 야코비안을 수치적으로 구하고, 드래그를 최소노름 입력 변화로 풀어 다시 수렴시킵니다. 깊이처럼 2D로 결정되지 않는 자유도는 현재 값 근처를 유지합니다.
- **Tri-DSL 패널**에서 세 DSL을 고치고 ⌘/Ctrl+Enter로 적용합니다. 컴파일과 수렴이 끝난 뒤 DSL·수렴 입력·멤버가 한 트랜잭션으로 들어가고, canvas 크기가 바뀌면 스코프 상자도 그 크기로 맞춰집니다.
- 선택 바에는 **다시 수렴**·**재표본** 아이콘 버튼이 있고, Tri-DSL 편집기는 선택 바 버튼 대신 활동 레일의 패널에서 엽니다. 호스트가 `ui.shell`을 확장에 공개하지 않으므로, `open-tri-editor`/`open-diagnostics` 명령은 열 수 있으면 열고 아니면 레일 위치를 안내합니다.
- **진단 패널**은 digest, 자유 입력 수, 이동/크기 가능 도형 수, 단계, 에너지, 핀 수, 경고를 보여 줍니다.

### 명령

| 명령 | 설명 |
|---|---|
| `penrose.studio:insert-scope` | 예제 trio 삽입 (P) |
| `penrose.studio:apply-dsl` | trio 적용 / 재컴파일 |
| `penrose.studio:reset-example` | 예제로 되돌리기 |
| `penrose.studio:reproject` | 현재 입력에서 다시 수렴 |
| `penrose.studio:resample` | `variation`을 올려 초기 배치 재표본 |
| `penrose.studio:toggle-pin` | 선택 멤버의 입력 고정/해제 |
| `penrose.studio:bake-to-vector` | 도형을 `vector.path`로 굽고 스코프 제거 |
| `penrose.studio:open-tri-editor` | Tri-DSL 패널 |
| `penrose.studio:open-diagnostics` | 진단 패널 |

## DSL 맛보기

Penrose 문법 그대로입니다. 전체 문법은 [Penrose 문서](https://penrose.cs.cmu.edu/docs/ref)를 보세요.

```penrose
-- Domain
type Point
type Circle

-- Substance
Point A
Point B
Circle c

-- Style
canvas { width = 520  height = 380 }

forall Point p {
  p.icon = Circle { r: 6; fillColor: #2563eb; strokeColor: #1e3a8a; strokeWidth: 1 }
}
forall Circle c {
  c.icon = Circle { r: 96; fillColor: #00000000; strokeColor: #64748b; strokeWidth: 2 }
  c.eq = Equation { string: "x^2 + y^2 = r^2"; center: (0, 150); fontSize: "16px" }
  c.title = Text { string: "Penrose × alid"; center: (0, -164); fontSize: "15px" }
}
```

## 구조

```
메인 스레드 (호스트)                          워커 (Blob, 번들에 문자열로 내장)
penrose.scope 정본 ── trio·variation ──▶      compileTrio → MathJax 라벨 → 최적화
  Computed (동기, 캐시만 읽음)                  │
    computed.penrose.compiled ◀── Shape[] ─────┤
    computed.penrose.layout   ◀── Shape[] ─────┘
순수 SVG 렌더 (화면 = 내보내기)
```

- 워커는 `compile`, `layout`, `drag`, `converge`, `resample`, `dispose` 메시지만 받습니다.
- 메인 번들은 엔진을 문자열로 한 번만 포함합니다. `@penrose/core`를 값으로 import하면 5 MiB를 넘으므로 타입 전용 import만 허용합니다.
- 자세한 설계는 [docs/architecture.md](docs/architecture.md), P0 측정은 [docs/p0-spike.md](docs/p0-spike.md).

## 개발

```sh
pnpm install
pnpm build        # worker 생성 → vite 번들 → alid.extension.json
pnpm test         # 빌드 후 vitest (로컬 alid 체크아웃이 있으면 실제 커널 통합 테스트)
pnpm typecheck
pnpm check        # typecheck + test + 커밋된 산출물 일치
```

`dist/plugin.js`, `alid.extension.json`, `src/generated/penrose-worker.ts`는 **커밋하는 생성 산출물**입니다. 직접 편집하지 않습니다.

통합 테스트는 `$ALID` 또는 `~/Workspace/alid`가 있어야 돌고, 없으면 건너뜁니다. 순수 렌더러·측정·digest 테스트는 alid 없이도 돕니다.

## 측정값과 한계 (정직한 보고)

- Node + 인라인 엔진, 기본 예제(점 3 · 원 1 · Equation · Text): 컴파일+수렴 **37 ms**, 첫 레이아웃 8 ms, 드래그 프레임 중앙값 **1.6 ms**·p95 1.8 ms. 실제 브라우저 Web Worker 왕복은 측정하지 않았습니다.
- 엔진 워커 2.88 MiB(gzip 0.82 MiB), 최종 번들 3.1 MiB.
- 텍스트 측정은 고정 Helvetica 메트릭 표입니다. `<text>`는 플랫폼 폰트로 그려지므로 측정과 실제 글리프 폭이 어긋나 좁은 상자에서 넘칠 수 있습니다. Equation은 MathJax 경로라 결정적입니다.
- 드래그는 Penrose처럼 완전한 구속 고정이 아니라 **입력 재핀 + 제한 스텝**입니다. 놓을 때 0스텝 재핀으로 입력을 정확히 고정하지만, 주변 도형은 근사 최적화 상태입니다. 다만 드래그 프레임은 현재 단계와 직전 단계(보통 `rects`)를 합친 스테이지에서 돌기 때문에 `disjoint`가 평가되고, 이웃이 겹치는 대신 비켜납니다.
- 페널티 기반 최적화라 직각·원 위의 점이 v1처럼 정확히 만족되지는 않습니다. 의도된 트레이드오프입니다.
- 투영 핸들은 자유 입력 96개·핸들 160개, 야코비안 계산 250ms까지만 만듭니다. 야코비안은 컴파일 시 자유 입력 수만큼 `computeShapes`를 한 번씩 돌려 계산하므로, 아주 큰 도해에서는 이 기능이 생략됩니다. 2D 드래그로 결정되지 않는 자유도(깊이 등)는 최소노름 해로 현재 값 근처에 머뭅니다.
- `Path`·`Group`은 선택 기하만 제공하고 기즈모가 없습니다. Line·Polygon 정점을 하나씩 끄는 정점 핸들은 아직 없습니다(도형 전체 이동만). `Image`는 `data:` URI(일반·base64)와 Penrose 공식 예제의 소형 SVG 에셋 이름(`ball-shading.svg` 등)을 지원하며, 인라인 SVG의 그라디언트도 그대로 렌더합니다. 그 밖의 외부 URL은 로드하지 않습니다. 베이킹은 Circle·Ellipse·Line·Rectangle·Polygon·Polyline만 지원합니다.
- Penrose 레지스트리 191개 전체 회귀는 아직 없습니다. 호스트 계약 4종, 기본 예제, staged layout 다중 간선 예제(AutoLabel·Path·staged objectives)를 자동 검증합니다.
- 빌드된 워커 번들은 `worker_threads`로 실제 실행해 컴파일·MathJax 라벨 왕복을 검증합니다. 다만 브라우저 Blob URL 로더·CSP·한글 IME·터치 기기는 수동 검증하지 않았습니다.
- v1 `kite.studio` 문서는 마이그레이션하지 않습니다. ID가 `penrose.studio`로 바뀌어 v1 스코프는 읽히지 않습니다.

## 라이선스

이 저장소의 코드는 [LICENSE](LICENSE)를 따릅니다. 번들에 포함한 제3자 라이선스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 있습니다.
