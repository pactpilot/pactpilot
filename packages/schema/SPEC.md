# PactPilot Pact File Format — Specification

**Schema version: 1** · Status: draft (pre-1.0)

This specification and the accompanying JSON Schemas are available under the MIT License or CC0 1.0 Universal, at your option; reimplementation in any language or tool is expressly invited.

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
└── .pactignore                     # grammar & precedence in §5.4; loading is CLI behavior
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
  they govern is determined exclusively by commit ancestry (§7).

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
| `schemaVersion` | integer | yes | Major-only version; see §6 |
| `id` | string | yes | §2 |
| `title` | string | yes | One-line statement of intent |
| `description` | string | no | Longer rationale |
| `scope.allow` | string[] | yes, ≥1 | Globs the branch may change |
| `scope.deny` | string[] | no | Globs that may never be changed on this branch. Deny beats allow. **Permanent**: amendments cannot add to, remove from, or override it |
| `acceptanceCriteria` | string[] | no | **Informational only.** Consumed by instruction generators; evaluators MUST ignore it |
| `requiredChecks` | string[] | no | **Informational only.** GitHub check names for generators and future check observation; evaluators MUST ignore it |

Every scope entry is a **scope glob** (§5): repo-root-relative, anchored, and
path-only — a glob covers any kind of change to a matching path. There are no
per-entry change types in schemaVersion 1 (rationale in §5.3); typed entries, if ever
added, would be an object entry form in a future major version, which v1 evaluators
reject and therefore fail closed on.

**The base pact is permanently immutable for the life of its branch.** There is no
legitimate direct edit, ever — including deliberate scope renegotiation. Every scope
change goes through an amendment.

**Deliberately absent fields:**

- **No timestamps.** Git ancestry is the only clock; a timestamp field would be a
  standing temptation to trust something trivially spoofable.
- **No author field.** The git commit is the authorship record.
- **No approval fields of any kind** (§8).
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
| `schemaVersion` | integer | yes | §6 |
| `id` | string | yes | §2; non-ordering |
| `pactId` | string | yes | Must equal parent directory name |
| `description` | string | yes | Why the pact was changed — required because the audit trail is the point. Surfaced in the PR check summary |
| `addedScope` | string[] | * | Globs added to the pact's scope |
| `removedScope` | string[] | * | Globs removed from the pact's scope (see §4.2) |

\* At least one of `addedScope`/`removedScope` MUST be non-empty.

### 4.1 Additions

Additions may be written freely, by humans or agents — what determines status color
is *when* the addition lands relative to the change it covers (§7), not who wrote it.

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

## 5. Scope expressions

The four scope arrays — `scope.allow` and `scope.deny` (§3), `addedScope` and
`removedScope` (§4) — share one grammar and one matching function, defined here. An
entry in any of them is a **scope glob**. There is exactly one dialect, **PactPilot
glob v1**; nothing in this section is configurable. This section is self-contained by
design: a conforming matcher MUST be implementable from this section alone, and
[`fixtures/match-vectors.json`](fixtures/match-vectors.json) in this package is the
machine-readable conformance suite for it.

The design invariant behind every rule: **same diff + same pact = same verdict, in
every environment.** Matching is pure string comparison between a pattern and a
git-reported path; nothing in it may depend on filesystem, platform, locale, or git
configuration.

### 5.1 Grammar

A scope glob is a non-empty UTF-8 string of one or more **segments** joined by `/`:

```
glob     = segment , { "/" , segment } ;
segment  = "**" | chars ;
chars    = char , { char } ;                 (* non-empty *)
char     = "*" | literal ;
literal  = any Unicode scalar value except "/" and reserved ;
reserved = "?" | "[" | "]" | "{" | "}" | "!" | "\" | U+0000–U+001F ;
```

A pattern violating any of the following is **invalid**:

- The empty string `""`.
- A leading `/`; a trailing `/` (write `dir/**` — there is no implicit expansion of
  `dir/`).
