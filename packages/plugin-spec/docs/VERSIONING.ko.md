# 버전 관리

이 문서는 Soksak 플러그인, 사이드카, 킷, 계약, 스펙, 릴리스, 레지스트리, 설정 및 설치
기록에 대한 영어 정본 [VERSIONING.md](VERSIONING.md)의 한국어 번역본이다.

이 문서의 예시는 실행 가능한 fixture이다. 필드, 식별자, 버전, 명령 및 오류 코드는 영어
정본과 동일하게 유지한다.

## 1. 버전의 역할

<!-- rule:version-roles -->

Soksak에는 하나의 앱 버전만 있으며 별도의 호환 버전은 없다. `appVersion`은 실행 중인
앱의 정확한 버전이다. `appVersionRequirement`는 플러그인 릴리스가 허용하는 조건이다.
플러그인 자체의 `version`은 해당 플러그인 릴리스를 식별한다.

<!-- example:plugin-valid:valid-plugin -->
```json
{
  "id": "example-plugin",
  "name": "Example",
  "version": "0.0.1",
  "appVersionRequirement": "0.0.1",
  "description": "Versioning example",
  "permissions": []
}
```

이 manifest에서 `appVersion: "0.0.1"`은 허용되고 `appVersion: "0.0.2"`는
`APP_VERSION_UNSUPPORTED`로 거부된다. 설치와 로드는 같은 검사를 사용한다.

`minAppVersion`, `appCompatibility`, `soksakCompatibility`, `requiresSoksak`,
`engines`는 alias가 아니다.

<!-- example:plugin-obsolete-minimum:invalid-plugin -->
```json
{
  "id": "example-plugin",
  "name": "Example",
  "version": "0.0.1",
  "minAppVersion": "0.0.1",
  "description": "Obsolete version field",
  "permissions": []
}
```

예상 오류: `MANIFEST_UNKNOWN_FIELD`. 최소 버전만으로는 호환되지 않는 상한을 표현할 수
없다.

## 2. 정체성과 요구 조건

<!-- rule:identity-requirement -->

소유자 또는 provider는 정확한 `{id, version}`을 보고한다. Consumer는
`{id, requirement}`를 보고한다. ID에는 버전을 포함하지 않는다.

<!-- example:provider-valid:valid-provider -->
```json
{ "id": "soksak-spec-sidecar-terminal", "version": "0.0.1" }
```

<!-- example:consumer-valid:valid-requirement -->
```json
{ "id": "soksak-spec-sidecar-terminal", "requirement": "0.0.1" }
```

<!-- example:consumer-provider-shape:invalid-requirement -->
```json
{ "id": "soksak-spec-sidecar-terminal", "version": "0.0.1" }
```

예상 오류: `REQUIREMENT_FIELD_REQUIRED`. `range`는 `requirement`의 alias가 아니다.

<!-- example:consumer-wildcard:invalid-requirement -->
```json
{ "id": "soksak-spec-sidecar-terminal", "requirement": "*" }
```

예상 오류: `REQUIREMENT_UNBOUNDED`. 빈 조건, `*`, `x`, `latest`, branch, Git URL 및
기타 package locator는 호환성을 증명하지 않는다.

## 3. 0.0.1 컴포넌트 정책

<!-- rule:baseline-policy -->

현재 앱, 플러그인, 사이드카, 킷, 계약 및 런타임 인터페이스는 모두 `0.0.1`을 유지한다.
모든 소유자 manifest는 정확한 조건 `0.0.1`을 선언한다. 이는 SemVer 문법 위에 적용하는
제품 정책이다.

<!-- example:plugin-unproved-range:invalid-plugin -->
```json
{
  "id": "example-plugin",
  "name": "Example",
  "version": "0.0.1",
  "appVersionRequirement": ">=0.0.1 <1.0.0",
  "description": "Unproved compatibility",
  "permissions": []
}
```

예상 오류: `BASELINE_REQUIREMENT_NOT_EXACT`. 향후 릴리스는 주장하는 버전 계열을 교차
버전 테스트한 뒤에만 유계 조건을 선언할 수 있다. 테스트 실패를 이유로 조건을 넓히지
않는다.

`0.0.2-dev.1` 같은 SemVer prerelease는 문법상 유효하다. 0.0.1 레지스트리는 prerelease를
게시하거나 자동 선택하지 않는다. SemVer는 prerelease 식별자를 숫자 및 사전식 규칙으로
비교하며 dev, alpha, beta, rc 제품 절차를 알지 못한다.

<!-- rule:immutable-release-correction -->

게시된 바이트는 변경하지 않는다. 수정된 package는 다음 patch 버전을 사용하며 기존 tag나
asset을 교체하지 않는다. Package/spec 릴리스 버전은 게시된 바이트를 식별하며 package가
검증하는 컴포넌트 및 런타임 인터페이스 버전을 암묵적으로 변경하지 않는다.

