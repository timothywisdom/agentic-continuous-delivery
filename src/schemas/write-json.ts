import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchemaLite } from "./json-schema-lite.js";
import {
  acdConfigSchema,
  ciReviewOutputSchema,
  fixOutputSchema,
  gateDecisionSchema,
  implementOutputSchema,
  intakeOutputSchema,
  prOutputSchema,
  reviewOutputSchema,
  specifyOutputSchema,
  workEventSchema,
  workStateSchema,
} from "./zod.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "../../acd/schemas");

const schemas: Record<string, unknown> = {
  "acd-config.schema.json": zodToJsonSchemaLite(acdConfigSchema, "AcdConfig"),
  "work-state.schema.json": zodToJsonSchemaLite(workStateSchema, "WorkState"),
  "event.schema.json": zodToJsonSchemaLite(workEventSchema, "WorkEvent"),
  "gate-decision.schema.json": zodToJsonSchemaLite(
    gateDecisionSchema,
    "GateDecision",
  ),
  "intake-output.schema.json": zodToJsonSchemaLite(
    intakeOutputSchema,
    "IntakeOutput",
  ),
  "specify-output.schema.json": zodToJsonSchemaLite(
    specifyOutputSchema,
    "SpecifyOutput",
  ),
  "implement-output.schema.json": zodToJsonSchemaLite(
    implementOutputSchema,
    "ImplementOutput",
  ),
  "review-output.schema.json": zodToJsonSchemaLite(
    reviewOutputSchema,
    "ReviewOutput",
  ),
  "pr-output.schema.json": zodToJsonSchemaLite(prOutputSchema, "PrOutput"),
  "ci-review-output.schema.json": zodToJsonSchemaLite(
    ciReviewOutputSchema,
    "CiReviewOutput",
  ),
  "fix-output.schema.json": zodToJsonSchemaLite(fixOutputSchema, "FixOutput"),
};

export function writeKitJsonSchemas(targetDir = outDir): void {
  mkdirSync(targetDir, { recursive: true });
  for (const [name, schema] of Object.entries(schemas)) {
    writeFileSync(join(targetDir, name), JSON.stringify(schema, null, 2) + "\n");
  }
}
