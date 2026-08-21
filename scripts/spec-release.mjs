export const SPEC_RELEASE_SPEC = "soksak-spec-platform-release@0.0.1";
const STRICT_SEMVER_RE = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseSpecReleaseManifest(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["spec release must be an object"] };
  }
  const keys = Object.keys(raw).sort();
  const expected = ["dependencies", "id", "kind", "packages", "releaseTag", "source", "spec", "version"];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) errors.push("spec release fields are closed");
  if (raw.spec !== SPEC_RELEASE_SPEC || raw.kind !== "spec" || raw.id !== "soksak-spec") errors.push("spec release identity is invalid");
  if (typeof raw.version !== "string" || !STRICT_SEMVER_RE.test(raw.version)) errors.push("spec release version is invalid");
  if (raw.releaseTag !== `${raw.id}-v${raw.version}`) errors.push("spec release tag is invalid");
  if (!raw.source || typeof raw.source !== "object" || Array.isArray(raw.source) ||
      typeof raw.source.repository !== "string" || !/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(raw.source.repository) ||
      typeof raw.source.commit !== "string" || !/^[a-f0-9]{40}$/.test(raw.source.commit)) errors.push("spec release source is invalid");
  if (!Array.isArray(raw.dependencies) || raw.dependencies.length !== 0) errors.push("spec release dependencies must be empty");
  if (!Array.isArray(raw.packages) || raw.packages.length !== 4) errors.push("spec release packages are incomplete");
  return errors.length === 0 ? { ok: true, value: raw } : { ok: false, errors };
}
