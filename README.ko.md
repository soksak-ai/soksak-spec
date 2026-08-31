# soksak-spec

플러그인, 사이드카, 킷, 레지스트리 및 개발 도구가 사용하는 플랫폼 계약 저장소입니다.

## 런타임 의존성 선언

`sidecar.json`은 `runtimeDependencies`에 `plugins`와 `sidecars` 배열을 선언할 수 있습니다.
각 항목은 정확한 컴포넌트 `id`와 `version`만 포함합니다. 선언은 필요한 릴리즈를 선택하며
구현 프로세스 이름을 선택하지 않습니다. 호스트는 선언된 릴리즈를 해석하고 소비자의 공개
런타임 계약으로 결과 프로세스를 제공합니다.

## 검증

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm test
```

`pnpm test`는 패키지와 테스트를 실행하고 릴리즈 산출물이 반복 실행에서 동일한지 확인합니다.
