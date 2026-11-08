# Breaking the review → revise → implement → review loop

Analysis of work item `20261002T234052-build-a-calculator-web-app` in `../calculator`, plus the ACD code that drives it (`src/stages/review.ts`, `src/spec/revise.ts`, `src/stages/revise.ts`, `src/hooks/mechanical.ts`, the `acd/skills/review-*` prompts). No code was changed. Ideas are ranked from best to worst at the end of this preamble, then written out one by one with an implementation strategy that another model can follow.

---

## What actually happened

| Review round | Findings | Decision |
|---|---|---|
| 1 (Oct 27) | 20 | block |
| 2 (Oct 30, after revise + re-specify + implement) | 33 | block |
| 3 (Oct 30, after revise + implement) | 22 | block |

Only four of the nine reviewers ever produce findings: `test_fidelity`, `implementation_coupling`, `architectural_conformance` and `constraint_compliance`. About 75% of all findings are about tests (16/20, 24/33, 16/22).

### Round 3, classified

I classified every round-3 finding by where it came from:

| Source | Findings | Count |
|---|---|---|
| **Created by revise itself.** These are the templated scenarios 26–29 and the inverted `feature.md` musts. | 0, 1, 2, 3, 13, 14, 15, 17 | 8 |
| **Orphan tests.** These test files belong to scenarios from the first spec that no longer exist: decimal-multiplication, decimal-subtraction, second-operand, decimal-point-entry-via-pointer, repeated-equals, keyboard-parity ×2, pointer-parity ×2. | 4–12 | 9 |
| **Zombie findings.** Revise marked these absorbed in round 1, but the spec change it made was wiped by a later re-specify, so nothing was ever fixed. These are the three input-sanitization findings. | 18, 19, 20 | 3 |
| **Policy, not product.** The Playwright dependency has no team approval, and two agents each raised it. | 16, 21 | 2 |
| **New, legitimate product defects** | none | **0** |

**Round 3 contained no real new problem with the calculator.** Every blocking finding was either produced by the pipeline's own bookkeeping or re-raised a finding that the pipeline could not resolve. The loop is not caused by a picky reviewer. It is structural.

### The review could never have passed anyway

Every round ran the mechanical `lint` hook (`repo.lintCommand: npm run lint`, the kit default). It failed each time with `npm error Missing script: "lint"`. In `review.ts`, `mechanicalBlock = mechanical.some(m => !m.ok)` forces `decision = "block"`. **Even with zero findings, all three reviews would still have blocked.**

### Is revise improving the application? Mostly no

`planRevision()` in `src/spec/revise.ts` is a deterministic text transformer. Its behaviour explains most of the churn.

