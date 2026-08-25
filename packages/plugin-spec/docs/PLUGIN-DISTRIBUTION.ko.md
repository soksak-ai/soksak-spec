# 플러그인 배포

이 문서는 배포 계약의 한국어 번역본이다. [영문 정본](PLUGIN-DISTRIBUTION.md)이 규범이다.
Soksak이 사용자에게 노출하는 설치 단위는 플러그인이다. Sidecar는 플러그인의 정확한 runtime
dependency이며 Kit·contract·spec·언어 라이브러리는 빌드 입력이다.

## 소유 저장소 입력

작성자는 `plugin.json`과 표준 빌드 manifest·lockfile을 작성한다. 빌드 dependency는
`package.json`, `Cargo.toml`, `go.mod`에 남는다. 별도 설치 component는
`plugin.json.runtimeDependencies`의 `{ id, version }` 참조 하나다. Manifest는 의도이며 `url`,
`size`, `sha256`이 없다. Manifest validator는 이 key를 unknown으로 거부한다.

```json
{
  "id": "soksak-plugin-terminal-xterm",
  "version": "0.0.18",
  "runtimeDependencies": {
    "sidecars": [{ "id": "soksak-sidecar-pty", "version": "0.0.6" }]
  }
}
```

배열 위치가 종류를 나타낸다. role, provider alias, interface 복사, 범위, `latest`, fallback은 없다.
dependency가 없으면 필드와 빈 배열을 생략한다. 참조가 바뀌면 plugin 버전도 올린다.

Service 선언은 service interface와 선택적인 subscribe만 포함한다. v1 service plugin은
`runtimeDependencies.sidecars` 참조를 정확히 하나 가지며 그 참조가 service 실행체다.
`service.sidecar`는 존재하지 않는다.

## 자동 릴리스

공용 builder는 lockfile과 self-contained artifact를 검증하고 모든 runtime dependency를 release
resolver로 해석한 뒤 `release.json`을 생성한다. Plugin과 Sidecar는 같은 평면 형식을 사용한다.
`manifest`, `artifacts`, 모든 크기·digest, `runtimeDependencies`, `evidence`는 자동 산출물이다.
`evidence`는 conformance 기록이며 설치 대상이 아니다.

`release.json`에는 location이 없다. 같은 release directory의 모든 파일은
[PLATFORM-WIRE.md](PLATFORM-WIRE.md) §3의 단일 release file grammar를 따르는 bare `file` 이름이다.
Builder와 두 publisher는 그 pattern을 import하며 두 번째 pattern을 정의하지 않는다.
다른 release에 대한 모든 참조는 `{ id, version, size, sha256 }`이며 `size`와 `sha256`은 그
release의 `release.json`의 값이다. Builder는 이를 resolver에서 구성하며 manifest에서 복사하지
않는다. `source.repository`는 organization에 묶인다. 값은 `https://github.com/soksak-ai/<id>`와
같다. Release directory는 identity에서 유도한다. 공개 release는
`https://github.com/soksak-ai/<id>/releases/download/v<version>/`, local release는
`<store>/<kind 복수형>/<id>/<version>/`이다. `--store`를 받은 local build는 local을 읽고 공개
build는 GitHub을 읽는다.

```json
{
  "kind": "plugin",
  "id": "soksak-plugin-terminal-xterm",
  "version": "0.0.18",
  "manifest": {
    "file": "plugin.json",
    "size": 4096,
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "source": {
    "repository": "https://github.com/soksak-ai/soksak-plugin-terminal-xterm",
    "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "artifacts": [{
    "target": "any",
    "file": "soksak-plugin-terminal-xterm-0.0.18-any.tgz",
    "size": 94578,
    "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "format": "tgz",
    "manifest": "plugin.json"
  }],
  "runtimeDependencies": {
    "sidecars": [{
      "id": "soksak-sidecar-pty",
      "version": "0.0.6",
      "size": 1234,
      "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    }]
  },
  "evidence": [{
    "file": "conformance-release.json",
    "size": 512,
    "sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  }]
}
```

## Registry PR과 릴리스

하나의 PR은 `plugins/<id>.json` 하나만 추가하거나 교체한다. 내용은 `{ id, version }`뿐이다.

```json
{ "id": "soksak-plugin-terminal-xterm", "version": "0.0.18" }
```

`registry-build`는 유도한
`https://github.com/soksak-ai/<id>/releases/download/v<version>/release.json`을 fetch해 `size`와
`sha256`을 해석한다. Reference가 없는 root entry는 고정 1 MiB 한도로 읽는다. 폐쇄 안의 모든
dependency는 전체 reference `{ kind, id, version, size, sha256 }`로 최대 `size` byte만 읽고, 읽은 뒤
하나의 verifier가 그 byte를 `size`, `sha256`과 비교한다. Registry workflow는 모든 불변 release를 검증하고 인증된 `registry.json`을
릴리스한다. 각 index entry는 release 참조 `{ id, version, size, sha256 }`이다. Index는
`runtimeDependencies`를 복사하지 않는다. Consumer는 각 `release.json`을 통해 폐쇄를 순회한다.
`installs`, `packages`, 독립 Sidecar 배열, 빌드 dependency catalogue는 없다.

공개 gate: 폐쇄 안의 release 하나라도 유도한 https url에서 해석되지 않거나(404) fetch한 byte가
그것을 참조하는 reference의 size, SHA-256과 다르면 `registry-verify`는 PR을 거부한다.
패키지 CLI가 `registry-verify`, `registry-build`, `registry-authenticate`를 제공하며 Registry
저장소에는 별도 parser나 signer 구현을 두지 않는다.

```json
{
  "id": "official",
  "sequence": 11,
  "issuedAt": "2026-08-24T00:00:00Z",
  "expiresAt": "2026-11-24T00:00:00Z",
  "plugins": [{
    "id": "soksak-plugin-terminal-xterm",
    "version": "0.0.18",
    "size": 2048,
    "sha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  }],
  "signature": { "algorithm": "ed25519", "keyId": "official-2026", "value": "..." }
}
```

신뢰 공개키는 Core에 내장하며 Registry에서 받지 않는다. Core는 서명, ID, 만료, sequence,
rollback, equivocation, 모든 release 참조와 artifact를 사용 전에 검증한다.

## 사용자 동의와 설치

Core는 실행 artifact를 받기 전에 직접·전이 metadata를 모두 해석한다. 동의 화면은 권한과 추가
component의 ID·버전을 표시한다. 상세 화면은 종류, 저장소, 플랫폼 artifact, 크기, digest,
manifest, interface, evidence를 보여준다. 동의 후 전체 폐쇄를 staging하고 파일과
`environment.json`을 원자적으로 commit한다. 하나라도 실패하면 기존 환경을 변경하지 않는다.
`environment.json`은 설치된 component만 기록하고 plugin role binding을 저장하지 않는다. Exact
관계는 plugin의 불변 runtime dependency에서 읽는다.

Registry 버전이 설치 버전보다 클 때만 Update다. 같거나 낮으면 Installed이며 development source는
관리형 업데이트를 받지 않는다.
