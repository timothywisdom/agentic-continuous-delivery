import type { ZodTypeAny } from "zod";

/** Minimal Zod → JSON Schema so kit schemas ship without extra deps. */
export function zodToJsonSchemaLite(
  schema: ZodTypeAny,
  title: string,
): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title,
    ...walk(schema),
  };
}

function walk(schema: ZodTypeAny): Record<string, unknown> {
  const def = schema._def as { typeName?: string; innerType?: ZodTypeAny };
  const typeName = def.typeName ?? "";

  switch (typeName) {
    case "ZodObject": {
      const shape = (schema as unknown as { shape: Record<string, ZodTypeAny> })
        .shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = walk(value);
        if (!isOptional(value)) required.push(key);
      }
      return {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      };
    }
    case "ZodString":
      return { type: "string" };
    case "ZodNumber":
      return { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodArray": {
      const inner = (schema as unknown as { element: ZodTypeAny }).element;
      return { type: "array", items: walk(inner) };
    }
    case "ZodEnum": {
      const values = (schema as unknown as { options: string[] }).options;
      return { type: "string", enum: values };
    }
    case "ZodOptional":
      return walk(def.innerType as ZodTypeAny);
    case "ZodDefault":
      return walk(def.innerType as ZodTypeAny);
    case "ZodNullable":
      return { anyOf: [walk(def.innerType as ZodTypeAny), { type: "null" }] };
    case "ZodRecord":
      return { type: "object", additionalProperties: true };
    case "ZodUnknown":
      return {};
    default:
      return {};
  }
}

function isOptional(schema: ZodTypeAny): boolean {
  const typeName = (schema._def as { typeName?: string }).typeName;
  return typeName === "ZodOptional" || typeName === "ZodDefault";
}
