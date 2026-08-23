const SHA = "1".repeat(64);
const COMMIT = "a".repeat(40);
const integrity = (url: string, sha256 = SHA) => ({ url, size: 12345, sha256 });
const artifact = (target: string, url: string, manifest: string, sha256 = SHA) => ({ target, url, sha256, size: 12345, format: url.endsWith(".tgz") ? "tgz" : "tar.gz", manifest });
function release(kind: string, id: string, repository: string, artifactValues: Record<string, unknown>[], over: Record<string, unknown>) {
  return {
    kind, id, version: "0.0.1",
    manifest: integrity(`${repository}/releases/download/v0.0.1/${kind}.json`),
    source: { repository, commit: COMMIT }, artifacts: artifactValues,
    evidence: [integrity(`${repository}/releases/download/v0.0.1/conformance-release.json`)],
    ...over,
  };
}
export function pluginRelease(over: Record<string, unknown> = {}): Record<string, unknown> {
  const repository = "https://github.com/example/weather-plugin";
  return release("plugin", "weather-plugin", repository, [artifact("any", `${repository}/releases/download/v0.0.1/weather-plugin-0.0.1.tgz`, "plugin.json")], over);
}
export function sidecarRelease(over: Record<string, unknown> = {}): Record<string, unknown> {
  const repository = "https://github.com/example/weather-sidecar";
  return release("sidecar", "weather-sidecar", repository, [
    artifact("aarch64-apple-darwin", `${repository}/releases/download/v0.0.1/weather-sidecar-aarch64-apple-darwin.tar.gz`, "sidecar.json", "2".repeat(64)),
    artifact("x86_64-unknown-linux-gnu", `${repository}/releases/download/v0.0.1/weather-sidecar-x86_64-unknown-linux-gnu.tar.gz`, "sidecar.json", "3".repeat(64)),
  ], over);
}
export function kitRelease(over: Record<string, unknown> = {}): Record<string, unknown> {
  const repository = "https://github.com/example/terminal-common";
  return release("kit", "terminal-common", repository, [artifact("any", `${repository}/releases/download/v0.0.1/terminal-common-0.0.1.tgz`, "kit.json", "4".repeat(64))], over);
}
export function contractRelease(over: Record<string, unknown> = {}): Record<string, unknown> {
  const repository = "https://github.com/example/terminal-contract";
  return release("contract", "terminal-contract", repository, [artifact("any", `${repository}/releases/download/v0.0.1/terminal-contract-0.0.1.tgz`, "contract.json", "5".repeat(64))], over);
}
export function specRelease(over: Record<string, unknown> = {}): Record<string, unknown> {
  const repository = "https://github.com/example/soksak-spec";
  return release("spec", "soksak-spec", repository, [artifact("any", `${repository}/releases/download/v0.0.1/soksak-spec-0.0.1.tgz`, "spec.json", "7".repeat(64))], over);
}
