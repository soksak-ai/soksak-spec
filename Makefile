SHELL := /bin/sh

.PHONY: preflight prepare build verify

preflight:
	@scripts/check-build-environment.sh

prepare: preflight
	@CI=1 PNPM_DISABLE_SELF_UPDATE_CHECK=1 pnpm install --frozen-lockfile
	@cargo fetch --locked
	@go -C go/platformspec mod download

build: prepare
	@pnpm build

verify: prepare
	@scripts/build-entrypoint.test.sh
	@scripts/check-build-environment.test.sh
	@pnpm test
