/**
 * JSON Schema fixture sweep (SPEC §3–§4) plus the schema-validatable parts of
 * the evaluation fixtures (SPEC §5.1, §6).
 *
 * Data-driven: dropping a fixture into fixtures/valid/, fixtures/invalid/, or
 * fixtures/evaluation/<scenario>/ adds a test with no code change. Fixture
 * basenames choose the schema: pact-* validates against pact.schema.json,
 * amendment-* against amendment.schema.json.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import { pactSchema, amendmentSchema, DIAGNOSTICS } from "../src";

const FIXTURES = join(__dirname, "..", "fixtures");

const ajv = new Ajv2020({ allErrors: true });
const validatePact = ajv.compile(pactSchema);
const validateAmendment = ajv.compile(amendmentSchema);

function validatorFor(fileName: string): ValidateFunction {
  if (fileName.startsWith("pact-")) return validatePact;
  if (fileName.startsWith("amendment-")) return validateAmendment;
  throw new Error(
    `fixture ${fileName} must be named pact-* or amendment-* to select its schema`,
  );
}

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

// --- fixtures/valid/: every fixture accepts -------------------------------

const validFiles = readdirSync(join(FIXTURES, "valid")).sort();

test("fixtures/valid is non-empty", () => {
  assert.ok(validFiles.length > 0);
});

for (const name of validFiles) {
  test(`valid/${name} accepts`, () => {
    const validate = validatorFor(name);
    const ok = validate(loadJson(join(FIXTURES, "valid", name)));
    assert.ok(ok, ajv.errorsText(validate.errors));
  });
}

// --- fixtures/invalid/: every fixture rejects, spot-checked for WHY -------

const invalidFiles = readdirSync(join(FIXTURES, "invalid")).sort();

// Where a wrong rejection reason would be misleading, pin the ajv error
// location. instancePath prefixes for wrong-shaped present fields…
const EXPECTED_ERROR_PATH: Record<string, string> = {
  "pact-semver-string-version.json": "/schemaVersion",
  "pact-unknown-version.json": "/schemaVersion",
  "pact-bad-id.json": "/id",
  "pact-empty-allow.json": "/scope/allow",
};
for (const name of invalidFiles) {
  if (name.startsWith("pact-glob-")) EXPECTED_ERROR_PATH[name] = "/scope/allow";
}
// …and required-keyword misses for absent fields.
const EXPECTED_MISSING_PROPERTY: Record<string, string> = {
  "amendment-missing-description.json": "description",
  "pact-missing-scope.json": "scope",
};

test("fixtures/invalid is non-empty", () => {
  assert.ok(invalidFiles.length > 0);
});

for (const name of invalidFiles) {
  test(`invalid/${name} rejects`, () => {
    const validate = validatorFor(name);
    const ok = validate(loadJson(join(FIXTURES, "invalid", name)));
    assert.equal(ok, false);
    const errors = validate.errors ?? [];

    const pathPrefix = EXPECTED_ERROR_PATH[name];
    if (pathPrefix !== undefined) {
      assert.ok(
        errors.some((e) => e.instancePath.startsWith(pathPrefix)),
        `expected an error at ${pathPrefix}, got: ${ajv.errorsText(errors)}`,
      );
    }

    const missing = EXPECTED_MISSING_PROPERTY[name];
    if (missing !== undefined) {
      assert.ok(
        errors.some(
          (e) => e.keyword === "required" && e.params.missingProperty === missing,
        ),
        `expected a required-property error for "${missing}", got: ${ajv.errorsText(errors)}`,
      );
    }
  });
}

// --- fixtures/evaluation/: schema-validatable parts ONLY ------------------
//
// These scenarios are verdict-bearing conformance data for the status engine
// (checklist 2.6/2.8), which does not exist yet. Executing expected.json's
// verdicts (overall/red etc.) is deliberately deferred to 2.8. What IS
// testable now: each component file validates or rejects as the scenario
// requires (files listed in expected.json's invalidFiles reject, all others
// accept — location picks the schema: .pactpilot/pacts/ vs .pactpilot/amendments/),
// and each expected.json references a diagnostic that exists in DIAGNOSTICS,
// so the strings cannot drift before 2.x ever runs them.

interface ExpectedJson {
  overall: string;
  diagnostic: string;
  invalidFiles: string[];
}

const evalRoot = join(FIXTURES, "evaluation");
const scenarios = readdirSync(evalRoot).sort();

test("fixtures/evaluation is non-empty", () => {
  assert.ok(scenarios.length > 0);
});

for (const scenario of scenarios) {
  const scenarioRoot = join(evalRoot, scenario);
  const expected = loadJson(join(scenarioRoot, "expected.json")) as ExpectedJson;

  test(`evaluation/${scenario}: expected.json references a canonical diagnostic`, () => {
    const canonical = Object.values(DIAGNOSTICS) as string[];
    assert.ok(
      canonical.includes(expected.diagnostic),
      `"${expected.diagnostic}" is not in DIAGNOSTICS (${canonical.join(", ")})`,
    );
    assert.ok(expected.invalidFiles.length > 0);
  });

  const componentFiles = (
    readdirSync(join(scenarioRoot, ".pactpilot"), { recursive: true }) as string[]
  )
    .filter((p) => p.endsWith(".json"))
    .map((p) => join(".pactpilot", p))
    .sort();

  test(`evaluation/${scenario}: has pact and amendment component files`, () => {
    assert.ok(componentFiles.some((p) => p.includes("/pacts/")));
    assert.ok(componentFiles.some((p) => p.includes("/amendments/")));
  });

  for (const rel of componentFiles) {
    const shouldReject = expected.invalidFiles.includes(rel);
    const validate = rel.includes("/pacts/") ? validatePact : validateAmendment;

    test(`evaluation/${scenario}: ${rel} ${shouldReject ? "rejects" : "accepts"}`, () => {
      const ok = validate(loadJson(join(scenarioRoot, rel)));
      if (shouldReject) {
        assert.equal(ok, false);
      } else {
        assert.ok(ok, ajv.errorsText(validate.errors));
      }
    });
  }
}