1. **It pastes the defect description into `feature.md` as a requirement.** `insertBullet(feature, section, "- " + finding.issue)` puts the finding's *issue* text under `## Musts`. `feature.md` now literally says:
   - Must: "After E9 … messages, **digit entry replaces the message and resumes calculation without pressing Clear**." That is the bug. It also contradicts the Must two lines above it ("Clear is the specified recovery control").
   - Must: "**playwright devDependency is present with no recorded team approval**."
   - Must: "Error and out-of-scope outcomes … **update display text only with no structured operational logging**."

   The round-3 `architectural_conformance` reviewer read that last Must literally. It then blocked on the logging the implementer had just added to satisfy the same finding (round-3 #17). The spec now tells the reviewer and the implementer opposite things.
2. **It creates non-behavioural Gherkin.** `scenarioBlock()` always emits:
   ```gherkin
   Given the behavior recorded for this work item
   When the reviewed condition is exercised
   Then the issue does not recur: <defect text>
   ```
   There are no observable steps here. This breaks the kit's own `specify-behavior` rule 4 ("Each Then must be an observable outcome"). The implementer has to invent a test for "the issue does not recur". It produced a test that greps `calculator.js` for `lastOperator`, a test that parses `console.info` JSON, and a meta-test that greps other test files. The reviewers then flagged all of these as implementation coupling (round-3 #2, 3, 13, 14, 15).
3. **It turns policy and process findings into product scenarios.** Scenario 26 ("dependency has no team approval") and Scenario 29 ("no acceptance test covers …") describe the repo, not the calculator. No acceptance test can satisfy them.
4. **It turns implementation details into spec.** Scenario 28's title names `pressEquals()`, `lastOperator` and `lastRightOperand`. Once internal names are in the spec, coupled tests follow.
5. **It removed a feature without a human deciding to.** The first spec, approved by you, had "Repeated equals repeats the last operation". After the re-specify dropped it, the reviewer flagged the still-working code as unspecified. Revise then made it a Must-not, and the implementer deleted working behaviour that most calculators have. Removing a feature should be a human decision, not a side effect of a finding.
6. **It has no notion of importance.** Every finding inherits the agent's `block` decision, so "enter('ab') on an internal function isn't sanitised" (input that can't be reached through the UI) weighs the same as "digits silently overwrite an error message".
7. **Its "absorbed" ledger drifts from the artifacts.** `absorbedReviewFindings` is append-only, and a key is `sha256(agent, file, line, issue)`.
   - Round-1 revise absorbed all 20 findings. The next step, `specify --artifact all` (event 38), regenerated the artifacts and deleted the revise markers and added scenarios. The keys stayed "absorbed", so `applied(key)` returns true and revise skips those findings forever, while review keeps raising them. The sanitization findings have the same key in all three rounds and have never been fixed.
   - The key includes the line number and the exact wording. The same issue moving from `calculator.js:65` to `:72` gets a new key and would become a duplicate scenario. Playwright approval already appears twice in round 3 under two agents.
8. **Unmapped findings disappear.** Round-2 revise reported `unmapped: 5`. These were coupling findings on orphan test files. Nothing happens to them, so they come back every round.

What revise did get right: reopening scenarios in "fidelity" mode moved most acceptance tests from `createCalculator()` calls to real browser tests. Scenarios 24 and 25 (error-state lockout for digits and decimal point) were real UX fixes, as was overflow handling from round 1. **Over two revise cycles there were about three genuine product improvements, one harmful change (console JSON logging in a static page), one feature removal, and three noise scenarios.**

### Your two hypotheses

- **"Designate some issues as not important."** Partly right. We need severity and an auditable waiver. But if we only did that, we would be hiding the structural causes above (lint, ledger drift, orphan tests, inverted spec), and the next work item would loop the same way. Ideas 5 and 8 cover this properly.
- **"Improve our test writing."** Right, but the cause is less "bad tests" and more "no test architecture":
  - The first implement wrote model-level tests (`createCalculator().pressAdd()`) for scenarios whose Background says "the calculator is open in the browser".
  - After that, tests were never reconciled when the spec changed. Round 2 flagged "Scenario 3 uses 100 − 23 instead of 20 − 8". The test was faithful to the *old* spec, but the re-specify changed the example and nobody updated the test.

  Ideas 4 and 6 cover this.

### Review cost so far

Each review round cost about $1.50–$3.30 in agent calls, and there were three full rounds plus two that failed.

---

## Ranking (best → worst)

| # | Idea | Effort | Why this rank |
|---|---|---|---|
| 1 | Make "pass" reachable: a missing lint script must not block | XS | Without this, nothing else matters. Review cannot pass today. |
| 2 | Revise must write real requirements, not paste defects | M | Removes about 40% of round-3 findings and stops the spec from contradicting itself. |
| 3 | Review cycle ≥ 2 is a verification pass on the delta, not a fresh audit | M | Makes convergence monotone, which is the actual "pass on round 2" mechanism. |
| 4 | Acceptance test architecture: shared browser step library plus a deterministic test lint | M | Root fix for most test findings. Moves checks from LLM opinion to rules. |
| 5 | Structured findings: severity, category, scenario, evidence | S–M | Enables 2, 3 and 8 deterministically and makes "not important" principled. |
| 6 | Reconcile tests with scenarios: explicit binding plus orphan cleanup | S | Removes about 40% of round-3 findings. |
| 7 | Repair the absorbed-findings ledger | S | Kills zombie findings and duplicate scenarios. |
| 8 | Human waivers and a cycle budget with escalation | S | A safety valve that keeps HitL in charge and auditable. |
| 9 | Tailor system constraints per project and add an approvals record | S | Stops generic web-service constraints from generating unfixable findings. |
| 10 | Stronger reviewer prompts with rubrics and evidence | S | Cheap precision gain, but LLM-dependent, so weaker than structural fixes. |
| 11 | Re-specify must amend, not regenerate (stable E-IDs) | M | Prevents spec churn from invalidating tests and markers. |
| 12 | Post-revise spec consistency gate | S | A safety net. Mostly redundant once idea 2 lands. |
| 13 | Merge or trim overlapping reviewers | XS | Small dedup win, with a risk of losing coverage. |
| 14 | Lower the bar: only `security` / `semantic` block | XS | Breaks the loop but throws away the value of review. Last resort. |

---

## 1. Make "pass" reachable: a missing lint script must not block

**Problem.** `runMechanicalHooks()` runs `npm run lint` (the kit default). The calculator has no `lint` script, so the hook fails every round and `review.ts` forces `block`. The review can never pass.

**Proposal.** Treat "command not configured / script missing" differently from "command ran and found problems".

**Implementation.**
1. In `src/hooks/mechanical.ts`, `runMechanicalHooks()`: before running an `npm run <script>` command, read `package.json` from `repoRoot`. If the script doesn't exist, push `{ name, ok: true, skipped: true, detail: "script <x> not defined; skipped" }`. Add `skipped?: boolean` to `MechanicalResult`.
2. Alternatively, also change the kit default in `acd/config/acd.config.default.yaml` to comment out `lintCommand`, the same way `typecheckCommand` already is. Then `acd init` asks whether to set it.
3. In `review.ts`, `mechanicalBlock` should consider only results that are `!ok && !skipped`.
4. Surface skipped hooks in the UI and CLI as a warning, not a block.
5. Tests: a unit test for `runMechanicalHooks` with a temp repo whose `package.json` has no `lint` script expects `ok: true, skipped: true`. A review-stage test with zero findings and a skipped lint expects `decision: "pass"`.

**Expected effect.** Review can pass once findings are zero. This is required before any other idea can show up as a green review.

---

## 2. Revise must write real requirements, not paste defects

**Problem.** See points 1–5 of the revise critique above. Revise turns defect text into Musts (inverting meaning), emits templated non-observable Gherkin, and converts policy and implementation-detail findings into product scenarios. In round 3 it caused 8 of 22 findings directly, plus the self-contradictory `feature.md`.

**Proposal.** Split revise into a deterministic router plus one generative drafting step for the cases that truly need new behaviour. Never write `finding.issue` into an artifact.

Routing rules, deterministic, based on the finding's `category` field from idea 5 or on the agent as a fallback:

| Finding category | Action | Spec change? |
|---|---|---|
| `test` (fidelity / coupling on a mapped scenario) | Reopen that scenario in `fidelity` mode (as today) | No |
| `test` on an unmapped or orphan file | Queue `cleanup` job (idea 6) | No |
| `product` (observable behaviour wrong or missing) | Draft a new scenario plus Must with the `revise-behavior` skill; HitL approves | Yes, in positive, observable form |
| `code` (internal quality, not user-observable, e.g. sanitising an internal function) | Queue a `fix` job against existing scenarios; tests must stay green | No |
| `policy` (dependency approval, logging policy, coverage process) | Record as `awaitingGuidance` with a decision prompt (approve / waive / change constraint) | No |
| Removes or contradicts previously approved behaviour | `awaitingGuidance`. A human decides. | Only after the decision |

**Implementation.**
1. New skill `acd/skills/revise-behavior/SKILL.md`. Input: the product findings, current `behavior.feature`, `feature.md` and `intent.md`. Output JSON:
   ```json
   { "scenarios": [{ "label": "E15", "title": "...", "gherkin": "Scenario: E15. ...\n  When I ...\n  Then the display shows ...", "findingKeys": ["..."] }],
     "musts": [{ "section": "must|must-not", "text": "...", "findingKeys": ["..."] }],
     "rejected": [{ "findingKey": "...", "reason": "conflicts with approved E8 / not user-observable / ..." }] }
   ```
   Rules in the skill:
   - Write requirements as the *desired* behaviour.
   - Every `When` and `Then` uses only UI vocabulary (enter, press, display shows, can see).
   - No function, variable or file names.
   - Reuse existing Background steps.
   - Never write "the issue does not recur".
2. In `src/spec/revise.ts`:
   - Delete `scenarioBlock()`'s template and the `insertBullet(feature, …, finding.issue)` path.
   - `planRevision()` becomes pure routing and returns `{ fidelityJobs, fixJobs, cleanupJobs, behaviorDrafts: ReviewFinding[], policyQuestions: ReviewFinding[] }`.
   - `src/stages/revise.ts` calls the `revise-behavior` role only when `behaviorDrafts.length > 0`, then validates its output deterministically:
     - It parses with `parseScenarios`.
     - No `Then` contains `/does not recur|issue/i`.
     - No `When`/`Then` contains an identifier pattern `/\w+\(\)|\b[a-z]+[A-Z]\w+\b/`.
     - Each scenario's `Then` contains an observable noun (reuse the existing `OBSERVABLE` regex).
3. Add `ImplementJob.mode` values `"fix"` and `"cleanup"`, and handle them in `src/stages/implement.ts`. A `fix` job uses the brief plus the existing scenario tests, which must still pass. A `cleanup` job deletes or relocates files and has no product change.
4. Policy findings set `state.awaitingGuidance = "review"` with a generated question. They go through the existing amend/guidance mechanism (`src/orchestrator/guidance.ts`).
5. Keep markers: inserted scenarios and musts still carry `<!-- acd-review:<key> -->` so the ledger (idea 7) can reconcile.
6. Tests in `test/spec/revise.test.ts`:
   - Feed round-2's 33 findings (copy them from the calculator's `events.jsonl` into a fixture).
   - Assert there are no scenarios with the template text and no Musts containing finding text.
   - Assert Playwright approval becomes a policy question, sanitization becomes a `fix` job, repeated-equals removal becomes a guidance question, and the error-lockout finding becomes a `behaviorDraft`.

