import type { AcdConfig, DriverKind } from "../types/config.js";
import { AnthropicDriver } from "./anthropic.js";
import { ClassifierDriver } from "./classifier.js";
import { CursorDriver } from "./cursor.js";
import { StubDriver } from "./stub.js";
import type {
  HarnessDriver,
  HarnessRunRequest,
  HarnessRunResult,
} from "./types.js";
import { resolveInvocation } from "../config/resolve.js";
import type { AgentRole, CliOverrides } from "../types/config.js";
import type { StageName } from "../types/stages.js";

const cache = new Map<DriverKind, HarnessDriver>();

export function getDriver(kind: DriverKind): HarnessDriver {
  let driver = cache.get(kind);
  if (driver) return driver;
  switch (kind) {
    case "stub":
      driver = new StubDriver();
      break;
    case "cursor-sdk":
      driver = new CursorDriver();
      break;
    case "anthropic-api":
      driver = new AnthropicDriver();
      break;
    case "classifier-api":
      driver = new ClassifierDriver();
      break;
    default:
      throw new Error(`Unknown driver '${kind as string}'`);
  }
  cache.set(kind, driver);
  return driver;
}

export async function runHarness(
  config: AcdConfig,
  request: HarnessRunRequest & { harnessName: string },
): Promise<HarnessRunResult> {
  const harness = config.harnesses[request.harnessName];
  if (!harness) throw new Error(`Unknown harness '${request.harnessName}'`);

  if (request.tier === "classify") {
    const profile = config.classifiers[request.modelId];
    if (!profile) {
      throw new Error(
        `Unknown classifier profile '${request.modelId}'. Define it under classifiers.`,
      );
    }
    const driver = getDriver(profile.driver);
    return driver.run({
      ...request,
      modelId: profile.model ?? request.modelId,
      baseUrl: request.baseUrl ?? profile.baseUrl,
      apiKeyEnv: request.apiKeyEnv ?? profile.apiKeyEnv,
    });
  }

  const driver = getDriver(harness.driver);
  return driver.run({
    ...request,
    baseUrl: request.baseUrl ?? harness.baseUrl,
    apiKeyEnv: request.apiKeyEnv ?? harness.apiKeyEnv,
  });
}

/** Resolve role then run with the correct driver (including classifiers.* for classify). */
export async function runResolvedRole(
  config: AcdConfig,
  stage: StageName,
  role: AgentRole,
  request: Omit<
    HarnessRunRequest,
    "modelId" | "tier" | "baseUrl" | "apiKeyEnv"
  >,
  overrides: CliOverrides = {},
): Promise<HarnessRunResult> {
  const invocation = resolveInvocation(config, stage, role, overrides);
  return runHarness(config, {
    ...request,
    harnessName: invocation.harness,
    modelId: invocation.modelId,
    tier: invocation.tier,
    baseUrl: invocation.baseUrl,
    apiKeyEnv: invocation.apiKeyEnv,
  });
}
