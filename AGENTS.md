# AGENTS.md — EucliDraw Kite Studio 확장 개발 지침

이 저장소는 EucliDraw/alid 앱이나 커널이 아니라, GitHub에서 설치하는 **독립 외부 확장**입니다. Kite의 Domain · Substance · Style 선언과 Wasm SIMD 다양체 정사영 솔버를 캔버스 스코프/멤버 엔티티(PRD 패턴 A)로 구현합니다.

> 작은 코어, 기능은 확장으로. 문서에는 사용자 의도만, 호스트와의 연결은 공개 계약만.

## 1. 작업 전 읽기

1. [README.md](README.md): 설치·사용법·개발 흐름과 **측정값·한계**.
2. [docs/architecture.md](docs/architecture.md), [docs/dsl.md](docs/dsl.md): PRD 대응표, 계산 그래프, 솔버, DSL 문법.
3. [extension.json](extension.json), [src/manifest.ts](src/manifest.ts): 패키지 계약, 명령 ID, 계산 노드 ID.
4. [src/host.ts](src/host.ts), [src/schema.ts](src/schema.ts): 호스트 공개 계약의 구조적 선언과 정본 스키마.
5. [src/computed-bridge.ts](src/computed-bridge.ts), [src/documents.ts](src/documents.ts): 파생 파이프라인과 모든 정본 쓰기.
6. [src/tools/kite-manipulate.ts](src/tools/kite-manipulate.ts), [src/tools/drag-session.ts](src/tools/drag-session.ts): 드래그/Undo 경계.

호스트 서비스·DOM 구조를 추측해 우회하지 말고 공개 `ExtensionPackageSpec` 계약만 사용한다. 선택 서비스는 `PhantomDependency`를 던질 수 있으므로 try/catch로 읽는다.

## 2. 언어와 빌드

- 확장 소스는 **TypeScript(`src/**/*.ts`)**, 솔버는 **Rust(`crate-kite-solver/`)**. 배포물은 단일 ESM `dist/plugin.js`(Wasm base64 내장)와 `alid.extension.json`.
- `pnpm build` = `scripts/build-wasm.mjs`(크레이트 소스 해시가 바뀌었을 때만 `wasm32 +simd128` 빌드 → `src/generated/kite-solver-wasm.ts`) → Vite 번들 → 설치 명세 SHA-256 갱신.
- `dist/plugin.js`, `alid.extension.json`, `src/generated/kite-solver-wasm.ts`는 **Git에 포함하는 생성 산출물**이다. 직접 편집하지 않는다.
- 확장 소스에서 `@alid/*`, React, 분리 청크·에셋을 import하지 않는다. 허용되는 런타임 import는 [vite.config.ts](vite.config.ts)의 `sharedImports`뿐이고 현재 번들은 하나도 쓰지 않는다. DialKit은 vanilla 빌드를 번들한다.
- Wasm은 4KB를 넘으므로 **항상 비동기 컴파일**한다(`loadSolverModule`). 명령은 먼저 이를 await하고, 계산 셀은 준비 전 `undefined`를 반환한다. `compileCached`는 준비 전 호출 시 던진다(실패 결과를 캐시하지 않기 위해).
- Wasm 버퍼를 **모두 할당한 뒤** 타입 배열 뷰를 만든다. 할당이 메모리를 키워 기존 뷰를 분리할 수 있다.
- 테스트는 실제 alid 커널 + Loro Wasm 코어(로컬 체크아웃) 위에서 **빌드된 번들**을 돌린다. 소스를 고친 뒤에는 `node scripts/build.mjs` 후 vitest를 실행한다.

```sh
pnpm typecheck
pnpm test        # 빌드 + vitest
pnpm test:rust   # cargo test --release
pnpm check:dist
pnpm dev         # http://127.0.0.1:5174
```

## 3. 파일별 책임

