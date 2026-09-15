/**
 * Concrete per-template message schemas for the AsyncAPI v3 spec.
 *
 * ADR-002 §6: one schema per (template, measurement) and per (template,
 * command), derived from the template catalog — never from device instances
 * (§15). Enum values lock to the template's `values:` labels in register-code
 * order; float values carry `minimum`/`maximum` from `bounds:`. A `set`
 * command's value schema is that of the measurement named by its `target`.
 */

import type {
  CommandType,
  DeviceTemplateType,
  MeasurementType,
} from "../templates/template.schema";

export type Family = "measurement" | "command";
export type WireType = "float" | "bool" | "enum" | "trigger";

/** One concrete message: the name doubles as the components.schemas key. */
export interface ConcreteMessage {
  readonly name: string;
  readonly family: Family;
  readonly wireType: WireType;
  readonly schema: Record<string, unknown>;
}

const TS_SCHEMA = { type: "string", format: "date-time" };

/**
 * Derive every concrete message schema declared by the given templates.
 * @param templates Templates to project (the catalog, or a DTM's templates_used)
 * @returns Concrete messages, one per measurement and one per command
 */
export function buildConcreteMessages(
  templates: readonly DeviceTemplateType[],
): readonly ConcreteMessage[] {
  const out: ConcreteMessage[] = [];
  for (const tpl of templates) {
    const prefix = pascal(tpl.template);
    for (const [name, meas] of Object.entries(tpl.measurements)) {
      out.push({
        name: `${prefix}_${pascal(name)}`,
        family: "measurement",
        wireType: meas.type,
        schema: sample(valueSchema(tpl, name, meas)),
      });
    }
    for (const [name, cmd] of Object.entries(tpl.commands)) {
      out.push({
        name: `${prefix}_${pascal(name)}`,
        family: "command",
        wireType: cmd.payload,
        schema: commandSchema(tpl, name, cmd),
      });
    }
  }
  return out;
}

/**
 * Value schema for one measurement, per its wire type.
 * @param tpl Owning template (for error context)
 * @param name Measurement name (for error context)
 * @param meas The measurement definition
 * @returns JSON Schema for the `value` property
 */
function valueSchema(
  tpl: DeviceTemplateType,
  name: string,
  meas: MeasurementType,
): Record<string, unknown> {
  switch (meas.type) {
    case "float":
      return meas.bounds
        ? { type: "number", minimum: meas.bounds.min, maximum: meas.bounds.max }
        : { type: "number" };
    case "bool":
      return { type: "boolean" };
    case "enum":
      if (!meas.values) {
        throw new Error(
          `${tpl.template}.${name}: enum measurement has no values`,
        );
      }
      return { type: "string", enum: orderedLabels(meas.values) };
    default: {
      const unreachable: never = meas.type;
      throw new Error(
        `${tpl.template}.${name}: unknown wire type ${String(unreachable)}`,
      );
    }
  }
}

/**
 * Value schema for a command: trigger has none; everything else inherits the
 * target measurement's schema (the target must exist on the same template).
 * @param tpl Owning template
 * @param name Command name (for error context)
 * @param cmd The command definition
 * @returns JSON Schema for the whole sample
 */
function commandSchema(
  tpl: DeviceTemplateType,
  name: string,
  cmd: CommandType,
): Record<string, unknown> {
  if (cmd.payload === "trigger") return sample(null);
  const target = tpl.measurements[cmd.target];
  if (!target) {
    throw new Error(
      `${tpl.template}.${name}: command target ${cmd.target} is not a measurement of this template`,
    );
  }
  return sample(valueSchema(tpl, cmd.target, target));
}

/**
 * Labels ordered by their register code, so the enum reads in hardware order.
 * @param values The template `values:` map — register code to label
 * @returns Labels in ascending code order
 */
function orderedLabels(values: Record<string, string>): string[] {
  return Object.entries(values)
    .sort(([codeA], [codeB]) =>
      codeA.localeCompare(codeB, undefined, { numeric: true }),
    )
    .map(([, label]) => label);
}

/**
 * Wrap a value schema in the `{ts, value}` sample shape; null means ts-only.
 * @param value JSON Schema for `value`, or null for trigger samples
 * @returns The sample object schema
 */
function sample(
  value: Record<string, unknown> | null,
): Record<string, unknown> {
  return value === null
    ? { type: "object", required: ["ts"], properties: { ts: TS_SCHEMA } }
    : {
        type: "object",
        required: ["ts", "value"],
        properties: { ts: TS_SCHEMA, value },
      };
}

/**
 * snake_case slug to PascalCase.
 * @param slug e.g. `grid_module`
 * @returns e.g. `GridModule`
 */
function pascal(slug: string): string {
  return slug
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
}
