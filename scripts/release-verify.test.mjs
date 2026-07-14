import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveSourceCommit,
  validateArchiveEntries,
} from "./release-verify.mjs";

const commit = "a".repeat(40);

test("source commit is exact and cannot disagree with the checkout", () => {
  assert.equal(resolveSourceCommit(commit, null), commit);
  assert.equal(resolveSourceCommit(undefined, commit), commit);
  assert.equal(resolveSourceCommit(commit, commit), commit);
  assert.throws(
    () => resolveSourceCommit("main", null),
    /exact lowercase 40-character commit/,
  );
  assert.throws(
    () => resolveSourceCommit("b".repeat(40), commit),
    /does not equal checkout HEAD/,
  );
  assert.throws(
    () => resolveSourceCommit(undefined, null),
    /source commit is unavailable/,
  );
});
test("release archives contain only unique portable regular files", () => {
  assert.deepEqual(
    validateArchiveEntries(
      [
        "-rw-r--r--  0 0 0 10 Jan  1 00:00 package/package.json",
        "-rw-r--r--  0 0 0 20 Jan  1 00:00 package/dist/spec.js",
      ],
      ["package/package.json", "package/dist/spec.js"],
    ),
    ["package/package.json", "package/dist/spec.js"],
  );
  assert.throws(
    () => validateArchiveEntries(
      ["lrwxr-xr-x  0 0 0 0 Jan  1 00:00 package/link -> target"],
      ["package/link"],
    ),
    /non-regular archive entry/,
  );
  assert.throws(
    () => validateArchiveEntries(
      ["-rw-r--r--  0 0 0 1 Jan  1 00:00 package\/..\/escape"],
      ["package/../escape"],
    ),
    /unsafe archive path/,
  );
  assert.throws(
    () => validateArchiveEntries(
      [
        "-rw-r--r--  0 0 0 1 Jan  1 00:00 package/a",
        "-rw-r--r--  0 0 0 1 Jan  1 00:00 package/a",
      ],
      ["package/a", "package/a"],
    ),
    /duplicate archive entry/,
  );
});
