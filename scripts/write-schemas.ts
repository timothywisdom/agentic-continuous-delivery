#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeKitJsonSchemas } from "../src/schemas/write-json.js";

writeKitJsonSchemas(join(dirname(fileURLToPath(import.meta.url)), "../acd/schemas"));
