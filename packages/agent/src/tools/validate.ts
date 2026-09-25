import type { JsonSchema } from "./schemas.ts";

const describe = (v: unknown) =>
  v === null ? "null" : Array.isArray(v) ? "an array" : `a ${typeof v}`;

/**
 * Checks tool arguments against the JSON Schema subset in schemas.ts. Returns
 * the first problem as a message the model can act on, or null when valid.
 */
export function validateArgs(
  schema: JsonSchema,
  value: unknown,
  path = "arguments",
): string | null {
  switch (schema.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        return `${path} must be an object, not ${describe(value)}`;
      const obj = value as Record<string, unknown>;
      const props = schema.properties ?? {};
      for (const key of schema.required ?? [])
        if (obj[key] === undefined) return `${path}.${key} is required`;
      for (const [key, v] of Object.entries(obj)) {
        const prop = props[key];
        if (!prop) {
          if (schema.additionalProperties === false)
            return `${path} has an unknown property "${key}" (allowed: ${Object.keys(props).join(", ") || "none"})`;
          continue;
        }
        if (v === undefined) continue;
        const problem = validateArgs(prop, v, `${path}.${key}`);
        if (problem) return problem;
      }
      return null;
    }
    case "array": {
      if (!Array.isArray(value))
        return `${path} must be an array, not ${describe(value)}`;
      if (schema.maxItems !== undefined && value.length > schema.maxItems)
        return `${path} has ${value.length} items (at most ${schema.maxItems})`;
      for (const [i, item] of value.entries()) {
        const problem = schema.items
          ? validateArgs(schema.items, item, `${path}[${i}]`)
          : null;
        if (problem) return problem;
      }
      return null;
    }
    case "string":
      if (typeof value !== "string")
        return `${path} must be a string, not ${describe(value)}`;
      if (schema.maxLength !== undefined && value.length > schema.maxLength)
        return `${path} is ${value.length} characters (at most ${schema.maxLength})`;
      return null;
    case "number":
    case "integer":
      if (typeof value !== "number" || !Number.isFinite(value))
        return `${path} must be a number, not ${describe(value)}`;
      if (schema.type === "integer" && !Number.isInteger(value))
        return `${path} must be an integer`;
      if (schema.minimum !== undefined && value < schema.minimum)
        return `${path} must be at least ${schema.minimum}`;
      return null;
    case "boolean":
      return typeof value === "boolean"
        ? null
        : `${path} must be true or false, not ${describe(value)}`;
  }
}
