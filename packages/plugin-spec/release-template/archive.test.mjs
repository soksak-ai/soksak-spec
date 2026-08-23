import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import zlib from "node:zlib";

import { gzipStored } from "./archive.mjs";

test("stored gzip is a canonical byte encoding", () => {
  const input = Buffer.concat([Buffer.from("soksak\0"), Buffer.alloc(70_000, 0xa5)]);
  const first = gzipStored(input);
  const second = gzipStored(Buffer.from(input));
  assert.deepEqual(first, second);
  assert.deepEqual(zlib.gunzipSync(first), input);
  assert.equal(first.subarray(0, 10).toString("hex"), "1f8b08000000000000ff");
  assert.equal(crypto.createHash("sha256").update(first).digest("hex"), "32dedc12ebb273b35935911a6fd1d19055eeba2733f2609d28045b5328d916fa");
});