**Expected effect.** In this session this would have prevented scenarios 26–29 and their tests (8 round-3 findings), the inverted Musts, and the unilateral removal of repeated-equals. Spec changes would actually describe a better calculator.

**Respecting `AGENTS.md`.** The *routing* stays deterministic. An LLM only drafts text, the same way `specify` already does, and never picks the next stage.

---

## 3. Review cycle ≥ 2 is a verification pass on the delta, not a fresh audit

**Problem.** Each review is a full re-audit. The calculator repo is trunk-only (`main`, no `origin`) with a clean working tree, so `gitDiff()` returns `""`. Its fallback is `git diff main...HEAD`, which is empty on `main`. The reviewers effectively audit everything they can see, every time. New findings appear on untouched code in every round, so the finding count can't converge. Note also that `previousFindings` is passed in only as context. Nothing requires the reviewer to say whether each one was resolved.

**Proposal.**
- Round 1 is a full review against the work item's base commit.
- Round N ≥ 2 does two things:
  - It *verifies* each previous blocking finding: resolved, still present, or no longer applicable.
  - It *reviews only code changed since the previous review*.

  New findings on lines that didn't change since the last review are recorded as `advisory`, not `block`. A finding is allowed to block in round N only if it is (a) an unresolved previous blocker or (b) located in the diff since the last review.