| 파일 | 책임 / 수정 원칙 |
| --- | --- |
| `crate-kite-solver/src/vm.rs` | 바이트코드 테이프 검증·위상 구성, 연료 제한 식 VM. 문자열을 받지 않는다. |
| `crate-kite-solver/src/xpbd_manifold.rs` | XPBD + 하드 다양체 정사영, 잔차, 에너지, 야코비안 계수. 결정론적이어야 한다. |
| `crate-kite-solver/src/discrete_init.rs` | 시드 없는 자유도의 결정적 후보 배치. 시드 있는 자유도는 건드리지 않는다. |
| `crate-kite-solver/src/memory_view.rs` | `dof_state_buf`·`world_prim_buf`·`constraint_stress_buf` 고정 레이아웃. |
| `src/solver-runtime.ts` | Wasm 로드, 슬롯/풀, 제로카피 뷰(메모리 교체 시 재생성), `evaluateInVm`. |
| `src/dsl/` | 순수 렉서·식 파서·컴파일러. 호스트·DOM·문서 쓰기 금지. 식은 VM 바이트코드로만 평가. |
| `src/computed-bridge.ts` | `computed.kite.compiledVm` / `computed.kite.solvedGeometry`, Cold/Interactive/Dirty 모드, `resolveBindings`. 쓰기 금지. |
| `src/geometry.ts` | 프레임(균일 상사), 정규화 시드, 멤버 기하, 히트 테스트. 쓰기 금지. |
| `src/aspect-specs.ts` | `kite.scope`/`kite.member` 어스펙트, `layout: true`, 선택 기여. |
| `src/render/space1-renderer.ts` | 순수 SVG. `<foreignObject>`·DOM 측정·`url()` 금지. |
| `src/render/space2a-gizmos.ts`, `space2b-popover.ts` | 로컬 UI 상태만. 호스트 프레임 래치에서만 그린다. |
| `src/documents.ts` | 생성·DSL 적용·멤버 동기화·드래그 커밋·카드 배치. **모든 정본 쓰기는 여기**. |
| `src/tools/` | 조작(드래그), 스냅, 완화 애니메이션, 빠른 작도. 이벤트 핸들러에서 정본을 직접 쓰지 않는다. |
| `src/interop/` | 클립보드 유도 서브그래프, 베이킹. 순수 함수. |
| `src/workbench/` | 명령, 구속 카탈로그, Tri-DSL·진단 패널, DialKit 어댑터. |
| `src/__tests__/` | 실제 커널 하네스와 PRD 이름의 테스트. 실제 브라우저 통합을 대체하지 않는다. |

## 4. 불변식

1. **정본 순수성.** `kite.scope`에는 세 DSL, 바인딩, 정규화 수렴 시드, 솔버 설정만 둔다. `kite.member`에는 소속·substanceId·primitiveKind·pinnedDofs·slackWeight만 둔다. 컴파일 결과·화면 좌표·함수를 저장하지 않는다.
2. **읽기 시 쓰기 금지.** 계산 노드, `derive`, `renderSvg`, 패널 조회, 활성화, 붙여넣은 스코프 해석은 `applyCanonicalTransaction`을 호출하지 않는다. 시드가 위상과 맞으면 Cold 모드(반복 0회)여야 한다.
3. **드래그는 한 번만 쓴다.** 이동 중에는 `ScratchOverlay`만 갱신한다. 놓을 때 시드와 (승격 시) `substanceDsl`을 하나의 history 그룹·하나의 트랜잭션으로 기록한다. Esc/취소/IME 시작은 쓰지 않는다.
4. **화면은 다양체 위에.** 매 프레임 `step` 후 `projectManifold`로 하드 구속을 다시 만족시킨다. 커밋용 해도 같은 투영으로 끝낸다.
5. **커널 무오염.** 솔버·DSL 지식은 이 패키지 안에만 둔다.
6. **단일 Z축.** `core.stacking`만 쓴다. 멤버 키는 스코프 키 바로 위에 선언 순서로 둔다.
7. **순수 벡터.** 화면과 `compileToPureSvg`가 같은 문자열을 쓴다. 사용자 텍스트·색상은 이스케이프/검증한다.
8. **IME·입력 주권.** `isComposing`, `keyCode === 229`, `key === 'Process'`, `compositionend` 직후 16ms 가드를 지킨다. 텍스트 입력의 네이티브 Undo·클립보드를 덮지 않는다.
9. **정직성.** 측정하지 않은 120fps/0-GC, 브라우저·실제 IME 검증을 완료로 보고하지 않는다. README의 측정값·한계를 테스트 결과와 함께 갱신한다.

## 5. 스키마 진화

- `kite.scope.schemaVersion`은 1이다. 파괴적 변경은 새 필드나 새 어스펙트 ID로 분리하고 기존 문서를 재작성하지 않는다.
- `entityBindings`·`convergedSeeds`의 키는 `EntityId`다. 붙여넣기 후 키가 오래된 경우 `resolveBindings`와 옛 키 조회로 읽고, 다음 커밋이 새 키로 저장한다.
- `kite.member.scopeId`는 `cascade-hide` 참조를 유지한다(클립보드가 원자적으로 재매핑).
- 바이트코드 상수는 `vm.rs`와 `src/dsl/compile.ts`, `src/dsl/expr.ts`에서 함께 바꾸고 ABI 버전을 올린다.

## 6. 완료 전 확인

- [ ] 요청 범위만 수정했고 어스펙트 ID·필드 의미를 보존했는가?
- [ ] 기능 변경에 맞는 테스트와 README/docs를 갱신했는가?
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm test:rust`가 통과하는가?
- [ ] `pnpm check:dist`가 통과하도록 생성 산출물 셋을 함께 커밋했는가?
- [ ] 읽기 경로가 정본을 쓰지 않는가? (`zero-write-on-read.test.ts`)
- [ ] 드래그가 정확히 한 번의 Undo 그룹인가? (`manifold-drag-undo.test.ts`)
- [ ] SVG가 결정적이고 순수 벡터인가? (`headless-svg-determinism.test.ts`)

Node 테스트는 실제 커널·Loro 코어 위의 계약 검증이지 실제 브라우저·IME 검증이 아니다. 완료 보고에는 실행한 명령과 결과, 수동 확인 여부, 미검증 범위를 구분한다.
