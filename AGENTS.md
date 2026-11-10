# AGENTS.md — Penrose Studio 확장 개발 지침

이 저장소는 alid 앱·커널이 아니라, GitHub에서 설치하는 **독립 외부 확장**입니다. Penrose trio와 `@penrose/core` 최적화 엔진을 Worker 안에 내장하고, 스코프/멤버 엔티티로 캔버스에 통합합니다.

> 작은 코어, 기능은 확장으로. 문서에는 사용자 의도만, 호스트 연결은 공개 계약만.

## 1. 작업 전 읽기

1. [README.md](README.md): 설치·사용법·**측정값과 한계**.
2. [docs/architecture.md](docs/architecture.md), [docs/p0-spike.md](docs/p0-spike.md): 파이프라인, 워커 계약, P0 측정.
3. [extension.json](extension.json), [src/manifest.ts](src/manifest.ts): 패키지 계약, 명령·계산 노드 ID.
4. [src/penrose/schema.ts](src/penrose/schema.ts), [src/penrose/computed.ts](src/penrose/computed.ts): 정본 스키마와 파생 그래프.
5. [src/penrose/documents.ts](src/penrose/documents.ts), [src/penrose/manipulate.ts](src/penrose/manipulate.ts): 모든 정본 쓰기와 드래그 경계.
6. [src/penrose/engine/](src/penrose/engine/): 워커 프로토콜과 엔진. `core.ts`는 워커·테스트 전용입니다.

## 2. 언어와 빌드

- 소스는 TypeScript 하나입니다. Rust·Wasm 크레이트·별도 빌드 단계는 없습니다.
- `pnpm build` = `scripts/build-worker.mjs`(Penrose 워커 → `src/generated/penrose-worker.ts`) → Vite 번들 → 설치 명세 SHA-256 갱신.
- `dist/plugin.js`, `alid.extension.json`, `src/generated/penrose-worker.ts`는 **커밋하는 생성 산출물**입니다. 직접 편집하지 않습니다.
- **메인 청크는 `@penrose/core`를 값으로 import할 수 없습니다.** 엔진은 워커 문자열에 한 번만 들어가야 하며, 5 MiB 설치 한도를 넘으면 `vite.config.ts`가 빌드를 실패시킵니다. 워커는 4.4 MiB 예산을 `build-worker.mjs`에서 강제합니다.
- 확장 소스에서 `@alid/*`, React, 분리 청크·에셋을 import하지 않습니다. 허용 런타임 import는 `vite.config.ts`의 `sharedImports`뿐입니다.
- 워커는 Blob + `type: 'module'`로 띄웁니다. 워커 번들에 `import`가 남으면 빌드가 실패합니다.
- 테스트는 실제 alid 커널 + Loro Wasm 코어 위에서 **빌드된 번들**을 돌립니다. Node에는 Web Worker가 없으므로 하네스가 `globalThis.__PENROSE_ENGINE_FACTORY__`에 인라인 엔진을 주입합니다. 이 훅은 테스트 전용입니다.

```sh
pnpm typecheck
pnpm test        # build + vitest
pnpm check:dist
pnpm dev         # http://127.0.0.1:5174
```

## 3. 파일별 책임

| 파일 | 책임 / 수정 원칙 |
| --- | --- |
| `src/penrose/engine/core.ts` | `@penrose/core` 호출, 라벨 측정, Shape 직렬화, 드래그 스텝. **워커·테스트 밖에서 import 금지.** |
| `src/penrose/engine/worker-entry.ts` | 메시지 루프와 스코프별 세션. 상태에 함수가 있어 `State`는 워커를 떠나지 않습니다. |
| `src/penrose/engine/client.ts` | Blob 워커 RPC, 요청 ID, 실패 시 정리. 엔진 import 금지. |
| `src/penrose/engine/inline.ts` | 테스트 전용 인라인 엔진. 프로덕션 번들에 포함되지 않습니다. |
| `src/penrose/wire.ts` | 워커↔메인 평면 데이터 계약. |
| `src/penrose/labels.ts` | DOM 없는 결정적 텍스트 메트릭. 정책을 바꾸면 digest 버전도 올립니다. |
| `src/penrose/digest.ts` | 비암호학적 캐시 키(FNV-1a 64). |
| `src/penrose/schema.ts` | `penrose.scope`/`penrose.member` 필드와 digest 입력. |
| `src/penrose/runtime.ts` | 워커 세션 캐시, Cold/Dirty, 비동기 무효화, 핀 적용. **정본 쓰기 금지.** |
| `src/penrose/computed.ts` | Computed 2종과 멤버 기하·히트 테스트. 쓰기 금지. |
| `src/penrose/render.ts` | 순수 SVG. `<foreignObject>`·DOM·`url()`·`<marker>` 금지. 문자열은 이스케이프. |
| `src/penrose/aspects.ts` | 어스펙트 정의, 스코프 렌더, 선택 기여. |
| `src/penrose/documents.ts` | 삽입·DSL 적용·멤버 동기화·드래그 커밋·핀. **모든 정본 쓰기.** |
| `src/penrose/manipulate.ts` | 기즈모, 포인터 드래그, 취소. 핸들은 최적화 입력에만. |
| `src/penrose/panels.ts` | Tri-DSL·진단 패널. 로컬 UI 상태만. 패널은 활동 레일에서 열립니다(`ui.shell`은 확장에 비공개). |
| `src/penrose/bake.ts` | `vector.path` 베이킹. 지원하지 않는 도형은 건너뜁니다. |
| `src/__tests__/` | 실제 커널 하네스. `src/penrose/__tests__/` | alid 없이 도는 순수 테스트. |

