/**
 * Canonical Red-reason diagnostic strings (SPEC §5.1, §6, §7).
 *
 * The hook, the Action, and their tests import these rather than retyping the
 * strings, so the three repos can never drift on the user-facing reasons.
 */
export const DIAGNOSTICS = Object.freeze({
  /** Integrity check: a create-only pacts/ or amendments/ file changed after its introducing commit. */
  basePactModified: "base pact modified",
  /** Scope check: the diff touches a path whose effective coverage is a removal. */
  pathRemovedFromScope: "path removed from scope",
  /** A governing file is malformed: schema-invalid, invalid scope glob, or missing/non-integer schemaVersion. */
  invalidGoverningFile: "invalid governing file",
  /** A governing file carries an integer schemaVersion this evaluator does not recognize. */
  unsupportedSchemaVersion: "unsupported schema version",
} as const);

export type Diagnostic = (typeof DIAGNOSTICS)[keyof typeof DIAGNOSTICS];
