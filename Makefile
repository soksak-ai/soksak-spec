SHELL := /bin/sh

NODE_VERSION := 26.7.0
PNPM_VERSION := 11.22.0
RUST_VERSION := 1.98.0
GO_VERSION := 1.26.3

.PHONY: preflight prepare build verify print-node-version print-pnpm-version print-rust-version print-go-version

print-node-version:
	@printf '%s\n' '$(NODE_VERSION)'

print-pnpm-version:
	@printf '%s\n' '$(PNPM_VERSION)'

print-rust-version:
	@printf '%s\n' '$(RUST_VERSION)'

print-go-version:
	@printf '%s\n' '$(GO_VERSION)'

preflight:
	@scripts/check-build-environment.sh --node '$(NODE_VERSION)' --pnpm '$(PNPM_VERSION)' --rust '$(RUST_VERSION)' --go '$(GO_VERSION)'

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
