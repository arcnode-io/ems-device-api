/**
 * The published, generated-not-hand-maintained contract for `x-protocol-
 * source` / `x-command-source` map entries.
 *
 * Composed directly from the real `Binding` union (template.protocols.
 * schema.ts) plus the exact merge-fields collectMeasurementBindings /
 * collectCommandBindings (spec-extensions.ts) actually add — so the
 * published JSON Schema, and the runtime validators below, can never drift
 * from what buildProtocolSourceMap/buildCommandSourceMap actually produce.
 *
 * The previous approach — a hand-written JSON Schema literal — had already
 * gone stale before Phase I ("dnp3" instead of "dnp3_tcp", missing bacnet/
 * synthetic entirely) and was never actually enforced against real output.
 * This makes drift structurally impossible instead of relying on someone
 * remembering to update a second, hand-maintained copy.
 */

import { z } from "zod";
import { Binding } from "../templates/template.schema";
import { Connection } from "../topology/dtm.schema";
import { WeightedPair, DistributeChild, PowerCapChild } from "./spec-rollup";

const ConnectionFields = Connection.partial().shape;

const ChannelMeta = z.strictObject({
  unit: z.string(),
  poll_rate_hz: z.number().nullable(),
  // $ref into components.schemas, so the gateway can publish a measurement as
  // its declared type. Required — a consumer that can't find the schema guesses.
  //
  // Reason: a record keyed by the literal "$ref", not an object with a `$ref`
  // property. The two validate the same payload, but z.toJSONSchema turns the
  // latter into `properties: { $ref: ... }`, and the AsyncAPI parser treats any
  // `$ref` key anywhere in the document as a reference to resolve — including
  // one that is only *describing* a reference — and throws on the non-string.
  payload: z.record(z.literal("$ref"), z.string()),
}).shape;

const CommandUnitAndIdentity = z.strictObject({
  unit: z.string(),
  verb: z.string(),
  target: z.string(),
}).shape;

/** Only resolveSourceMeasurement's output ever carries this — synthetic only. */
const SyntheticResolvedFields = {
  pairs: z.array(WeightedPair).optional(),
};

/** Only resolveDistributeChildren/resolveEnvelopeGuard's output ever carries these — distribute only. */
const DistributeResolvedFields = {
  children: z.array(DistributeChild).optional(),
  power_min: z.number().optional(),
  power_max: z.number().optional(),
  import_limit_topic: z.string().optional(),
  export_limit_topic: z.string().optional(),
  active_power_topic: z.string().optional(),
  poi_active_power_topic: z.string().optional(),
  state_of_charge_floor_percent: z.number().optional(),
};

/**
 * True for the one Binding variant with an `operation` field — `synthetic`.
 * @param variant One option from Binding.options
 * @param variant.shape The variant's Zod field shape
 * @returns Whether this variant is `synthetic`
 */
function isSynthetic(variant: { shape: object }): boolean {
  return "operation" in variant.shape;
}

/**
 * True for the one Binding variant with an `allocation_policy` field — `distribute`.
 * @param variant One option from Binding.options
 * @param variant.shape The variant's Zod field shape
 * @returns Whether this variant is `distribute`
 */
function isDistribute(variant: { shape: object }): boolean {
  return "allocation_policy" in variant.shape;
}

/**
 * True for the one Binding variant that fans a percentage out to child
 * commands — `power_cap`.
 * @param variant One option from Binding.options
 * @param variant.shape The variant's Zod field shape
 * @returns Whether this variant is `power_cap`
 */
function isPowerCap(variant: { shape: object }): boolean {
  return "child_commands" in variant.shape;
}

type AnyBindingVariant = (typeof Binding.options)[number];

/**
 * `.safeExtend()`, not `.extend()` — SyntheticBinding/DistributeBinding
 * carry `.refine()` checks, and `.extend()` throws on those. `.safeExtend()`
 * works uniformly on both refined and plain variants (confirmed against
 * zod@4.1.5).
 * @param variant One option from Binding.options
 * @param extra Additional fields to merge onto it
 * @returns The extended object schema
 */
function safeExtend(
  variant: AnyBindingVariant,
  extra: z.ZodRawShape,
): z.ZodObject {
  return (
    variant as unknown as { safeExtend: (s: z.ZodRawShape) => z.ZodObject }
  ).safeExtend(extra);
}

