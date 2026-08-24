import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";

import { createRegularFileArchive, gzipStored, readRegularFileArchive } from "./archive.mjs";

test("stored gzip is a canonical byte encoding", () => {
  const input = Buffer.concat([Buffer.from("soksak\0"), Buffer.alloc(70_000, 0xa5)]);
  const first = gzipStored(input);
  const second = gzipStored(Buffer.from(input));
  assert.deepEqual(first, second);
  assert.deepEqual(zlib.gunzipSync(first), input);
  assert.equal(first.subarray(0, 10).toString("hex"), "1f8b08000000000000ff");
  assert.equal(crypto.createHash("sha256").update(first).digest("hex"), "32dedc12ebb273b35935911a6fd1d19055eeba2733f2609d28045b5328d916fa");
});

test("regular archive preserves a ustar path longer than the name field", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "soksak-ustar-path-"));
  const relative = "dist/kitty-provider/runtime/lib/python3.14/test/regrtestdata/import_from_tests/test_regrtest_b/__init__.py";
  try {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), "provider-runtime\n");

    const archive = createRegularFileArchive({ root, files: ["dist"] });
    const entries = readRegularFileArchive(archive);

    assert.deepEqual(entries.map(({ name }) => name), [relative]);
    assert.equal(entries[0].data.toString("utf8"), "provider-runtime\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
