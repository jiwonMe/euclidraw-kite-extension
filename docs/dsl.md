# DSL — Penrose trio

이 확장은 자체 DSL이 없습니다. 세 프로그램을 그대로 `@penrose/core`에 넘깁니다.

- 공식 참조: <https://penrose.cs.cmu.edu/docs/ref>
- 예제 레지스트리: <https://penrose.cs.cmu.edu/examples>

## 스코프 필드와의 대응

| 필드 | 대응 |
|---|---|
| `domainDsl` | Domain 프로그램 |
| `substanceDsl` | Substance 프로그램 |
| `styleDsl` | Style 프로그램 |
| `variation` | 초기 표본 시드. `resample` 명령이 1씩 올립니다. |
| `topologyDigest` | trio·variation·엔진 버전·측정 정책의 해시 |
| `varyingValues` | 마지막 최적화 입력 벡터 (Cold 열기용) |
| `pins` | 사용자가 고정한 입력 인덱스와 값 |

## 이 구현에서 확인된 것

기본 예제와 테스트가 실제로 쓰는 범위입니다.

- `canvas { width = … height = … }`
- `forall Type x { … }`, 이름 선택자 `forall Point A { … }`
- 셰이프: `Circle`, `Ellipse`, `Line`, `Polygon`, `Polyline`, `Rectangle`, `Path`, `Text`, `Equation`, `Image`, `Group`
- 레이블: `Text`(고정 문자열), `Equation`(TeX), `AutoLabel`·`Label`(Substance). 다중 간선·자기 루프·staged layout(`layout = [...]`) 예제를 회귀 테스트로 검증합니다.
- `fillColor`, `strokeColor`, `strokeWidth`, `strokeStyle`, `strokeDasharray`, `strokeLinecap`, `opacity` 등 표준 속성.
- `ensure`/`encourage`, `layout` 단계, `override`/`delete`, `collect`는 core가 그대로 처리합니다(이 저장소의 테스트 범위 밖).

## 알려진 제약

- `draggingConstraint`는 지원하지 않습니다. JS 함수 본문 문자열이라 호스트의 "문서 코드 실행 금지" 원칙과 충돌합니다.
- `Image`의 `href`는 `data:` URI만 렌더합니다. 외부 URL은 무시됩니다.
- `Path`의 SVG 명령은 좌표계 변환 후 그대로 출력합니다. `Group`은 클립을 지원하지만 기즈모는 없습니다.
- `Text`는 고정 메트릭 표로 측정합니다. 플랫폼 폰트와 폭이 미세하게 다를 수 있습니다.
- 실패한 컴파일은 스코프 위에 오류 배지로 표시되고, 정본에는 마지막으로 적용된 DSL이 남습니다.
