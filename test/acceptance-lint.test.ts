import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyCliOverrides, loadRepoConfig } from "../src/config/load.js";
import {
  javascriptAdapter,
  pythonAdapter,
  resolveAcceptanceLintAdapter,
} from "../src/spec/acceptance-lint-adapters/index.js";
import { lintAcceptanceTests } from "../src/spec/acceptance-lint.js";
import { findScenarioTests } from "../src/spec/scenario-tests.js";
import { parseScenarios } from "../src/spec/gherkin.js";

const BEHAVIOR = `Feature: demo

  Scenario: 1. add two numbers
    When I enter "1"
    And I press "+"
    And I enter "2"
    And I press "="
    Then the display shows "3"
`;

const GOOD_JS = `// acd-scenario: 1
import { enter, press, displayShows } from "../support/steps.js";

test("add", async () => {
  // When I enter "1"
  await enter("1");
  // And I press "+"
  await press("+");
  // And I enter "2"
  await enter("2");
  // And I press "="
  await press("=");
  // Then the display shows "3"
  await displayShows("3");
});
`;

const BAD_JS = `// acd-scenario: 1
import { createCalculator } from "../../calculator.js";

test("add", () => {
  createCalculator();
});
`;

const GOOD_PY = `# acd-scenario: 1
from ..support.steps import enter, press, display_shows

def test_add():
    # When I enter "1"
    enter("1")
    # And I press "+"
    press("+")
    # And I enter "2"
    enter("2")
    # And I press "="
    press("=")
    # Then the display shows "3"
    display_shows("3")
`;

const BAD_PY = `# acd-scenario: 1
from calculator import create_calculator
import unittest.mock

def test_add():
    unittest.mock.patch("builtins.print")
    create_calculator()
`;

describe("acceptance lint adapters", () => {
  it("resolves javascript and python by extension", () => {
    expect(resolveAcceptanceLintAdapter("tests/acceptance/add.test.ts")?.id).toBe(
      "javascript",
    );
    expect(resolveAcceptanceLintAdapter("tests/acceptance/test_add.py")?.id).toBe(
      "python",
    );
    expect(javascriptAdapter.isTestFile("tests/acceptance/add.test.js")).toBe(true);
    expect(pythonAdapter.isTestFile("tests/acceptance/test_add.py")).toBe(true);
    expect(pythonAdapter.isTestFile("tests/acceptance/add_test.py")).toBe(true);
  });
});

describe("acceptance lint", () => {
  it("accepts a bound JS scenario test that uses the support module", () => {
    const repo = seedJs();
    writeFileSync(join(repo, "tests/acceptance/add.test.js"), GOOD_JS);
    const config = load(repo);
    expect(lintAcceptanceTests(repo, config, BEHAVIOR).ok).toBe(true);
  });

  it("rejects JS product imports and missing step comments", () => {
    const repo = seedJs();
    writeFileSync(join(repo, "tests/acceptance/add.test.js"), BAD_JS);
    const config = load(repo);
    const result = lintAcceptanceTests(repo, config, BEHAVIOR);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.rule === "no-product-import")).toBe(
      true,
    );
    expect(result.issues.some((issue) => issue.rule === "step-comment")).toBe(true);
  });

  it("accepts a bound Python scenario test that uses the support module", () => {
    const repo = seedPy();
    writeFileSync(join(repo, "tests/acceptance/test_add.py"), GOOD_PY);
    const config = load(repo);
    expect(lintAcceptanceTests(repo, config, BEHAVIOR).ok).toBe(true);
  });

  it("rejects Python product imports and print spies", () => {
    const repo = seedPy();
    writeFileSync(join(repo, "tests/acceptance/test_add.py"), BAD_PY);
    const config = load(repo);
    const result = lintAcceptanceTests(repo, config, BEHAVIOR);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.rule === "no-product-import")).toBe(
      true,
    );
    expect(result.issues.some((issue) => issue.rule === "no-console-spy")).toBe(true);
    expect(result.issues.some((issue) => issue.rule === "step-comment")).toBe(true);
  });

  it("finds tests by acd-scenario header before slug match", () => {
    const repo = seedJs();
    writeFileSync(
      join(repo, "tests/acceptance/unrelated-name.test.js"),
      GOOD_JS,
    );
    const config = load(repo);
    const scenario = parseScenarios(BEHAVIOR)[0]!;
    expect(findScenarioTests(repo, scenario, config)).toEqual([
      "tests/acceptance/unrelated-name.test.js",
    ]);
  });
});

function load(repo: string) {
  writeFileSync(
    join(repo, "acd.config.yaml"),
    `defaults:\n  harness: stub\nharnesses:\n  stub:\n    driver: stub\n    models: {}\n`,
  );
  return applyCliOverrides(loadRepoConfig(repo), {});
}

function seedJs(): string {
  const repo = mkdtempSync(join(tmpdir(), "acd-accept-lint-js-"));
  mkdirSync(join(repo, "tests/acceptance"), { recursive: true });
  mkdirSync(join(repo, "tests/support"), { recursive: true });
  writeFileSync(
    join(repo, "tests/support/steps.js"),
    "export async function enter() {}\nexport async function press() {}\nexport async function displayShows() {}\n",
  );
  return repo;
}

function seedPy(): string {
  const repo = mkdtempSync(join(tmpdir(), "acd-accept-lint-py-"));
  mkdirSync(join(repo, "tests/acceptance"), { recursive: true });
  mkdirSync(join(repo, "tests/support"), { recursive: true });
  writeFileSync(
    join(repo, "tests/support/steps.py"),
    "def enter(text): ...\ndef press(label): ...\ndef display_shows(text): ...\n",
  );
  writeFileSync(join(repo, "tests/__init__.py"), "");
  writeFileSync(join(repo, "tests/acceptance/__init__.py"), "");
  writeFileSync(join(repo, "tests/support/__init__.py"), "");
  return repo;
}
