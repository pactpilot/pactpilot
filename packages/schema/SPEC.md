# PactPilot Pact File Format — Specification

**Schema version: 1** · Status: draft (pre-1.0)

This document is the normative definition of the `.pactpilot/` file format read by the
PactPilot CLI and GitHub Action. The JSON Schemas in [`schemas/`](schemas/) are the
machine-readable companion; where prose and schema disagree, the schema wins for
per-file validity and this document wins for evaluation semantics.

The keywords MUST, MUST NOT, and MAY are used in their RFC 2119 sense.

---

## 1. Directory layout

All PactPilot files live under `.pactpilot/` at the repository root:

```
.pactpilot/
├── pacts/
│   └── <pact-id>.json              # base pact — immutable for branch life
├── amendments/
│   └── <pact-id>/
│       └── <amendment-id>.json     # one file per amendment, create-only
├── config.json                     # RESERVED — not defined in schema v1
└── .pactignore                     # RESERVED — grammar defined by the CLI
```

- Files under `pacts/` and `amendments/` are **create-only** within a pull request:
  a commit that modifies or deletes one of these files after the commit that
  introduced it is tampering, and evaluators MUST report it as Red. This single rule
  covers both base-pact tampering and amendment tampering — the append-only amendment
  list is structural, not policed: an amendment is always a *new* file.
- The reserved files (`config.json`, `.pactignore`) are **not** create-only. They are
  ordinary scoped files: changing them requires scope coverage like any other path.
  Their trust property is different in kind — evaluators MUST only ever read them from
  the **base branch**, never from the PR head, so a PR-side change has no evaluation
  effect until it is merged and reviewed. Anchored, not frozen.

## 2. Identifiers

Pact and amendment ids MUST match:

```
^[a-z0-9][a-z0-9-]*-[0-9a-f]{6}$
```

i.e. a human-chosen lowercase slug plus a 6-hex-character entropy suffix
(e.g. `checkout-refactor-4f2a1c`). The suffix exists because merged branches
accumulate their pact files on the base branch; entropy prevents filename collisions
between unrelated branches that chose the same slug.

- A pact file's `id` MUST equal its filename without the `.json` extension.
- An amendment file's `id` MUST equal its filename without the `.json` extension, and
  its `pactId` MUST equal the name of its parent directory. Any mismatch makes the
  file invalid.
- Ids carry **no ordering semantics**. Ordering of pacts, amendments, and the changes
  they govern is determined exclusively by commit ancestry (§6).

## 3. Base pact — `pacts/<id>.json`

```json
{
  "schemaVersion": 1,
  "id": "checkout-refactor-4f2a1c",
  "title": "Refactor checkout flow",
  "description": "Replace legacy checkout with the new payments API.",
  "scope": {
    "allow": ["src/checkout/**", "src/lib/payments.ts"],
    "deny": ["src/checkout/legacy/**"]
  },
  "acceptanceCriteria": ["Checkout E2E suite passes", "No changes to public API types"],
  "requiredChecks": ["ci/e2e-checkout"]
}
```

| Field | Type | Required | Semantics |
|---|---|---|---|
| `schemaVersion` | integer | yes | Major-only version; see §5 |
| `id` | string | yes | §2 |
| `title` | string | yes | One-line statement of intent |
| `description` | string | no | Longer rationale |
| `scope.allow` | string[] | yes, ≥1 | Globs the branch may change |
| `scope.deny` | string[] | no | Globs that may never be changed on this branch. Deny beats allow. **Permanent**: amendments cannot add to, remove from, or override it |
| `acceptanceCriteria` | string[] | no | **Informational only.** Consumed by instruction generators; evaluators MUST ignore it |
| `requiredChecks` | string[] | no | **Informational only.** GitHub check names for generators and future check observation; evaluators MUST ignore it |

Globs are repo-root-relative, gitignore/picomatch style. (The full glob grammar and
optional per-entry change types are a planned extension within these same fields.)

**The base pact is permanently immutable for the life of its branch.** There is no
legitimate direct edit, ever — including deliberate scope renegotiation. Every scope
change goes through an amendment.

**Deliberately absent fields:**

- **No timestamps.** Git ancestry is the only clock; a timestamp field would be a
  standing temptation to trust something trivially spoofable.
- **No author field.** The git commit is the authorship record.
- **No approval fields of any kind** (§7).
- **No `amendmentPolicy`.** If a policy knob is added it belongs in the reserved,
  base-branch-read `config.json` — anything in the PR branch is agent-writable and
  therefore cannot carry policy.

## 4. Amendment — `amendments/<pactId>/<id>.json`

```json
{
  "schemaVersion": 1,
  "id": "add-tax-service-9b3e77",
  "pactId": "checkout-refactor-4f2a1c",
  "description": "Checkout refactor requires touching the tax calculation service.",
  "addedScope": ["src/tax/**"],
  "removedScope": ["src/lib/payments.ts"]
}
```

| Field | Type | Required | Semantics |
|---|---|---|---|
| `schemaVersion` | integer | yes | §5 |
| `id` | string | yes | §2; non-ordering |
| `pactId` | string | yes | Must equal parent directory name |
| `description` | string | yes | Why the pact was changed — required because the audit trail is the point. Surfaced in the PR check summary |
| `addedScope` | string[] | * | Globs added to the pact's scope |
| `removedScope` | string[] | * | Globs removed from the pact's scope (see §4.2) |

\* At least one of `addedScope`/`removedScope` MUST be non-empty.

### 4.1 Additions

Additions may be written freely, by humans or agents — what determines status color
is *when* the addition lands relative to the change it covers (§6), not who wrote it.

### 4.2 Removals

A removal takes a path out of the pact's scope. Rules:

