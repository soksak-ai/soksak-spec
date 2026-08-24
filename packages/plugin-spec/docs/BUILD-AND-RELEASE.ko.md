---
kind: translation
status: active
canonical: docs/BUILD-AND-RELEASE.md
---

# 빌드 및 릴리스 진입점

이 문서는 공통 빌드·릴리스 경계를 정의합니다. 사설 toolchain installer를 만들거나 개발자
workstation 상태를 source에 직렬화하지 않습니다.

## 규칙

- **BR1 — 하나의 로컬 진입점.** 모든 source repository는 해당 동작이 있을 때
  `make preflight`, `make prepare`, `make build`, `make verify`를 공개합니다. 언어별 task file은
  이 경계 뒤에서 사용할 수 있지만 두 번째 공개 진입점이 아닙니다.
- **BR2 — Make가 build를 소유.** Repository Makefile이 tool version, dependency source commit,
  target, build command를 소유합니다. `.node-version`, `package.json`, `go.mod`,
  `rust-toolchain.toml`은 ecosystem이 요구하는 projection으로 남으며 Make와 정확히 일치해야 합니다.
  GitHub Actions는 literal을 복사하거나 projection을 독립 해석하지 않고 Make 출력을 읽습니다.
- **BR3 — 주입된 환경.** 설치된 executable path, workspace-relative repository 탐색,
  주입된 `PATH`, symlink, cache 위치, fallback tool을 source에 기록하지 않습니다. 개발자는 표준
  수단으로 환경을 선택하며 다른 tool이 함께 설치되어 있어도 됩니다. Clean CI job은 Make가 소유한
  version을 주입합니다. `make preflight`는 주소 지정된 executable만 확인하고 제품 command 전에
  불일치를 거부하며 다른 설치본을 탐색하거나 설치하지 않습니다.
- **BR4 — 읽기 전용 preflight.** Preflight는 요구·실제 version, OS, architecture를 보고합니다.
  Tool을 설치·삭제·복구·선택하지 않습니다. 환경 불일치는 제품 RED가 아니라 precondition
  실패입니다.
- **BR5 — 멱등한 preparation.** `make prepare`는 canonical lockfile에서 repository 소유
  dependency만 materialize합니다. 입력이 같으면 반복 실행 결과도 같습니다. Cache를 삭제하거나
  owner metadata를 다시 쓰거나 repository 경계 밖에 install을 강제하지 않습니다.
- **BR6 — 하나의 command graph.** 로컬 개발과 GitHub Actions가 같은 Make target을 호출합니다.
  Workflow YAML은 runner 선택, credential, artifact transport, publication만 소유하며 repository
  build를 다시 구현하지 않습니다.
- **BR7 — Native build 축.** Native artifact는 target과 일치하는 native runner에서 build하고
  실행합니다. Darwin arm64와 x86_64 thin artifact를 따로 만들고, universal artifact는 검증된 두
  thin artifact만 합성합니다. Linux arm64/x86_64와 Windows x86_64도 주소 지정된 native job을
  사용합니다.
- **BR8 — 검증한 byte를 릴리스.** Publication은 필수 build·system job이 만든 정확한 artifact를
  내려받아 digest와 target header를 검증하고 rebuild 없이 그 byte를 공개합니다. Dependency가
  실패하면 tag나 release asset을 만들 수 없습니다.
- **BR9 — Repository 소유권.** Repository Makefile은 자기 구현과 경계만 검증합니다. Contract
  fixture는 contract owner가 정의하고 각 구현이 실행합니다. 여러 실제 component의 조합은 제품
  composition repository가 검증합니다.

## Command 경계

```sh
make preflight
make prepare
make verify
make build
```

지속 가능한 command 이름은 `make`입니다. Clean checkout에서 sibling repository, 기억해 둔 shell
export, machine-specific path 없이 동작해야 합니다. 필요한 tool이 선택되지 않았다면 preflight가
불일치를 이름으로 알리고 중단하며 다른 설치본을 찾지 않습니다.

GitHub Actions는 Make에서 tool version을 읽어 clean job에 주입한 뒤 같은 target을 호출합니다. Release 전용
target은 명시적 target triple과 staging directory를 받을 수 있지만 publication credential과
GitHub release 변경은 Actions에만 둡니다.
