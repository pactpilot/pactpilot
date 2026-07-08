/**
 * TypeScript types for the PactPilot pact/amendment file format.
 *
 * The normative definition is SPEC.md plus the JSON Schemas in ../schemas/.
 * These types mirror them for consumers of @pactpilot/schema; where they
 * disagree, the JSON Schemas win.
 */

/** Major-only schema version. Files with an unknown major are invalid. */
export const SCHEMA_VERSION = 1 as const;

export type SchemaVersion = typeof SCHEMA_VERSION;

/**
 * Scope declaration of a base pact.
 *
 * Entries are scope globs (SPEC §5): repo-root-relative, anchored, and
 * path-only — a glob covers any kind of change to a matching path. `deny`
 * beats `allow` and is permanent for the branch — amendments cannot touch it.
 */
export interface PactScope {
  allow: string[];
  deny?: string[];
}

/**
 * A base pact: the declared change-scope contract for one feature branch,
 * stored at `.pactpilot/pacts/<id>.json`. Immutable for the life of the
 * branch; every scope change goes through an amendment.
 */
export interface Pact {
  schemaVersion: SchemaVersion;
  /** Slug + 6-hex entropy suffix; equals the filename. Non-ordering. */
  id: string;
  title: string;
  description?: string;
  scope: PactScope;
  /** Informational only — consumed by instruction generators, never by the status engine. */
  acceptanceCriteria?: string[];
  /** Informational only — GitHub check names, never evaluated by the status engine. */
  requiredChecks?: string[];
}

/**
 * An amendment: an append-only scope change, stored at
 * `.pactpilot/amendments/<pactId>/<id>.json`. One file per amendment;
 * files are create-only. At least one of `addedScope`/`removedScope`
 * must be non-empty.
 *
 * Effective scope is per-file and ancestry-ordered: for each file, the
 * verdict (added/removed) whose introducing commit is latest by strict
 * ancestry wins; within one amendment, addedScope beats removedScope;
 * ancestry-incomparable conflicts resolve to removed (fail closed).
 * A PR diff touching an effectively removed path is Red. Base-pact
 * `deny` is permanent and beats everything.
 */
export interface Amendment {
  schemaVersion: SchemaVersion;
  /** Slug + 6-hex entropy suffix; equals the filename. Non-ordering. */
  id: string;
  /** Must equal the parent directory name. */
  pactId: string;
  /** Why the pact was changed — required, the audit trail is the point. Surfaced in the PR check summary. */
  description: string;
  /** Globs added to the pact's scope. */
  addedScope?: string[];
  /** Globs removed from the pact's scope. A removal stands: touching a removed path is Red. */
  removedScope?: string[];
}