**Implementation.**
1. At intake (`src/stages/intake.ts`) record `state.baseSha = git rev-parse HEAD`. At each `review.complete`, record `reviewSha` in the event data.
2. Replace `gitDiff()` usage in `review.ts` with `gitDiffRange(repoRoot, from, "HEAD")`:
   - `from` is `baseSha` in cycle 1 and the previous `reviewSha` afterwards.
   - Also pass `changedFiles` and `changedLineRanges`, parsed from `git diff -U0 from..HEAD`.
   - If the range is empty, review the work item's full range `baseSha..HEAD` and say so.
3. Split each reviewer call in cycle ≥ 2 into two inputs: `verify: previousFindings[]` (expect `{ key, status: "resolved"|"present"|"not_applicable", evidence }`) and `diff`. Update `REVIEW_JSON_SHAPE` and the zod schema to accept an optional `verifications` array.
4. Deterministic gate after parsing:
   ```ts
   const blocking = findings.filter(f =>
     f.severity !== "minor" &&
     (cycle === 1 || inChangedLines(f, changedLineRanges) || isUnresolvedPrior(f, verifications)));
   ```
   Everything else gets `decision: "advisory"`. It is still shown and still feeds revise as notes, but it doesn't block.
5. `computeReviewDelta()` already exists. Use the reviewer's verifications as the primary signal and keep the fuzzy match as a fallback.
6. Tests: a fixture repo with two commits. Cycle 2 only flags lines touched in commit 2, and a finding on an untouched line becomes advisory.

**Expected effect.** This is the direct mechanism for "one review finds legitimate issues, the fix lands, the second review passes". Round 2 can only block on things the fix broke or failed to fix. Combined with idea 1, round 2 passes whenever the fixes are faithful.

**Risk.** A serious issue missed in round 1 could become advisory in round 2. Mitigations: severity `blocker` findings from `security`/`semantic` always block regardless of location, and advisories are listed prominently for the human approving the review.

---

## 4. Acceptance test architecture: shared browser step library plus a deterministic test lint

**Problem.** Test findings are about 75% of all findings. The recurring complaints are the same handful: acceptance tests that call `createCalculator()` instead of the page, Background `"0"` not asserted, raw HTML regex checks, source-file greps, and console-log parsing. Every implement session invents its own helpers (`pressControl`, `displayText`, `clickOnScreenControl`, `pageHasOnScreenButton`), so quality varies by session. The `implement-scenario` skill says "write the acceptance test first" but never says *what an acceptance test is* in this repo.

**Proposal.** Give the implementer a test architecture before scenario 1, and enforce its rules mechanically instead of by LLM review.

**Implementation.**
1. **New `acd` stage step or one-off job: "scaffold acceptance harness".** It runs once per work item, before the first scenario, as `ImplementJob { mode: "harness" }`, or as part of `specify` approval. The implementer creates `tests/support/steps.js` (the language follows the repo). It contains one helper per Gherkin step phrase in `behavior.feature`, implemented against the real UI:
   - `openApp()`, `enter(text)`, `press(label)`, `displayShows(text)`, `canSee(label)`
   - Helpers locate elements by accessible role and name (`getByRole('button', { name: '+' })`, `getByRole('status')`), not by regex over HTML.
   - The Background is a shared `beforeEach` that asserts the initial state, so every scenario gets it for free.
2. **Update `acd/skills/implement-scenario/SKILL.md`** with a "What an acceptance test is" section:
   - One test file per scenario, starting with `// acd-scenario: <label>` (also used by idea 6).
   - Each Gherkin line appears as a comment followed by exactly one step-helper call.
   - Acceptance tests **must not** import production modules, read source files, spy on console, or assert on internal state. Unit tests go in `tests/unit/` and are not acceptance evidence.
   - If a step phrase has no helper yet, add one to `tests/support/steps.js`. Do not inline browser code in the test.
3. **Deterministic acceptance lint.** New `src/spec/acceptance-lint.ts`, run in implement (after the test run) and as a mechanical review hook, returning `MechanicalResult`. It checks every file under `tests/acceptance/`:
   - It has an `acd-scenario:` header whose label exists in `behavior.feature`.
   - It has no import of non-test project files (`../../calculator.js`).
   - It has no `readFileSync` on non-test paths and no `console` spying.
   - Every `When`/`Then` line of its scenario appears as a comment, in order, with case and whitespace normalised.

   On failure, implement returns to the same session with the lint output, exactly like a failing test. Review then sees zero of these issues because they can't merge.