<!-- example:spec-correction-release:release -->
```json
{
  "kind": "spec",
  "id": "soksak-spec",
  "version": "0.0.9",
  "manifest": {
    "url": "https://github.com/soksak-ai/soksak-spec/releases/download/v0.0.9/spec.json",
    "size": 256,
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "source": {
    "repository": "https://github.com/soksak-ai/soksak-spec",
    "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "artifacts": [
    {
      "target": "any",
      "format": "tgz",
      "manifest": "spec.json",
      "url": "https://github.com/soksak-ai/soksak-spec/releases/download/v0.0.9/soksak-ai-plugin-spec-0.0.9.tgz",
      "size": 12345,
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  ],
  "evidence": [{
    "url": "https://github.com/soksak-ai/soksak-spec/releases/download/v0.0.9/conformance-release.json",
    "size": 512,
    "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  }]
}
```

이 `soksak-spec@0.0.9` package는 계속 `plugin.json`, `sidecar.json` 및 런타임 인터페이스의
`0.0.1`을 검증할 수 있다. Package 수정은 해당 계약이 변경됐다는 근거가 아니다.

## 4. 플러그인과 사이드카 인터페이스

<!-- rule:plugin-sidecar-interface -->

플러그인은 설치할 정확한 불변 Sidecar release를 고정한다. 제공 interface는 Sidecar manifest와
conformance evidence가 소유하며 설치 시 provider 선택이나 fallback은 없다.

<!-- example:terminal-plugin-valid:valid-plugin -->
```json
{
  "id": "terminal-view",
  "name": "Terminal",
  "version": "0.0.1",
  "appVersionRequirement": "0.0.1",
  "description": "Terminal view",
  "permissions": ["sidecar"],
  "implements": [
    { "id": "soksak-spec-plugin-terminal", "version": "0.0.1" }
  ],
  "runtimeDependencies": {
    "sidecars": [
    {
      "id": "terminal-provider",
      "version": "0.0.1",
      "url": "https://github.com/example/terminal-provider/releases/download/v0.0.1/release.json",
      "size": 12345,
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
    ]
  }
}
```

<!-- example:terminal-sidecar-valid:valid-sidecar -->
```json
{
  "id": "terminal-provider",
  "version": "0.0.1",
  "interface": {
    "id": "soksak-spec-sidecar-terminal",
    "version": "0.0.1"
  },
  "process": "dist/terminal-provider"
}
```

사이드카는 앱 버전 조건을 선언하지 않는다. 버전이 있는 인터페이스를 통해 통신한다. Core
내부 함수에 직접 의존한다면 공개 프로토콜이 누락된 것이다.

## 5. 외부 패키지

<!-- rule:package-manager-ownership -->

외부 라이브러리는 해당 package manager가 소유하며 `plugin.json`에 반복하지 않는다.
Package manifest는 작성자의 의도를, lock 또는 checksum은 실제 선택된 내용을 기록한다.

<!-- example:node-package-valid:package-json -->
```json
{
  "dependencies": { "@xterm/xterm": "^5.5.0" },
  "devDependencies": {
    "typescript": "5.9.3",
    "vitest": "3.2.4"
  }
}
```

- Node 릴리스는 커밋된 lockfile과 frozen install을 사용한다.
- Rust 릴리스는 `Cargo.toml`과 `Cargo.lock`을 사용하며 Git dependency는 full `rev`를 사용한다.
- Go 릴리스는 `go.mod`와 `go.sum`을 사용한다.
- 릴리스 빌드는 npm `file:`, `link:`, `workspace:`, `portal:`, `catalog:`, 절대 경로와 상위 상대
  경로, Cargo `path`, Go `replace`, sibling source path 및 설치로 변경된 lockfile을 거부한다.
  이는 이식 가능한 릴리스 입력이 아니라 로컬 구조를 나타낸다. Development override는 test가
  소유한 staging metadata에만 존재하며 source 또는 release input에 복사하지 않는다.

## 6. 개발 경로

<!-- rule:development-source -->

개발 경로는 하나의 플러그인, 사이드카, 킷, 계약 또는 스펙을 읽는 위치를 변경하고 해당
항목만 관리형 업데이트에서 제외한다. 검증을 비활성화하지 않는다.

<!-- example:development-path-valid:settings-fragment -->
```json
{
  "sidecars": {
    "terminal-provider": {
      "version": "0.0.1",
      "path": "/absolute/development/terminal-provider",
      "source": "development",
      "target": "aarch64-apple-darwin"
    }
  }
}
```

개발 manifest도 정체성, 버전, 해당되는 경우 앱 조건, 인터페이스, 권한 및 경로 검사를
통과해야 한다. Source는 하나의 닫힌 값이며 별도 개발 flag나 설치 문서가 이를 복제하지 않는다.

