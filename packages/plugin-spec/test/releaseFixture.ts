const SHA = "1".repeat(64);
const COMMIT = "a".repeat(40);
const integrity = (file: string, sha256 = SHA) => ({ file, size: 12345, sha256 });
const artifact = (target: string, file: string, manifest: string, sha256 = SHA) => ({ target, file, sha256, size: 12345, format: file.endsWith(".tgz") ? "tgz" : "tar.gz", manifest });
// source.repository follows the effective id so an id override stays a valid document.
function release(kind: string, id: string, artifactValues: Record<string, unknown>[], over: Record<string, unknown>) {
  const effectiveId = typeof over.id === "string" ? over.id : id;
  return {
    kind, id, version: "0.0.1",
    manifest: integrity(`${kind}.json`),
    source: { repository: `https://github.com/soksak-ai/${effectiveId}`, commit: COMMIT }, artifacts: artifactValues,
    evidence: [integrity("conformance-release.json")],
    ...over,
  };
}
export function pluginRelease(over: Record<string, unknown> = {}): Record<string, unknown> {
  return release("plugin", "weather-plugin", [artifact("any", "weather-plugin-0.0.1.tgz", "plugin.json")], over);
}
export function sidecarRelease(over: Record<string, unknown> = {}): Record<string, unknown> {
  return release("sidecar", "weather-sidecar", [
    artifact("aarch64-apple-darwin", "weather-sidecar-aarch64-apple-darwin.tar.gz", "sidecar.json", "2".repeat(64)),
    artifact("x86_64-unknown-linux-gnu", "weather-sidecar-x86_64-unknown-linux-gnu.tar.gz", "sidecar.json", "3".repeat(64)),
  ], over);
}
export function kitRelease(over: Record<string, unknown> = {}): Record<string, unknown> {
  return release("kit", "terminal-common", [artifact("any", "terminal-common-0.0.1.tgz", "kit.json", "4".repeat(64))], over);
}
export function contractRelease(over: Record<string, unknown> = {}): Record<string, unknown> {
  return release("contract", "terminal-contract", [artifact("any", "terminal-contract-0.0.1.tgz", "contract.json", "5".repeat(64))], over);
}
export function specRelease(over: Record<string, unknown> = {}): Record<string, unknown> {
  return release("spec", "soksak-spec", [artifact("any", "soksak-spec-0.0.1.tgz", "spec.json", "7".repeat(64))], over);
}
