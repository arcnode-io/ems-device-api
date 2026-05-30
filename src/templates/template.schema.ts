/**
 * Zod schemas for device templates — canonical mirror of edp-api Pydantic schema
 * (src/shared/schemas/template.py + template_protocols.py, edp-api PR 1).
 *
 * All models use z.strictObject() → unknown keys throw, matching Pydantic extra="forbid".
 * Cross-field constraints mirror the Pydantic @model_validator logic exactly.
 */

import { z } from "zod";
import { Binding } from "./template.protocols.schema";
import { Alarm } from "./template.alarms.schema";

export { Binding } from "./template.protocols.schema";
export type { BindingType } from "./template.protocols.schema";
export {
  Alarm,
  AlarmPriority,
  ConditionSource,
  Reset,
} from "./template.alarms.schema";
export type {
  AlarmType,
  ConditionSourceType,
} from "./template.alarms.schema";

// Slug pattern — ADR-002 §9
const SLUG_RE = /^[a-z][a-z0-9_]{0,62}[a-z0-9]$/;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const TemplateKind = {
  LEAF: "leaf",
  MODULE: "module",
} as const;

export const Publisher = {
  LINE_CONTROLLER: "line_controller",
  ANALYST: "analyst",
  GATEWAY: "gateway",
} as const;

export const Fanout = {
  LINE_CONTROLLER: "line_controller",
} as const;

const TemplateKindSchema = z.enum(["leaf", "module"]);
const PublisherSchema = z.enum(["line_controller", "analyst", "gateway"]);
const FanoutSchema = z.enum(["line_controller"]);

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

// Reason: YAML loaders may produce numeric keys; transform to string so the
// record stays Record<string, string> on the TypeScript side.
const ValuesRecord = z.record(
  z.union([z.string(), z.number()]).transform(String),
  z.string(),
);

// Physical-range envelope for a float measurement. Drives sim driver random
// walks and Reading tone derivation. min < nominal < max enforced.
export const Bounds = z
  .strictObject({
    min: z.number(),
    max: z.number(),
    nominal: z.number(),
  })
  .refine((bounds) => bounds.min < bounds.max, {
    message: "bounds.min must be less than bounds.max",
  })
  .refine(
    (bounds) => bounds.min <= bounds.nominal && bounds.nominal <= bounds.max,
    {
      message: "bounds.nominal must lie within [min, max]",
    },
  );

// Alarm-threshold envelope for a float measurement. Drives chart MIN/MAX
// threshold lines (Rule 3.6) and Reading tone derivation. warn band is wider
// than alarm band; both centered around bounds.nominal.
export const Thresholds = z
  .strictObject({
    warn_min: z.number(),
    warn_max: z.number(),
    alarm_min: z.number(),
    alarm_max: z.number(),
  })
  .refine((thresh) => thresh.alarm_min <= thresh.warn_min, {
    message: "thresholds.alarm_min must be ≤ thresholds.warn_min",
  })
  .refine((thresh) => thresh.warn_max <= thresh.alarm_max, {
    message: "thresholds.warn_max must be ≤ thresholds.alarm_max",
  })
  .refine((thresh) => thresh.warn_min <= thresh.warn_max, {
    message: "thresholds.warn_min must be ≤ thresholds.warn_max",
  });

export type BoundsType = z.infer<typeof Bounds>;
export type ThresholdsType = z.infer<typeof Thresholds>;

export const Measurement = z
  .strictObject({
    unit: z.string(),
    type: z.enum(["float", "bool", "enum"]),
    poll_rate_hz: z.number().nullable().default(null),
    display_name_default: z.string().nullable().default(null),
    // Reason: optional to match the edp-api Python schema (which has
    // iec_61850_ref: str | None = None). Module-template rollups + legacy
    // measurements that haven't been annotated yet were rejected by the
    // prior z.string() — keeping the field nullable matches the source of truth.
    iec_61850_ref: z.string().nullable().default(null),
    bounds: Bounds.nullable().default(null),
    thresholds: Thresholds.nullable().default(null),
    values: ValuesRecord.nullable().default(null),
    binding: Binding.nullable().default(null),
    publisher: PublisherSchema.nullable().default(null),
  })
  .refine(
    (meas) => {
      // Synthetic binding requires publisher=gateway (both fields set).
      // All other bindings: exactly one of binding XOR publisher.
      const isSynthetic = meas.binding?.protocol === "synthetic";
      if (isSynthetic) return meas.publisher === "gateway";
      return Boolean(meas.binding) !== Boolean(meas.publisher);
    },
    {
      message:
        "measurement requires exactly one of binding/publisher (synthetic requires publisher=gateway)",
    },
  )
  .refine((meas) => !(meas.type === "enum" && meas.values === null), {
    message: "values required for type=enum",
  })
  .refine((meas) => !(meas.type !== "enum" && meas.values !== null), {
    message: "values forbidden for non-enum type",
  })
  // Bounds/thresholds: nullable for floats — matches the edp-api Python
  // schema. Module rollups (state_of_charge etc.) don't have meaningful
  // bounds at the abstract template level; concrete leaves can set them.
  // Forbid-for-non-float invariant kept below.
  .refine((meas) => !(meas.type !== "float" && meas.bounds !== null), {
    message: "bounds forbidden for non-float type",
  })
  .refine((meas) => !(meas.type !== "float" && meas.thresholds !== null), {
    message: "thresholds forbidden for non-float type",
  });

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const Command = z
  .strictObject({
    verb: z.enum([
      "set",
      "reset",
      "clear",
      "start",
      "stop",
      "enable",
      "disable",
    ]),
    target: z.string(),
    unit: z.string(),
    payload: z.enum(["float", "bool", "enum", "trigger"]),
    display_name_default: z.string().nullable().default(null),
    binding: Binding.nullable().default(null),
    fanout: FanoutSchema.nullable().default(null),
  })
  .refine((cmd) => Boolean(cmd.binding) !== Boolean(cmd.fanout), {
    message: "command requires exactly one of binding/fanout",
  });