공개되지 않은 Node package dependency는 `release-template/stage-node-candidate.mjs`로 검증한다.
이 command는 clean 상태의 정확한 Git commit 하나를 복사하고 모든 dependency archive SHA-256을
검증한 뒤 별도 output checkout에만 `pnpm.overrides`를 기록한다. Source checkout은 변경하지 않는다.
Staged checkout은 development input이며 `release-template/build-node-candidate.mjs` exit command가
source check와 build를 실행하고 source commit의 정확한 package manifest, lockfile, workspace
setting을 복원하기 전까지 release builder가 이를 거부한다. Exit command는 선언한 generated output
밖의 변경을 거부하며 모든 staging locator를 제거한다. 이후
canonical builder와 validator를 실행하고 dependency digest는 candidate archive 내부가 아니라 옆의
report에 기록한다.

## 7. 릴리스와 설치 내용

<!-- rule:release-install-separation -->

릴리스는 게시된 바이트와 정확한 runtime dependency를 투영한다. 빌드 dependency는 언어 package
manifest와 lockfile만 소유한다.

<!-- example:plugin-release-valid:release -->
```json
{
  "kind": "plugin",
  "id": "example-plugin",
  "version": "0.0.1",
  "manifest": {
    "url": "https://github.com/soksak-ai/example-plugin/releases/download/v0.0.1/plugin.json",
    "size": 256,
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "source": {
    "repository": "https://github.com/soksak-ai/example-plugin",
    "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "artifacts": [
    {
      "target": "any",
      "format": "tgz",
      "manifest": "plugin.json",
      "url": "https://github.com/soksak-ai/example-plugin/releases/download/v0.0.1/example-plugin-0.0.1.tgz",
      "size": 12345,
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  ],
  "evidence": [{
    "url": "https://github.com/soksak-ai/example-plugin/releases/download/v0.0.1/conformance-release.json",
    "size": 512,
    "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  }]
}
```

레지스트리는 정확한 릴리스, dependency, source commit, artifact URL, 크기와 digest를 게시한다.
`environment.json`은 exact 선택 버전, registry ID, 절대 local path, source kind, 해당되는 target,
plugin 활성화와 설치된 정확한 component identity를 기록하는 유일한 local state다. repository, commit, digest를
레지스트리에서 복제하지 않는다.

인스톨러는 transaction 디렉터리에 다운로드하고 압축 해제 전에 크기와 SHA-256을 검사하며
모든 manifest와 조건을 검증한 후 내용을 배치하고 `environment.json`을 원자적으로 교체한다.
write lock은 transaction 동안만 존재하며 영구 lock 문서는 없다. 오류가 발생하면 기존 환경을
변경하지 않는다.

`environment.json`만 local runtime discovery를 소유한다. 저장소는 `../`, 주입된 저장소 root,
workspace checkout path, PATH 또는 symbolic link로 다른 저장소를 찾지 않는다. build-time 관계는
package dependency를 사용하고 runtime 관계는 environment에서 component ID로 해석하며 remote byte는
registry release로 접근한다. 테스트도 같은 공개 interface를 사용하고 sibling source topology를 만들지 않는다.

## 8. 충돌과 업데이트

<!-- rule:conflict-policy -->

한 설치에서는 주어진 ID에 하나의 버전을 선택한다. 교집합이 없는 조건은 fallback이나
호환 계층 없이 실패한다. 오류에는 모든 consumer와 requirement가 표시된다.

```text
VERSION_REQUIREMENT_CONFLICT
terminal-view@2.0.0 requires terminal-contract >=2.0.0 <3.0.0
other-terminal@1.5.0 requires terminal-contract >=1.6.0 <2.0.0
The environment was not changed.
```

Major 버전은 의도적으로 호환되지 않는 공개 변경을 표시한다. Requirement는 호환 테스트
후에만 넓히며 실패한 구현을 통과시키기 위해 넓히지 않는다.

## 9. 소유권

<!-- rule:ownership-summary -->

| 사실 | 소유자 |
| --- | --- |
| 플러그인 릴리스 버전 | `plugin.json` |
| 실행 중인 Soksak 버전 | Runtime `appVersion` |
| 허용하는 Soksak 버전 | Plugin `appVersionRequirement` |
| 제공 인터페이스 버전 | Provider manifest `version` |
| 허용 인터페이스 버전 | Consumer manifest `requirement` |
| 외부 source dependency | Package manifest 및 lock/checksum |
| 게시된 바이트 | Release descriptor 및 attestation |
| 발견 가능한 릴리스 | Registry |
| 선택 버전, local path, source kind, 활성화 | `environment.json` |
| 다운로드 URL, source commit, artifact digest, dependency | Registry release |

Registry는 release history가 아니라 현재 plugin catalogue다. plugins array에는 plugin ID별 현재
release가 하나만 존재한다. Sidecar는 plugin의 exact runtime dependency로만 나타난다. 과거 version은
Git history와 immutable owner release가 보존한다.

공개 unit, dependency scope, install profile, dependency closure, composition graph, execution
graph, deployment graph는 없다. 일시적인 로컬 검증 데이터는 저장 계약이나 사용자 개념이
아니다.