/**
 * synthetic's authored-form refinements ("exactly one of inputs/
 * source_measurement", "weighted_mean requires source_measurement") govern
 * the *raw template YAML* — device-api always resolves source_measurement
 * away into concrete inputs[]/pairs[] before publishing (spec-rollup.ts),
 * so a resolved entry never has source_measurement at all. Rebuilding from
 * the bare shape (dropping the authored checks) and adding the resolved-
 * form equivalent — same operation/mode coupling, s/source_measurement/
 * pairs/ — keeps this precise instead of just permissive.
 * @param syntheticVariant The raw `synthetic` Binding variant
 * @returns A refined schema matching the *resolved* entry shape only
 */
function buildResolvedSynthetic(
  syntheticVariant: AnyBindingVariant,
): z.ZodObject {
  const resolvedShape = z
    .strictObject(syntheticVariant.shape as z.ZodRawShape)
    .omit({ source_measurement: true });
  return safeExtend(resolvedShape as unknown as AnyBindingVariant, {
    ...ConnectionFields,
    ...ChannelMeta,
    ...SyntheticResolvedFields,
  })
    .refine((entry) => Boolean(entry.inputs) !== Boolean(entry.pairs), {
      message:
        "resolved synthetic entry requires exactly one of inputs or pairs",
    })
    .refine((entry) => !(entry.operation === "weighted_mean" && !entry.pairs), {
      message:
        "resolved synthetic entry: operation=weighted_mean requires pairs",
    })
    .refine(
      (entry) => !(entry.operation !== "weighted_mean" && !entry.inputs),
      {
        message:
          "resolved synthetic entry: every operation but weighted_mean requires inputs",
      },
    );
}

/**
 * distribute's envelope-guard refinement (ramp_rate_per_sec/
 * hysteresis_margin/hysteresis_dwell_secs all-or-nothing) passes through
 * from authored to resolved form unchanged, so it's kept rather than
 * rebuilt. Adds the resolved-only invariant: the five envelope-guard
 * resolution fields (power_min/power_max/the three topics) appear exactly
 * when ramp_rate_per_sec does — resolveEnvelopeGuard only runs then.
 * @param distributeVariant The raw `distribute` Binding variant
 * @returns A refined schema matching the *resolved* entry shape
 */
function buildResolvedDistribute(
  distributeVariant: AnyBindingVariant,
): z.ZodObject {
  return safeExtend(distributeVariant, {
    ...ConnectionFields,
    ...CommandUnitAndIdentity,
    ...DistributeResolvedFields,
  }).refine(
    (entry) => {
      const envelopeGuardFields = [
        entry.power_min,
        entry.power_max,
        entry.import_limit_topic,
        entry.export_limit_topic,
        entry.active_power_topic,
        entry.poi_active_power_topic,
      ];
      const present = envelopeGuardFields.filter(
        (field) => field !== undefined,
      ).length;
      const expected = entry.ramp_rate_per_sec !== undefined ? 6 : 0;
      return present === expected;
    },
    {
      message:
        "resolved distribute entry: envelope-guard resolution fields must appear exactly when ramp_rate_per_sec does",
    },
  );
}

const protocolSourceVariants = Binding.options.map((variant) =>
  isSynthetic(variant)
    ? buildResolvedSynthetic(variant)
    : safeExtend(variant, { ...ConnectionFields, ...ChannelMeta }),
);

/**
 * A built source-map entry doesn't match the published contract.
 *
 * Reason: callers have to tell a row the current contract can't serve — which
 * is recoverable, by replacing the row — from a genuine defect, which isn't.
 * Both arrive as a throw from buildSpec, so the distinction has to be a type.
 */
export class SpecContractError extends Error {
  /**
   * Creates the error naming the entry that failed.
   * @param message Which device, channel and field failed
   */
  constructor(message: string) {
    super(message);
    this.name = "SpecContractError";
  }
}

/**
 * `power_cap`'s authored form names a rule for finding the caps
 * (`child_template` + `child_commands`); the resolved form carries the caps
 * themselves. So those two are dropped and `children` added, the same way a
 * synthetic's `source_measurement` becomes `inputs`.
 *
 * The resolved-only invariant: the three envelope-guard topics appear exactly
 * when `ramp_rate_per_sec` does, because the guard is resolved only for a site
 * that enabled compute shedding *and* declared the control-law numbers.
 * @param powerCapVariant The raw `power_cap` Binding variant
 * @returns A refined schema matching the *resolved* entry shape only
 */