// ---------------------------------------------------------------------------
// InstallTask
// ---------------------------------------------------------------------------

// BICSI commissioning levels — L(n) gates wait on every L(n-1) across all
// devices in the install sequence DAG.
export const CxLevel = z.enum(["L1", "L2", "L3", "L4", "L5"]);

export const InstallTask = z.strictObject({
  name: z.string(),
  depends_on: z.array(z.string()).default([]),
  est_minutes: z.number().int().positive(),
  crew_role: z.enum(["electrician", "plumber", "it", "general"]),
  cx_level: CxLevel,
});

// ---------------------------------------------------------------------------
// ContainsEntry
// ---------------------------------------------------------------------------

export const ContainsEntry = z.strictObject({
  template: z.string(),
  // Reason: union preserves the literal "scalable" while allowing positive int
  qty: z
    .union([z.literal("scalable"), z.number().int().positive()])
    .default("scalable"),
  // Mirror of edp-api ContainsEntry.power_from (Python source of truth at
  // edp-api/src/shared/schemas/template.py:112). Names sibling
  // contains[].template slugs that supply AC power to this entry. Empty
  // list = doesn't draw power (e.g. PDUs themselves, sensors). Multi-
  // entry = 2N/N+1 redundant feeds; v1 cable schedule emits one row
  // (primary feed). Accept-and-carry on device-api — no semantics here.
  power_from: z.array(z.string()).default([]),
});

// ---------------------------------------------------------------------------
// DeviceTemplate
// ---------------------------------------------------------------------------

export const DeviceTemplate = z
  .strictObject({
    template: z.string(),
    kind: TemplateKindSchema,
    equipment_id: z.string().nullable().default(null),
    vendor: z.string().nullable().default(null),
    model: z.string().nullable().default(null),
    description: z.string(),
    contains: z.array(ContainsEntry).default([]),
    measurements: z.record(z.string(), Measurement).default({}),
    commands: z.record(z.string(), Command).default({}),
    install_tasks: z.array(InstallTask).default([]),
    // Alarm catalog projected from each leaf's equipment_spec.yaml by edp-api.
    // Modules + un-rationalized leaves surface as []. Mirror of edp-api
    // DeviceTemplate.alarms (Pydantic), shape defined in template.alarms.schema.
    alarms: z.array(Alarm).default([]),
  })
  .refine((tpl) => SLUG_RE.test(tpl.template), {
    message: "template slug must match snake_case slug pattern",
    path: ["template"],
  })
  // kind=leaf: equipment_id, vendor, model required; contains forbidden
  .refine((tpl) => !(tpl.kind === "leaf" && tpl.equipment_id === null), {
    message: "equipment_id required for kind=leaf",
    path: ["equipment_id"],
  })
  .refine((tpl) => !(tpl.kind === "leaf" && tpl.vendor === null), {
    message: "vendor required for kind=leaf",
    path: ["vendor"],
  })
  .refine((tpl) => !(tpl.kind === "leaf" && tpl.model === null), {
    message: "model required for kind=leaf",
    path: ["model"],
  })
  .refine((tpl) => !(tpl.kind === "leaf" && tpl.contains.length > 0), {
    message: "contains forbidden for kind=leaf",
    path: ["contains"],
  })
  // kind=module: equipment_id, vendor, model forbidden
  .refine((tpl) => !(tpl.kind === "module" && tpl.equipment_id !== null), {
    message: "equipment_id forbidden for kind=module",
    path: ["equipment_id"],
  })
  .refine((tpl) => !(tpl.kind === "module" && tpl.vendor !== null), {
    message: "vendor forbidden for kind=module",
    path: ["vendor"],
  })
  .refine((tpl) => !(tpl.kind === "module" && tpl.model !== null), {
    message: "model forbidden for kind=module",
    path: ["model"],
  })
  .refine(
    (tpl) =>
      Object.keys(tpl.measurements).length > 0 ||
      Object.keys(tpl.commands).length > 0,
    {
      message: "template must declare at least one of measurements or commands",
    },
  )
  // install_task.depends_on must name another install_task in the same template.
  .superRefine((tpl, ctx) => {
    const names = new Set(tpl.install_tasks.map((task) => task.name));
    for (const task of tpl.install_tasks) {
      for (const dep of task.depends_on) {
        if (!names.has(dep)) {
          ctx.addIssue({
            code: "custom",
            message: `install_task ${task.name}: depends_on ${dep} not found in install_tasks`,
            path: ["install_tasks"],
          });
        }
      }
    }
  });

// Public TypeScript types (inferred from Zod schemas)
export type MeasurementType = z.infer<typeof Measurement>;
export type CommandType = z.infer<typeof Command>;
export type ContainsEntryType = z.infer<typeof ContainsEntry>;
export type DeviceTemplateType = z.infer<typeof DeviceTemplate>;