## 4. 불변식

1. **정본 순수성.** `penrose.scope`에는 trio, `variation`, `topologyDigest`, `varyingValues`, `pins`, `entityBindings`, `solverConfig`만 둡니다. 컴파일 결과·SVG·함수를 저장하지 않습니다. `penrose.member`에는 소속·owner·핀·라벨만 둡니다.
2. **읽기 시 쓰기 금지.** Computed, `derive`, `renderSvg`, 패널 조회, 붙여넣은 스코프 해석은 `applyCanonicalTransaction`을 호출하지 않습니다. 스코프를 열고, 움직이고, 내보내는 동안 커밋은 0회여야 합니다.
3. **드래그는 한 번만 쓴다.** 이동 중에는 워커 캐시와 Computed만 갱신합니다. 놓을 때 `varyingValues`를 한 트랜잭션·한 Undo 그룹으로 기록합니다. Esc/blur/pointercancel은 쓰지 않습니다.
4. **Cold는 최적화 0스텝.** `topologyDigest`가 맞으면 저장된 `varyingValues`로 `computeShapes`만 호출합니다. 캐시가 없을 때만 최적화합니다.
5. **엔진은 워커에 한 번.** 메인 번들의 `@penrose/core` 값 import 금지. 번들 크기 검사가 이를 강제합니다.
6. **결정적 라벨.** DOM 측정을 쓰지 않습니다. Equation은 `liteAdaptor` + SVG 경로, Text는 고정 메트릭 표입니다. 정책을 바꾸면 `scopeDigest`의 `labels:` 버전을 올립니다.
7. **순수 벡터.** 화면과 `compileToPureSvg`가 같은 문자열을 씁니다. `url()`, `<marker>`, `<foreignObject>`, 스크립트, 외부 `href` 금지.
8. **핀은 사용자 의도.** 핀은 `varyingValues` 인덱스와 값으로 저장하고, 수렴 후 다시 덮어씁니다. 기즈모는 모든 자유 입력에 선택과 무관하게 보이며, 핀·읽기 전용·계산 속성에는 만들지 않습니다.
9. **정직성.** 측정하지 않은 브라우저·IME·191개 회귀를 완료로 보고하지 않습니다. README의 측정값과 한계를 테스트 결과와 함께 갱신합니다.

## 5. 스키마 진화

- `penrose.scope.schemaVersion`은 2입니다. 파괴적 변경은 새 필드나 새 어스펙트 ID로 분리하고 기존 문서를 재작성하지 않습니다.
- `entityBindings`의 키는 owner(Substance 객체/컬렉션)입니다. 붙여넣기 후 키가 오래되면 `scopeMembers()`가 멤버의 `scopeId`로 진실을 복원하고, 다음 커밋이 새 키로 저장합니다.
- `penrose.member.scopeId`는 `cascade-hide` 참조입니다. 클립보드가 원자적으로 재매핑합니다.
- 워커 메시지나 `WireShape` 필드를 바꾸면 워커 생성 파일을 다시 커밋합니다.

## 6. 완료 전 확인

- [ ] 요청 범위만 수정했고 어스펙트 ID·필드 의미를 보존했는가?
- [ ] 기능 변경에 맞는 테스트와 README/docs를 갱신했는가?
- [ ] `pnpm typecheck`, `pnpm test`가 통과하는가?
- [ ] `pnpm check:dist`가 통과하도록 생성 산출물 셋을 함께 커밋했는가?
- [ ] 읽기 경로가 정본을 쓰지 않는가? (`zero-write-on-read.test.ts`)
- [ ] 드래그가 정확히 한 번의 Undo 그룹인가? (`manifold-drag-undo.test.ts`)
- [ ] SVG가 결정적이고 순수 벡터인가? (`headless-svg-determinism.test.ts`, `render.test.ts`)
- [ ] 메인 청크에 엔진 코드가 없는가? (`pnpm build` 크기 검사)

Node 테스트는 실제 커널·Loro 코어 위의 계약 검증이지 실제 브라우저·Web Worker·IME 검증이 아닙니다. 완료 보고에는 실행한 명령과 결과, 수동 확인 여부, 미검증 범위를 구분합니다.