4. **Narrow the LLM reviewers.** In `acd/skills/review-test-fidelity/SKILL.md` and `review-implementation-coupling/SKILL.md`, state that structural rules are enforced by the acceptance lint. The reviewer should only judge whether step helpers *really* perform what their phrase says, and whether assertions are as strict as the Then. Reviewing `tests/support/steps.js` once covers all scenarios.
5. **Optional, stronger variant: executable Gherkin.** Use `@cucumber/cucumber` so `behavior.feature` is the test and step definitions are the only code. Fidelity then becomes structural: a scenario whose step has no definition fails as "undefined step". This needs dependency approval (see idea 9), so offer it as an `acd init` option rather than the default.
6. Tests for ACD: unit tests for `acceptance-lint.ts` against fixture test files. Copy a few of the calculator's real files as good and bad examples, e.g. `decimal-multiplication.test.js` should fail and `add-two-whole-numbers.test.js` should pass.

**Expected effect.** Round-1 findings 0–15 and round-2 findings 1, 3, 4, 6, 11–13 and 18–23 become impossible to merge, so they never reach review. One reviewed step library replaces 29 hand-rolled ones. This is the "improve our test writing capabilities" idea in a form that compounds: the harness is reused across scenarios and work items.

---

## 5. Structured findings: severity, category, scenario, evidence

**Problem.** A finding is `{ file, line, issue, why }`, and its block/pass comes from the *agent's overall* decision. Revise has to guess what kind of finding it is from the agent name and regexes (`OBSERVABLE`, `MUST_NOT`, `SCENARIO_REF`). That guessing is where most of the mis-routing in idea 2 comes from, and there is no way to say "this one matters less".

**Proposal.** Reviewers emit per-finding structure, and the CLI decides everything from it deterministically.

**Implementation.**
1. Extend the finding schema in `review.ts` (`reviewAgentSchema`), `src/types/work.ts` (`ReviewFinding`) and `src/schemas/zod.ts`:
   ```ts
   severity: "blocker" | "major" | "minor";
   category: "test" | "product" | "code" | "policy";
   scenario: string | null;      // E-label or null
   evidence: { spec?: string; code?: string };  // quoted Gherkin line / quoted code line
   ```
   Defaults for backward compatibility: `severity: "major"`, `category` derived from the agent as in `classify()` today.
2. Put a shared rubric in every `review-*` skill (one included markdown file, e.g. `acd/skills/_review-rubric.md`, concatenated by `loadSkill`):
   - **blocker**: user-visible wrong result or crash; a Then not asserted at all; a real security exposure reachable from the UI or network.
   - **major**: a Then asserted weakly; a feature Must violated in reachable code.
   - **minor**: hypothetical refactor fragility; validation on internal-only APIs; style; anything without a concrete failure scenario a user could hit.
   - A finding without `evidence.spec` (for test/product) or `evidence.code` is downgraded to `minor` deterministically.
3. Only `blocker` and `major` count toward `decision = "block"`, computed in `review.ts` from findings, not taken from the agent's top-level decision. Keep a config knob `stages.review.block_on: [blocker, major]`.
4. Revise (idea 2) routes on `category`, maps on `scenario` (no more `SCENARIO_REF` regex), and turns `minor` findings into notes only.
5. The UI (`web/`) shows severity badges and groups findings by category.
6. Tests: schema defaults; a minor-only review returns `pass`; a finding with no evidence is downgraded.