function buildResolvedPowerCap(
  powerCapVariant: AnyBindingVariant,
): z.ZodObject {
  const resolvedShape = z
    .strictObject(powerCapVariant.shape as z.ZodRawShape)
    .omit({
      child_template: true,
      child_commands: true,
      // Required on the authored binding, optional here: the resolved entry
      // carries them only for a site that enabled shedding.
      ramp_rate_per_sec: true,
      hysteresis_margin: true,
      hysteresis_dwell_secs: true,
    });
  return safeExtend(resolvedShape as unknown as AnyBindingVariant, {
    ...ConnectionFields,
    ...CommandUnitAndIdentity,
    children: z.array(PowerCapChild),
    import_limit_topic: z.string().optional(),
    export_limit_topic: z.string().optional(),
    poi_active_power_topic: z.string().optional(),
    ramp_rate_per_sec: z.number().optional(),
    hysteresis_margin: z.number().optional(),
    hysteresis_dwell_secs: z.number().optional(),
  }).refine(
    (entry) => {
      const guardFields = [
        entry.import_limit_topic,
        entry.export_limit_topic,
        entry.poi_active_power_topic,
        entry.ramp_rate_per_sec,
        entry.hysteresis_margin,
        entry.hysteresis_dwell_secs,
      ];
      const present = guardFields.filter((field) => field !== undefined).length;
      return present === 0 || present === 6;
    },
    {
      message:
        "resolved power_cap entry: the six envelope-guard fields appear together or not at all — a partial guard is a guard the gateway cannot act on",
    },
  );
}

/** The real, generated shape of one `x-protocol-source[device_id][channel]` entry. */
export const ProtocolSourceEntry = z.discriminatedUnion(
  "protocol",
  protocolSourceVariants as [z.ZodObject, ...z.ZodObject[]],
);

const commandSourceVariants = Binding.options.map((variant) => {
  if (isDistribute(variant)) return buildResolvedDistribute(variant);
  if (isPowerCap(variant)) return buildResolvedPowerCap(variant);
  return safeExtend(variant, {
    ...ConnectionFields,
    ...CommandUnitAndIdentity,
  });
});

/** The real, generated shape of one `x-command-source[device_id][channel]` entry. */
export const CommandSourceEntry = z.discriminatedUnion(
  "protocol",
  commandSourceVariants as [z.ZodObject, ...z.ZodObject[]],
);

/**
 * JSON Schema for publishing under `components.schemas.ProtocolSource` —
 * generated from {@link ProtocolSourceEntry}, never hand-written.
 * @returns Draft 2020-12 JSON Schema
 */
export function protocolSourceJsonSchema(): object {
  return z.toJSONSchema(ProtocolSourceEntry);
}

/**
 * JSON Schema for publishing under `components.schemas.CommandSource` —
 * generated from {@link CommandSourceEntry}, never hand-written.
 * @returns Draft 2020-12 JSON Schema
 */
export function commandSourceJsonSchema(): object {
  return z.toJSONSchema(CommandSourceEntry);
}

/**
 * Validate every entry of a resolved `x-protocol-source` map against
 * {@link ProtocolSourceEntry}, throwing with the offending device_id/channel
 * named if resolution ever produces a shape the contract doesn't allow.
 * Real enforcement, not just documentation — catches drift between the
 * resolvers in spec-extensions.ts and this contract immediately, in every
 * spec generation, not just in tests.
 * @param map The map buildProtocolSourceMap just built
 * @returns The same map, unchanged, once every entry is confirmed valid
 */
export function validateProtocolSourceMap<
  T extends Record<string, Record<string, unknown>>,
>(map: T): T {
  for (const [deviceId, channels] of Object.entries(map)) {
    for (const [channel, entry] of Object.entries(channels)) {
      const result = ProtocolSourceEntry.safeParse(entry);
      if (!result.success) {
        throw new SpecContractError(
          `x-protocol-source[${deviceId}][${channel}] doesn't match ProtocolSourceEntry: ${result.error.message}`,
        );
      }
    }
  }
  return map;
}

/**
 * The command-side mirror of {@link validateProtocolSourceMap}.
 * @param map The map buildCommandSourceMap just built
 * @returns The same map, unchanged, once every entry is confirmed valid
 */
export function validateCommandSourceMap<
  T extends Record<string, Record<string, unknown>>,
>(map: T): T {
  for (const [deviceId, channels] of Object.entries(map)) {
    for (const [channel, entry] of Object.entries(channels)) {
      const result = CommandSourceEntry.safeParse(entry);
      if (!result.success) {
        throw new SpecContractError(
          `x-command-source[${deviceId}][${channel}] doesn't match CommandSourceEntry: ${result.error.message}`,
        );
      }
    }
  }
  return map;
}