- A `.` or `..` segment anywhere (this also outlaws a leading `./`).
- An empty segment (`//`).
- `**` adjacent to any other character within a segment (`foo**`, `a**b`, `***`):
  `**` is only ever a complete segment.
- Any reserved character anywhere. Reserved characters are deliberately *invalid*,
  not literal: a future major version may assign one a meaning, and an evaluator
  that does not know that meaning MUST reject the pattern (fail closed) rather than
  match it differently. Alternation needs no syntax — the scope arrays already
  provide it: write `**/*.ts` and `**/*.tsx` as two entries.

There is no escaping mechanism. A repository path that itself contains a reserved
character or a literal `*` cannot be targeted individually; cover it with a `*`/`**`
pattern. Known v1 limitation.

**Negation is excluded permanently, not reserved for later.** Subtractive scope
already exists (`removedScope`, `deny`), and a second subtraction channel inside glob
syntax would conflict with it: gitignore-style `!` is list-order-dependent, but the
scope arrays are unordered sets; a `!` glob in `addedScope` would be a removal wearing
an addition's temporal semantics (§4.3); and a `!` glob in `allow` would be a shadow
`deny` without deny's permanence. "Everything except X" is written as a broad `allow`
plus `deny: ["X"]`.

**Invalid patterns fail closed.** An invalid scope glob never matches any path, and it
makes its containing file invalid. An invalid base pact or amendment of the governing
pact cannot be verified and MUST NOT be skipped — the PR is Red, with a diagnostic
distinct from scope drift (**"invalid governing file"**, not "diff exceeds pact").
An unrecognized `schemaVersion` fails closed through the same no-skipping rule, with
its own distinct diagnostic (§6). Skipping is forbidden
because it fails open: a skipped amendment's `removedScope` would vanish, resurrecting
coverage its author revoked. The rule applies to every scope array equally, including
`removedScope`.

### 5.2 Matching semantics

A pattern is matched against a **path**: a repo-root-relative file path exactly as git
reports it in the diff — `/`-separated, no leading `./` or `/`.

- **Anchored.** The whole pattern must consume the whole path. `payments.ts` matches
  only the root-level file `payments.ts`; write `**/payments.ts` to match at any
  depth. There is no gitignore-style "pattern without a slash matches at any level".
- **Exact bytes, always.** Literals compare by exact code-point equality against the
  path as git stores it. Case-sensitive, no case folding, no Unicode normalization
  (NFC/NFD), no locale involvement. A mismatch is a non-match, which fails toward
  uncovered → Red — the closed direction. *Non-normative:* on macOS, git may store
  decomposed (NFD) filenames depending on `core.precomposeunicode`; a pattern must
  match the repository's stored form.
- **`*`** matches zero or more characters within a single segment; it never
  matches `/`.
- **`**`** matches whole path segments:
  - leading `**/` and mid-pattern `/**/` match **zero or more** segments
    (`a/**/b` matches `a/b`, `a/x/b`, `a/x/y/b`);
  - trailing `/**` matches **one or more** segments (`src/**` matches every file
    strictly under `src/` and does not match a file literally named `src`);
  - a bare `**` pattern matches every path.
- **Files only, never the filesystem.** Patterns match file paths in a git diff —
  never directories, and never anything resolved against a working tree. Symlinks are
  never resolved: a symlink is a blob at its own path; its target is irrelevant. The
  evaluator never touches the working tree or filesystem; matching is pure string
  matching over git-reported paths. This is the environment-independence guarantee.

Conformance vectors (normative; full machine-readable set in
`fixtures/match-vectors.json`):

