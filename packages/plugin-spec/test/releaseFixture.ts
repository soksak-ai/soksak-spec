const SHA = "1".repeat(64);
const COMMIT = "a".repeat(40);

const integrity = (url: string, sha256 = SHA) => ({ url, sha256 });
const artifact = (target: string, url: string, manifest: string, sha256 = SHA) => ({
  target, url, sha256, format: url.endsWith(".tgz") ? "tgz" : "tar.gz", manifest,
});

export function pluginRelease(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    spec: "soksak-spec-release@0.0.1",
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
    spec: "soksak-spec-release@0.0.1",
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
    spec: "soksak-spec-release@0.0.1",
    kit: { id: "terminal-common", version: "0.0.1" },
    source: { repository: "https://github.com/example/terminal-common", commit: COMMIT },
    dependencies: [],
    artifacts: [artifact("any", "https://github.com/example/terminal-common/releases/download/v0.0.1/terminal-common-0.0.1.tgz", "package.json", "4".repeat(64))],
    reports: [integrity("https://github.com/example/terminal-common/releases/download/v0.0.1/terminal-common-0.0.1.conformance.json")],
    ...over,
  };
}
