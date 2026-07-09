/**
 * schemaVersion gate and canonical diagnostics (SPEC §6).
 *
 * Formalizes the checklist 1.3 verification one-liners: the version guard's
 * truth table, and DIAGNOSTICS as the frozen four-string set the hook, the
 * Action, and their tests all import instead of retyping.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CURRENT_SCHEMA_VERSION,
  DIAGNOSTICS,
  isSupportedSchemaVersion,
} from "../src";

test("CURRENT_SCHEMA_VERSION is the bare integer 1", () => {
  assert.equal(CURRENT_SCHEMA_VERSION, 1);
  assert.ok(isSupportedSchemaVersion(CURRENT_SCHEMA_VERSION));
});

test("isSupportedSchemaVersion accepts exactly 1", () => {
  assert.equal(isSupportedSchemaVersion(1), true);
});

const UNSUPPORTED: unknown[] = [0, 2, -1, 1.5, "1", "1.0.0", null, undefined];
for (const v of UNSUPPORTED) {
  test(`isSupportedSchemaVersion rejects ${JSON.stringify(v) ?? "undefined"}`, () => {
    assert.equal(isSupportedSchemaVersion(v), false);
  });
}

test("DIAGNOSTICS is exactly the four canonical strings", () => {
  assert.deepEqual(
    { ...DIAGNOSTICS },
    {
      basePactModified: "base pact modified",
      pathRemovedFromScope: "path removed from scope",
      invalidGoverningFile: "invalid governing file",
      unsupportedSchemaVersion: "unsupported schema version",
    },
  );
});

test("DIAGNOSTICS is frozen and mutation throws", () => {
  assert.ok(Object.isFrozen(DIAGNOSTICS));
  assert.throws(() => {
    "use strict"; // guarantee the frozen-write TypeError regardless of module mode
    (DIAGNOSTICS as Record<string, string>).basePactModified = "tampered";
  }, TypeError);
  assert.equal(DIAGNOSTICS.basePactModified, "base pact modified");
});