1. A `removedScope` entry is an ordinary glob. It does **not** need to match a
   previously added glob string — it removes coverage from every file it matches,
   subject to the ordering rules of §4.3.
2. **A removal stands.** If the PR diff touches a path whose effective coverage
   (§4.3) is a removal, evaluators MUST report it as Red, with messaging distinct
   from ordinary scope drift ("path removed from scope" vs. "diff exceeds pact").
   There is no invalidation of removals: a removal is never ignored because
   matching changes exist — those changes are exactly what it turns Red.
3. **Within a single amendment, `addedScope` beats `removedScope`** for a file
   matching both. This makes one-shot narrowing work: remove the broad glob and
   re-add the narrower one in the same amendment. Remove-then-re-add across later
   amendments is also fine — the re-add is just a new addition under the normal
   temporal rules, and the log reads as what happened: added, walked back,
   deliberately re-opened.

Removals are safe to leave unrestricted because they are self-constraining: an
addition claims territory, but a removal only ties the author's own hands — the
worst outcome of writing one is turning yourself Red.

### 4.3 Effective scope

Per-file and **ancestry-ordered** — when amendments conflict on a path, the latest
one by commit ancestry wins:

```
verdict(f, base pact) = added,   if f matches any base.scope.allow glob
verdict(f, amendment) = added,   if f matches any addedScope glob
                      = removed, if f matches any removedScope glob and no addedScope glob

For each file f, take the verdicts whose introducing commits are maximal in the
strict-ancestry order (the "latest" ones — no other verdict's commit descends
from them):
  any maximal verdict is "removed" → f is uncovered (removed; touching it is Red)
  otherwise                        → f is covered iff at least one verdict exists

covered(f) additionally requires ¬matchesAny(f, base.scope.deny) — deny is
permanent and beats everything.
```

Properties evaluators may rely on: evaluation **depends on amendment ancestry**
(never on ids, filenames, or timestamps); when conflicting verdicts are
ancestry-incomparable (same commit, or parallel branches later merged), **removal
wins** — the model fails closed. Status is deliberately **not monotonic**: a later
removal can uncover earlier work, and any diff file it uncovers is Red.

## 5. `schemaVersion`

- An integer, major-only, currently `1`.
- A file whose `schemaVersion` is not a major the evaluator knows is **invalid**. An
  invalid governing file cannot be verified and MUST NOT be silently skipped; the
  status engine surfaces it as Red.
- The `@pactpilot/schema` npm package's major version tracks `schemaVersion`; minor
  and patch releases are non-breaking tooling changes. Every change to this format
  is a breaking-change decision.

## 6. Evaluation read model

A conforming evaluator (the Action's status check, or the CLI reproducing it) reads
exactly these inputs and nothing else:

1. **PR head tree**: `.pactpilot/pacts/*.json` and `.pactpilot/amendments/**/*.json`.
2. **Base branch tree**: the same paths — the trusted integrity reference — plus the
   reserved `config.json` / `.pactignore`. Trusted configuration is *only* ever read
   from the base branch.
3. **Git graph**: the introducing commit of each `pacts/`/`amendments/` file,
   strict-ancestor relations between commits, and the set of `.pactpilot/` paths
   touched by each commit in the PR range.
4. **PR diff** (merge-base → head): changed file paths and change types.

Evaluators MUST NOT read: commit timestamps (author or committer), any hash or
digest stored in a file, any approval-like file content, or GitHub API state as an
input to scope/integrity math. (PR-review approval, where a policy requires it, is a
GitHub-native signal checked via the API *outside* this format — see §7.)

Normative rules stated here for implementers:

- **Integrity.** A `pacts/` or `amendments/` file that exists on the base branch
  MUST byte-match the base-branch copy at the PR head; any difference is Red, with
  messaging distinct from ordinary scope drift ("base pact modified" vs. "diff
  exceeds pact"). First-PR case: the PR that introduces a pact to the base branch
  legitimately *adds* the file; the tamper signal is the file being *modified* in
  any commit after the one that introduced it (ancestry gives you this).
- **Binding.** The governing pact of a PR is the pact whose file is introduced by
  commits in the PR range — **ancestry-derived**. Branch names are renameable,
  mutable metadata and carry zero semantic weight; any `pact/<slug>` branch-naming
  convention is UX only. Behavior for PRs that introduce zero pacts (unpacted) or
  more than one is status-engine policy, outside this spec.
- **Implicit scope.** Additions of schema-valid pact/amendment files for the
  governing pact under `pacts/`/`amendments/` are implicitly in scope. Changes to
  the reserved files require ordinary scope coverage.
- **Per-file color.** For each changed file: covered, with the covering pact or
  amendment's introducing commit a **strict ancestor** of the commit(s) changing the
  file → Green. Covered, but not by a strict ancestor (retroactive amendment,
  same-commit amendment+change, or a pact created for a branch that already had
  commits) → Yellow. Uncovered → Red; when the file is uncovered because it matches
  an effective removal (§4.3), evaluators MUST use the distinct "path removed from
  scope" messaging rather than ordinary "diff exceeds pact". Overall status is the
  worst per-file color; integrity Red overrides everything.

## 7. Approvals are never file-writable

No field in any pact or amendment file may carry approval semantics — otherwise an
agent could forge its own approval by writing it. This is enforced in layers:

- Every object in both JSON Schemas sets `additionalProperties: false`, so approval
  fields cannot be smuggled in as extras.
- Validators additionally MUST reject any document containing approval-like keys at
  any depth (`approved`, `approval`, `approvals`, `approvedBy`, `signedOff`,
  `status`), so the invariant survives even if a future schema version relaxes
  `additionalProperties`.

Approval, where required, is only ever a GitHub-native signal (a PR review) verified
via the API.