| Pattern | Path | Match? |
|---|---|---|
| `payments.ts` | `payments.ts` | yes |
| `payments.ts` | `src/payments.ts` | no — anchored |
| `**/payments.ts` | `payments.ts` | yes — leading `**/` spans zero segments |
| `**/payments.ts` | `a/b/payments.ts` | yes |
| `src/**` | `src/a.ts` | yes |
| `src/**` | `src/a/b/c.ts` | yes |
| `src/**` | `src` | no — trailing `/**` needs ≥1 segment |
| `src/**` | `srcx/a.ts` | no |
| `a/**/b` | `a/b` | yes — mid `**` spans zero segments |
| `a/**/b` | `a/x/y/b` | yes |
| `*.ts` | `a.ts` | yes |
| `*.ts` | `src/a.ts` | no — `*` never crosses `/` |
| `src/*.ts` | `src/a/b.ts` | no |
| `**` | `a/b/c.ts` | yes |
| `SRC/**` | `src/a.ts` | no — case-sensitive |
| `!src/**` | `src/a.ts` | no — invalid pattern never matches |
| `src/**/` | `src/a.ts` | no — invalid (trailing `/`) |
| `./src/**` | `src/a.ts` | no — invalid (`.` segment) |
| `a**b/c` | `axyb/c` | no — invalid (embedded `**`) |
| `` (empty) | `a.ts` | no — invalid |

### 5.3 Changed-path model

Scope coverage is **path-only**: a scope glob covers *any* kind of change to a
matching path — add, modify, delete, mode-only, typechange (e.g. file↔symlink),
rename, copy, and submodule-pointer changes alike. There are no per-entry change
types in schemaVersion 1. Rationale, recorded: git rename/copy detection is heuristic
and configuration-dependent, so type-restricted coverage would let git settings
change verdicts; and restricting *kinds* of edits is a second sort of judgment beyond
scope comparison. If typed entries are ever needed, they will be an object entry form
in a future major version — the v1 schemas accept only strings, so an older evaluator
meeting one rejects the file and fails closed.

The **changed-path set** of a PR is defined over the merge-base → head diff (§7).
Every diff entry contributes the union of its pre-image and post-image paths:

| Diff entry | Contributes |
|---|---|
| add | the new path |
| delete | the deleted path |
| modify / mode-only / typechange | the path |
| rename `old → new` | **both** `old` and `new` |
| copy `src → dst` | `dst` only (the source is unchanged) |
| submodule pointer change | the submodule path |

Every path in the changed-path set requires coverage. Both sides of a rename require
it because a rename deletes at the old path and creates at the new one — otherwise
renaming a file out of a denied or uncovered area would launder the change.

**Property evaluators may rely on: rename-detection settings cannot change the
verdict.** A detected rename and its undetected delete+add pair contribute identical
paths. Two rules make this normative: an evaluator that invokes git MUST disable
rename/copy detection (`--no-renames` or equivalent); an evaluator consuming a diff
source it does not control (e.g. the GitHub REST pull-request-files API, which always
applies rename detection) MUST decompose every reported rename/copy per the table
above.

### 5.4 `.pactignore`

`.pactpilot/.pactignore` excludes machine-generated files from scope evaluation. Its
grammar and precedence are defined here; discovery and loading are CLI/Action
behavior, outside this spec.

- **Format.** Line-oriented UTF-8. Per line: strip one trailing `\r` (CRLF
  tolerance); a blank line, or a line whose first character is `#`, is ignored; every
  other line MUST be, **verbatim**, a valid scope glob (§5.1). No whitespace trimming
  (paths may contain spaces) and no escaping (so a path starting with `#` cannot be
  ignored — known limitation).
- **Fail closed as a whole file.** If any non-blank, non-comment line is not a valid
  scope glob, the entire file is treated as absent — zero ignore rules apply — and
  evaluators surface a distinct diagnostic. No per-line best-effort.
- **Trust.** Per §1/§7: read only ever from the base branch. A PR-side edit has no
  evaluation effect until merged, and itself requires ordinary scope coverage.
