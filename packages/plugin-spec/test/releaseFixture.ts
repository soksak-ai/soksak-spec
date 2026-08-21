const SHA = "1".repeat(64);
const COMMIT = "a".repeat(40);

const integrity = (url: string, sha256 = SHA) => ({ url, sha256 });
const artifact = (target: string, url: string, manifest: string, sha256 = SHA) => ({
  target, url, sha256, format: url.endsWith(".tgz") ? "tgz" : "tar.gz", manifest,
});

export function pluginRelease(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    plugin: { id: "weather-plugin", version: "0.0.1" },
    source: { repository: "https://github.com/example/weather-plugin", commit: COMMIT },
    dependencies: [{ kit: { id: "terminal-common", version: "0.0.1" }, scope: "runtime" }],
    artifacts: [artifact("any", "https://github.com/example/weather-plugin/releases/download/v0.0.1/weather-plugin-0.0.1.tgz", "plugin.json")],
    reports: [integrity("https://github.com/example/weather-plugin/releases/download/v0.0.1/weather-plugin-0.0.1.conformance.json")],
    ...over,
  };
}

export function sidecarRelease(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sidecar: { id: "weather-sidecar", version: "0.0.1" },
    source: { repository: "https://github.com/example/weather-sidecar", commit: COMMIT },
    dependencies: [],
    artifacts: [
      artifact("aarch64-apple-darwin", "https://github.com/example/weather-sidecar/releases/download/v0.0.1/weather-sidecar-aarch64-apple-darwin.tar.gz", "sidecar.json", "2".repeat(64)),
      artifact("x86_64-unknown-linux-gnu", "https://github.com/example/weather-sidecar/releases/download/v0.0.1/weather-sidecar-x86_64-unknown-linux-gnu.tar.gz", "sidecar.json", "3".repeat(64)),
    ],
    reports: [integrity("https://github.com/example/weather-sidecar/releases/download/v0.0.1/weather-sidecar-0.0.1.conformance.json")],
    ...over,
  };
}

export function kitRelease(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kit: { id: "terminal-common", version: "0.0.1" },
    source: { repository: "https://github.com/example/terminal-common", commit: COMMIT },
    dependencies: [],
    artifacts: [artifact("any", "https://github.com/example/terminal-common/releases/download/v0.0.1/terminal-common-0.0.1.tgz", "kit.json", "4".repeat(64))],
    reports: [integrity("https://github.com/example/terminal-common/releases/download/v0.0.1/terminal-common-0.0.1.conformance.json")],
    ...over,
  };
}

export function contractRelease(over: Record<string, unknown> = {}): Record<string, unknown> {
  const repository = "https://github.com/example/terminal-contract";
  return {
    contract: { id: "terminal-contract", version: "0.0.1" },
    source: { repository, commit: COMMIT },
    dependencies: [{ spec: { id: "soksak-spec", version: "0.0.1" }, scope: "build" }],
    artifacts: [artifact("any", `${repository}/releases/download/v0.0.1/terminal-contract-0.0.1.tgz`, "contract.json", "5".repeat(64))],
    reports: [integrity(`${repository}/releases/download/v0.0.1/terminal-contract-0.0.1.conformance.json`, "6".repeat(64))],
    ...over,
  };
}

export function specRelease(over: Record<string, unknown> = {}): Record<string, unknown> {
  const repository = "https://github.com/example/soksak-spec";
  return {
    spec: { id: "soksak-spec", version: "0.0.1" },
    source: { repository, commit: COMMIT },
    dependencies: [],
    artifacts: [artifact("any", `${repository}/releases/download/v0.0.1/soksak-spec-0.0.1.tgz`, "spec.json", "7".repeat(64))],
    reports: [integrity(`${repository}/releases/download/v0.0.1/soksak-spec-0.0.1.conformance.json`, "8".repeat(64))],
    ...over,
  };
}
