/**
 * Normative reference implementation of PactPilot glob v1 (SPEC.md §5).
 *
 * Pure, dependency-free, no I/O. `fixtures/match-vectors.json` is the
 * acceptance oracle; where this code and SPEC §5 disagree, SPEC and the
 * vectors win. The status engine consumes these functions rather than
 * reimplementing matching, so hook and Action verdicts cannot diverge.
 */

/** Reserved characters (SPEC §5.1); control characters below U+0020 are also reserved. */
const RESERVED = "?[]{}!\\";

function hasReservedChar(pattern: string): boolean {
  for (const ch of pattern) {
    if (ch < " " || RESERVED.includes(ch)) return true;
  }
  return false;
}

/**
 * Whether `pattern` is a valid scope glob per SPEC §5.1.
 *
 * Invalid patterns fail closed: they never match any path, and an invalid
 * glob in any scope array makes its containing file invalid (Red).
 */
export function isValidScopeGlob(pattern: string): boolean {
  if (pattern.length === 0) return false;
  if (hasReservedChar(pattern)) return false;
  for (const segment of pattern.split("/")) {
    if (segment.length === 0) return false; // leading/trailing "/" or "//"
    if (segment === "." || segment === "..") return false;
    if (segment !== "**" && segment.includes("**")) return false;
  }
  return true;
}

/**
 * Whether `path` matches `pattern` per SPEC §5.2.
 *
 * `path` is a repo-root-relative file path exactly as git reports it —
 * `/`-separated, no leading `./` or `/`. Matching is anchored, case-sensitive,
 * exact-code-point, with no Unicode normalization and no filesystem access.
 * An invalid pattern matches nothing.
 */
export function scopeGlobMatches(pattern: string, path: string): boolean {
  if (!isValidScopeGlob(pattern)) return false;
  if (path.length === 0) return false;
  return matchSegments(pattern.split("/"), 0, path.split("/"), 0);
}

function matchSegments(
  pattern: string[],
  pi: number,
  path: string[],
  ti: number,
): boolean {
  if (pi === pattern.length) return ti === path.length;
  const segment = pattern[pi];
  if (segment === "**") {
    // Trailing `/**` (and bare `**`) require one or more segments;
    // leading `**/` and mid-pattern `/**/` span zero or more.
    if (pi === pattern.length - 1) return ti < path.length;
    for (let skip = ti; skip <= path.length; skip++) {
      if (matchSegments(pattern, pi + 1, path, skip)) return true;
    }
    return false;
  }
  if (ti === path.length) return false;
  return (
    matchOneSegment(segment, path[ti]) &&
    matchSegments(pattern, pi + 1, path, ti + 1)
  );
}

/** Match a single non-`**` pattern segment; `*` spans zero or more non-`/` characters. */
function matchOneSegment(pattern: string, text: string): boolean {
  let pi = 0;
  let ti = 0;
  let starPi = -1;
  let starTi = 0;
  while (ti < text.length) {
    if (pi < pattern.length && pattern[pi] === text[ti]) {
      pi++;
      ti++;
    } else if (pi < pattern.length && pattern[pi] === "*") {
      starPi = pi++;
      starTi = ti;
    } else if (starPi >= 0) {
      pi = starPi + 1;
      ti = ++starTi;
    } else {
      return false;
    }
  }
  while (pi < pattern.length && pattern[pi] === "*") pi++;
  return pi === pattern.length;
}