**Expected effect.** This makes "not important" a rule rather than a mood. In round 3, the sanitization findings on `enter('ab')` (input that can't be reached from the UI buttons) would be `minor` under the rubric. Playwright approval would be routed as `policy`.

---

## 6. Reconcile tests with scenarios: explicit binding plus orphan cleanup

**Problem.** There are 35 test files for 29 scenarios. The first spec had 18 scenarios with different titles and examples. After re-specify, files like `decimal-multiplication.test.js`, `keyboard-parity-…test.js` and `repeated-equals-repeats-the-last-operation.test.js` map to no scenario. Some still use `createCalculator()`. `repeated-equals-repeats-the-last-operation.test.js` now asserts that equals does *not* repeat, while keeping its old name. Reviewers flag these 7 files every round (9 of 22 findings in round 3). The reverse also happens: the real tests for Scenarios 10 and 7 live in `clear-resets-the-current-entry-and-pending-operation.test.js` and `decimal-addition.test.js`, whose names match no current title. Revise reports them as `unmapped` and does nothing. The test ↔ scenario binding is a fuzzy slug match of filename to title (`slugsMatch` in `src/spec/scenario-tests.ts`), which breaks whenever a title changes.

**Proposal.** Bind tests to scenario labels explicitly, and treat unbound acceptance tests as a pipeline condition that must be resolved.

**Implementation.**
1. Binding: `findScenarioTests()` first looks for a header `acd-scenario: <label>` (from idea 4) in files under `tests/acceptance/`. The slug match stays only as a fallback for legacy files.
2. New function `findOrphanTests(repoRoot, scenarios)` in `scenario-tests.ts` returns acceptance test files bound to no current scenario.
3. Call it:
   - (a) at the end of `specify` after artifacts change, listing orphans in the output for the human approving the spec, with a per-file choice: delete, rebind to E-x, or keep as a unit test by moving it to `tests/unit/`;
   - (b) at the start of `review`, which passes only bound acceptance tests to `test_fidelity`/`implementation_coupling` and adds a mechanical `orphan-tests` result listing the rest.
4. Revise turns `unmapped` test findings into a single `cleanup` job instead of dropping them.
5. Tests: a fixture with a renamed scenario expects the old file to be reported as an orphan, and its review findings to be routed to cleanup.

**Expected effect.** It removes the 9 orphan findings in round 3, and spec changes can no longer leave stale tests behind for reviewers to flag forever.

---

## 7. Repair the absorbed-findings ledger

**Problem.** `absorbedReviewFindings` is append-only and is never checked against the artifacts. Round 1's keys were absorbed, then `specify --artifact all` wiped their markers and scenarios. Revise now skips those findings forever (`applied(key)` is true), while review keeps raising them: the sanitization findings (`b7c958fcd092`, `ec85365ae222`) appear in all three rounds. Meanwhile, keys include line numbers and exact wording, so the same issue at a new line becomes "new" (`aa79f169ef8f` → `21b4389ace60` for `pressDecimal`). The same issue from two agents also becomes two scenarios (Playwright, round 3).

**Proposal.** A finding counts as handled only if there is evidence it was handled. Identity should be stable across rounds and agents.

**Implementation.**
1. Change `findingKey()` in `src/spec/revise.ts` to hash `category + file + scenario + normalizedIssue`, without `line` or `agent`. `normalizedIssue` is lower-cased, has digits and punctuation removed, and has its first 12 significant tokens sorted. Alternatively, keep exact keys but dedupe with `isSameFinding()` from `review-delta.ts` before routing, and extend that function to ignore `agent` when `file` and issue tokens match.
2. Replace the append-only list with a record:
   ```ts
   absorbed: Record<key, { at: string; route: "fidelity"|"fix"|"behavior"|"policy"|"note"|"waived"; jobIndex?: number; marker?: boolean }>
   ```
3. At the start of every revise (and after every `specify`), reconcile:
   - If `route` is `behavior` and the marker `acd-review:<key>` is no longer in the artifacts, un-absorb the key.
   - If `route` is `fidelity`/`fix` and the job's scenario no longer exists, un-absorb it.
4. **Persistence escalation.** In review cycle ≥ 2, if a finding matches an absorbed key whose job has completed, it is "persistent after fix". Do not reroute it a second time. Set `awaitingGuidance` with the finding and the session summary of the job that should have fixed it, so the human chooses: waive, rewrite the brief, or change the spec.
5. Write a state migration for existing work items (`src/work/store.ts` `readState`) that converts `string[]` into the record with `route: "note"` and `marker: false`, so reconciliation re-opens them.
6. Tests: absorb, wipe the marker, re-run revise, and expect the finding to be routed again. Two agents raising the same issue produce one job. A finding persisting after its job ran sets `awaitingGuidance`.

**Expected effect.** It eliminates the zombie findings (3 in every round) and duplicate scenarios. Any finding that can't be fixed is escalated after one attempt instead of looping.

---

## 8. Human waivers and a cycle budget with escalation

**Problem.** There is no way to say "accepted risk / not worth fixing" for a specific finding, and nothing stops the loop. Reviewers are also told about `previousFindings` but not which were consciously accepted, so they re-raise them.

**Proposal.** An auditable waiver command plus a hard cycle budget. Both are HitL configuration, consistent with "HitL is configuration".

**Implementation.**
1. CLI `acd waive <workId> <findingKey...> --reason "<text>"` (and a UI button per finding). It emits a `review.waived` event `{ keys, reason, actor: gitIdentity() }` and records `route: "waived"` in the ledger from idea 7. Agents cannot call it: the command rejects input when it detects a harness environment variable, or the approach mirrors how approval is already guarded.
2. `review.ts` passes `waived: [{ issue, file, reason }]` to each reviewer. The prompt says not to re-raise these, and a deterministic post-filter drops any finding matching a waived one by `isSameFinding()`.
3. Config `stages.review.max_cycles` (default 2). When `cycle > max_cycles` and the decision is `block`, the stage ends in `awaitingGuidance` instead of `awaitingApproval`. The guidance payload is a triage table: each blocker with "fix / waive / change spec". Revise refuses to auto-run past the budget.
4. The UI shows the waived count and reasons on the review card so they're visible at PR time. Include waivers in the PR body (`src/stages/pr.ts`).
5. Tests: a waived finding re-raised by a stub reviewer is filtered out. Cycle 3 with blockers sets `awaitingGuidance`.

**Expected effect.** This is your "designate as not important" idea, made explicit, attributable and visible in the PR. It also guarantees the loop ends with a human decision rather than running forever. It ranks below ideas 1–7 because it treats symptoms. Without them you would be waiving the same structural noise on every work item.

---

## 9. Tailor system constraints per project and add an approvals record

**Problem.** The calculator inherits generic web-service constraints (`.acd/system-constraints.yaml`): API p99 latency, N+1 queries, auth on API endpoints, "Log structured data", "All new dependencies require team approval". `constraint_compliance` applies them literally to a static HTML page:
- It demanded structured logging, so the implementer added `console.info(JSON…)` to a calculator, which the inverted Must then flagged.
- It demanded team approval for Playwright, but approval can't be recorded anywhere, so the finding can never be resolved. The implementer correctly escalated in session 026, and nothing consumed the escalation.

**Proposal.** Constraints should be confirmed as applicable to the project, and approvals should have a home.

**Implementation.**
1. Allow `applies: false` and `reason:` per constraint, or a `not_applicable:` list in `system-constraints.yaml`. During `acd init` (or a new `acd constraints` command), an LLM drafts applicability for the detected project type and the human confirms it. Agents only draft, consistent with existing rules.
2. Add `.acd/approvals.yaml`:
   ```yaml
   dependencies:
     - name: playwright
       scope: devDependency
       approved_by: timothy
       at: 2026-11-06
       reason: browser acceptance tests
   ```
   Add CLI `acd approve-dependency <name> --reason`, human only, same guard as `acd waive`.
3. `review.ts` passes `approvals` to `constraint_compliance` and `architectural_conformance`. A deterministic filter drops dependency-approval findings for approved names.
4. When implement escalates on a policy trigger (concern starts with `CONCERN: Escal…`), set `awaitingGuidance` with a "approve dependency X?" prompt instead of continuing the queue.
5. Tests: an approved dependency yields no finding, and a constraint marked not-applicable is not sent to the reviewer.

**Expected effect.** It removes the 2 Playwright findings and the logging churn in round 3 and stops a class of findings that no code change can ever fix.

---

## 10. Stronger reviewer prompts with rubrics and evidence

**Problem.** The review skills are 8–12 lines. `review-test-fidelity` says "For each Given/When/Then, find a corresponding assertion" and nothing else: no scope, no false-positive guidance, no instruction about scenarios that no longer exist, and no requirement to quote evidence. All nine run on `composer-2` (med tier).

**Proposal.** Precise, scoped prompts with an evidence requirement and explicit "do not flag" lists.

**Implementation.**
1. Rewrite each `acd/skills/review-*/SKILL.md` with these sections:
   - **Scope**: the diff range from idea 3 and the bound tests from idea 6.
   - **Must flag**, with 2–3 concrete examples from this session.
   - **Must not flag**:
     - tests of scenarios not in `behavior.feature`;
     - waived or approved items;
     - issues outside the diff in cycle ≥ 2 (report those as advisory);
     - hypothetical refactors with no user-visible failure, which are minor at most.
   - **Evidence**: quote the Gherkin line and the code line, or the finding is invalid.
   - **Severity rubric** (shared, idea 5).
2. Make `test_fidelity` the sole owner of "Then not asserted" and `implementation_coupling` the sole owner of "test depends on internals", and say so in both prompts to reduce double-reporting.
3. Consider running `test_fidelity` and `architectural_conformance` on the `high` tier. They are the decisive reviewers, and precision matters more than cost here.
4. Evaluate: replay rounds 2 and 3 from `events.jsonl` (diffs reconstructable from the calculator's git history), then compare finding counts and false positives before and after.

**Expected effect.** Fewer and sharper findings. It ranks here because it relies on model compliance. The structural ideas above make it far less important.

---

## 11. Re-specify must amend, not regenerate (stable E-IDs)

**Problem.** After round-1 revise, `specify --artifact all` ran (event 38). It rewrote all four artifacts, renumbered scenarios (feature-doc mappings to Scenario 12/13/14 were wrong, see event 39's guidance), changed worked examples (subtract 100 − 23 became 20 − 8), dropped approved scenarios (keyboard parity, repeated equals), and wiped revise markers. That single run created most of round 2's 33 findings. Also, `feature.md` mandates E-ID references, but `behavior.feature` uses ordinal labels ("Scenario: 3."), so indices shift whenever scenarios are inserted.

**Proposal.** Once implementation exists, specify should edit, not regenerate.

**Implementation.**
1. If `completedStages` includes `implement`, `specify` defaults to `--mode amend`. The specify skills receive the current artifacts and must return a patch-like result: added, changed or removed scenarios by label, each with a reason. Removals and example changes are listed for human approval.
2. Validate deterministically that existing labels and `acd-review:` markers are preserved unless explicitly removed.
3. Enforce `specify-behavior` rule 2 (E-IDs on headings) in `src/spec/gherkin.ts` validation, so that ordinal labels fail `specify.validated`.
4. When a scenario's steps change, queue a `fidelity` job for it automatically. Today, the tests of changed scenarios are silently left behind.
5. Tests: amending one scenario leaves the others byte-identical, and a changed scenario produces a fidelity job.

**Expected effect.** It prevents the round-1 → round-2 explosion (20 → 33). It ranks lower only because the current session has already absorbed that damage. For future work items it is important.

---

## 12. Post-revise spec consistency gate

**Problem.** After revise, `feature.md` contains direct contradictions. Clear is the only recovery path, yet digit entry is required to resume without Clear. Implement ran anyway.

**Proposal.** Run the existing `validate-spec` / `criteria-gate` skills on revised artifacts before releasing the implement queue.

**Implementation.**
1. At the end of `reviseFromLatestReview()`, if any artifact changed, run the `validate-spec` role on the four artifacts. On contradiction, set `awaitingGuidance` (reusing the `max_repair_loops` repair path from `specify`) instead of clearing `awaitingApproval`.
2. Add a cheap deterministic pre-check: any Must or Then containing text identical to a review finding's `issue` fails validation. This guards against regressions of idea 2.

**Expected effect.** A safety net. Once idea 2 lands it should rarely fire, which is why it ranks low.

---

## 13. Merge or trim overlapping reviewers

**Problem.** Of nine reviewers, five produced zero findings in three rounds (semantic, security, performance, concurrency, intent), and still cost money. `test_fidelity` and `implementation_coupling` overlap heavily: round 2 has the same files flagged by both. `architectural_conformance` and `constraint_compliance` both raised Playwright.

**Proposal.** Make the fan-out configurable per project, and dedupe across agents.

**Implementation.**
1. Add `stages.review.agents: [...]` in config, defaulting to all. `REVIEW_FANOUT` is filtered by it. For a static front-end, `performance`/`concurrency` could be off.
2. Cross-agent dedupe after aggregation in `review.ts`: same file plus `isSameFinding` ignoring `agent` → keep one and list both agents.

**Expected effect.** Fewer duplicates and lower cost. The convergence gain is small, and turning reviewers off risks missing real issues on other projects, hence the low rank.

---

## 14. Lower the bar: only `security` / `semantic` findings block

**Problem / proposal.** The bluntest fix: treat test-quality and constraint findings as advisory across the board.

**Implementation.** Config `stages.review.blocking_agents: [security, semantic]`, applied in `review.ts` when computing `decision`.

**Why it's last.** It would "pass" this session immediately, but it discards the reviews that did find real bugs here (overflow showing `Infinity`, digits overwriting error messages, the decimal point appending to error text). Those all came from `architectural_conformance`. It also does nothing about the pipeline creating its own findings. Use it only as a temporary override while ideas 1–7 are built.

---

## Appendix: getting the current calculator session to green with minimal new churn

This is a suggested order, not a change I made:

1. Add a `lint` script to `../calculator/package.json` (even `"lint": "node --check calculator.js"`), or unset `lintCommand` in `.acd/acd.config.local.yaml`. This is idea 1, done by hand.
2. Fix `feature.md` by hand:
   - Delete the five inverted bullets under Musts (markers `b97bcf452d08`, `96ec00fc35db`, `bdd308a0324c`, `a5b4b7ea8706`, `cb533c00d778`).
   - Replace them with positive Musts: "After E9/E11/E14 messages, digits and the decimal point leave the message unchanged until Clear."
   - Decide on repeated-equals and logging yourself.
3. Replace Scenarios 24 and 25 in `behavior.feature` with real Gherkin. For example: When I enter "5", press "÷", enter "0", press "=", then press "3", Then the display still shows the divide-by-zero message. Delete Scenarios 26–29.
4. Delete the 7 orphan tests, which are the only acceptance files that don't import Playwright: decimal-multiplication, decimal-subtraction, second-operand-after-an-operator, decimal-point-entry-via-pointer, repeated-equals-repeats-the-last-operation, keyboard-parity, and pointer-parity. Keep `clear-resets-the-current-entry-and-pending-operation.test.js` and `decimal-addition.test.js`. Despite their old names, they now hold the real tests for Scenarios 10 and 7, which shows why idea 6's explicit binding is needed. Also delete the meta and grep tests (`clear-recovery-scenarios-have-acceptance-tests`, `press-equals-does-not-implement-repeated-equals`, `error-and-out-of-scope-outcomes-emit-structured-operational-logs`), and remove the `console.info` logging if you decide logging is not applicable.
5. Record the Playwright approval somewhere the reviewer is told about, or mark the dependency constraint not-applicable.
6. Decide on input sanitization. Cheapest: restrict `enterDigit` to `/^[0-9]$/` as a one-off `acd fix`-style change, since it's a two-line guard.
7. Run review once more. If the remaining findings are only coupling opinions on tests that already drive the browser, that's the signal that ideas 3, 5 and 8 are needed in the kit.
