/**
 * PactPilot glob v1 conformance (SPEC §5).
 *
 * `fixtures/match-vectors.json` is the normative cross-implementation oracle
 * introduced by checklist 1.2: a conforming matcher — this package's reference
 * implementation or any reimplementation in another repo — must produce exactly
 * these results. Rows whose note starts with "invalid" double as the validity
 * truth table and pin the fail-closed rule: an invalid pattern never matches.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isValidScopeGlob, scopeGlobMatches } from "../src";

interface MatchVector {
  pattern: string;
  path: string;
  matches: boolean;
  note?: string;
}

const { vectors } = JSON.parse(
  readFileSync(join(__dirname, "..", "fixtures", "match-vectors.json"), "utf8"),
) as { vectors: MatchVector[] };

test("match-vectors.json has vectors", () => {
  assert.ok(vectors.length > 0);
});

for (const v of vectors) {
  const label =
    `${JSON.stringify(v.pattern)} vs ${JSON.stringify(v.path)}` +
    (v.note ? ` (${v.note})` : "");

  test(`scopeGlobMatches: ${label} -> ${v.matches}`, () => {
    assert.equal(scopeGlobMatches(v.pattern, v.path), v.matches);
  });
}

// Validity, derived from the same vectors: rows noted "invalid: …" are the
// invalid-pattern truth table; every other row's pattern must be valid.
const seen = new Set<string>();
for (const v of vectors) {
  if (seen.has(v.pattern)) continue;
  seen.add(v.pattern);
  const valid = !v.note?.startsWith("invalid");

  test(`isValidScopeGlob: ${JSON.stringify(v.pattern)} -> ${valid}`, () => {
    assert.equal(isValidScopeGlob(v.pattern), valid);
  });
}

// Gaps the vectors don't reach: reserved characters they only include paired,
// the segment rule's exact boundaries, and the control-character range edge.
const INVALID_GAPS: Array<[pattern: string, why: string]> = [
  ["a[b", "reserved [ unpaired"],
  ["a]b", "reserved ] unpaired"],
  ["a{b", "reserved { unpaired"],
  ["a}b", "reserved } unpaired"],
  ["a\u001Fb", "control character U+001F (top of reserved range)"],
];
const VALID_GAPS: Array<[pattern: string, why: string]> = [
  ["...", "only exact . and .. segments are outlawed"],
  ["a b", "U+0020 space is a literal, just outside the reserved range"],
];

for (const [pattern, why] of INVALID_GAPS) {
  test(`isValidScopeGlob: ${JSON.stringify(pattern)} -> false (${why})`, () => {
    assert.equal(isValidScopeGlob(pattern), false);
  });
}
for (const [pattern, why] of VALID_GAPS) {
  test(`isValidScopeGlob: ${JSON.stringify(pattern)} -> true (${why})`, () => {
    assert.equal(isValidScopeGlob(pattern), true);
  });
}