- **Precedence.** The integrity check (§7) runs first and is entirely independent of
  `.pactignore`: paths under `.pactpilot/pacts/` and `.pactpilot/amendments/` can
  never be ignored, so a merged ignore rule can never mask tampering. Then, for each
  path `f` in the changed-path set:
  1. `f` matches base `scope.deny` → Red. **Deny beats ignore**: deny is the pact
     author's explicit "never change this"; ignore is repo-wide plumbing; a conflict
     must surface, and Red is the closed direction.
  2. Else `f` matches any `.pactignore` glob → `f` is excluded from scope evaluation
     entirely: it contributes no per-file color, neither covered nor uncovered.
  3. Else → ordinary effective-scope evaluation (§4.3).

## 6. `schemaVersion`

- A bare JSON **integer**, currently `1` — never a semver string. The field
  identifies the file format, and the check is trivial equality.
- **Check order: version gate first, validation second.** An evaluator reads the
  `schemaVersion` field before anything else. An integer value it does not recognize
  (today: anything other than `1`) means the file cannot be verified → Red, with the
  distinct **"unsupported schema version"** diagnostic; full schema validation is not
  attempted. A missing or non-integer `schemaVersion` is malformed content → Red,
  with the **"invalid governing file"** diagnostic (§5.1). In both cases the file
  MUST NOT be silently skipped — skipping fails open, for the reason given in §5.1.
- This completes the canonical diagnostic set at four strings: "base pact modified",
  "path removed from scope", "invalid governing file", "unsupported schema version".
- **Future versions are deliberately undesigned.** schemaVersion 2 does not exist.
  If it ever does, compatibility policy — which older versions an evaluator
  supports, how the npm package version relates, the migration approach — will be
  decided as part of designing it, with the benefit of real usage. Until then the
  only rule is: an unrecognized version fails closed. Nothing an evaluator does
  today needs to change for that rule to keep holding. One constraint is already
  fixed by §1's create-only rule: in-place edits of a base pact are never legal —
  that is the integrity check working — so any future "migration" means re-cutting
  the pact, not rewriting the file.

## 7. Evaluation read model

A conforming evaluator (the Action's status check, or the CLI reproducing it) reads
exactly these inputs and nothing else:

1. **PR head tree**: `.pactpilot/pacts/*.json` and `.pactpilot/amendments/**/*.json`.
2. **Base branch tree**: the same paths — the trusted integrity reference — plus the
   reserved `config.json` / `.pactignore`. Trusted configuration is *only* ever read
   from the base branch.
3. **Git graph**: the introducing commit of each `pacts/`/`amendments/` file,
   strict-ancestor relations between commits, and the set of `.pactpilot/` paths
   touched by each commit in the PR range.
4. **PR diff** (merge-base → head): the changed-path set as defined in §5.3 —
   rename/copy entries decomposed so rename-detection settings cannot change the
   verdict.

Evaluators MUST NOT read: commit timestamps (author or committer), any hash or
digest stored in a file, any approval-like file content, or GitHub API state as an
input to scope/integrity math. (PR-review approval, where a policy requires it, is a
GitHub-native signal checked via the API *outside* this format — see §8.)

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
- **Per-file color.** For each path in the changed-path set (§5.3), after deny and
  `.pactignore` are applied in the precedence order of §5.4: covered, with the covering pact or
  amendment's introducing commit a **strict ancestor** of the commit(s) changing the
  file → Green. Covered, but not by a strict ancestor (retroactive amendment,
  same-commit amendment+change, or a pact created for a branch that already had
  commits) → Yellow. Uncovered → Red; when the file is uncovered because it matches
  an effective removal (§4.3), evaluators MUST use the distinct "path removed from
  scope" messaging rather than ordinary "diff exceeds pact". Overall status is the
  worst per-file color; integrity Red overrides everything.

## 8. Approvals are never file-writable

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

## 9. Version History

Append-only changelog of the file format — a place to write down what changed and
why, one entry per `schemaVersion`, newest first.

- **schemaVersion 1** (current) — initial format: base pact + append-only amendment
  list (§§1–4); PactPilot glob v1 scope grammar, path-only changed-path model, and
  `.pactignore` contract (§5); integer `schemaVersion` with fail-closed handling of
  unrecognized versions (§6). First published as `@pactpilot/schema` 1.0.0.
