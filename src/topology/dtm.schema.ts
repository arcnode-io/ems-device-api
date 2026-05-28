/**
 * Zod schemas for the Device Topology Manifest — canonical mirror of
 * edp-api Pydantic schema (src/shared/schemas/dtm.py + dtm_primitives.py).
 *
 * Per ADR-002 §7: devices keyed by snake_case slug, templates_used embedded,
 * buses typed dc|ac, three referential-integrity refines. Strict objects
 * everywhere to mirror Pydantic extra="forbid".
 */

import { z } from "zod";
import { DeviceTemplate, Measurement } from "../templates/template.schema";

// Slug pattern — ADR-002 §9
const SLUG_RE = /^[a-z][a-z0-9_]{0,62}[a-z0-9]$/;

// Sentinel used in DTM YAML for fields the utility assigns at commissioning.
export const PROVISIONED_AT_COMMISSIONING = "PROVISIONED_AT_COMMISSIONING";

// Int field that may carry the placeholder until the utility provisions it.
export const ProvisionedInt = z.union([
  z.number().int(),
  z.literal(PROVISIONED_AT_COMMISSIONING),
]);

export const EmsMode = z.enum(["sim", "live"]);
export type EmsModeType = z.infer<typeof EmsMode>;

export const BlockingKind = z.enum(["live_mode", "commissioning_complete"]);
export type BlockingKindType = z.infer<typeof BlockingKind>;

export const Connection = z.strictObject({
  host: z.string(),
  port: ProvisionedInt,
  unit_id: z.string().nullish(),
});
export type ConnectionType = z.infer<typeof Connection>;

export const SizingParams = z.strictObject({
  P_compute_total_kW: z.number(),
  E_BESS_total_kWh: z.number(),
  T_coolant_setpoint_C: z.number(),
});
export type SizingParamsType = z.infer<typeof SizingParams>;

export const Device = z.strictObject({
  device_id: z.string().regex(SLUG_RE, "device_id must be a snake_case slug"),
  template: z.string(),
  parent: z.string().nullish(),
  display_name: z.string().nullish(),
  connection: Connection.nullish(),
  blocking: z.array(BlockingKind).default(["live_mode"]),
  extra_measurements: z.record(z.string(), Measurement).nullish(),
  // Computed by edp-api Pydantic @property and emitted in DTM JSON.
  // Consumer-side mirror: accept-and-carry, no semantics on device-api.
  has_placeholders: z.boolean().optional(),
  mode: EmsMode.optional(),
});
export type DeviceType = z.infer<typeof Device>;

export const BusMember = z.strictObject({
  device_id: z.string(),
  port: z.string().nullish(),
});
export type BusMemberType = z.infer<typeof BusMember>;

export const Bus = z.strictObject({
  bus_id: z.string(),
  type: z.enum(["dc", "ac"]),
  members: z.array(BusMember),
});
export type BusType = z.infer<typeof Bus>;

export const Dtm = z
  .strictObject({
    deployment_uuid: z.string().uuid(),
    sizing_ref: z.string().nullish(),
    sizing_params: SizingParams,
    devices: z.record(z.string(), Device),
    buses: z.array(Bus),
    templates_used: z.record(z.string(), DeviceTemplate),
    // Computed by edp-api: LIVE iff every device fully provisioned, else SIM.
    // Field is optional so DTMs constructed in-process (eg tests) can omit it.
    mode: EmsMode.optional(),
    // edp-api emits its own monotonic DTM version. device-api persists its
    // own version separately in the Topology table — this field is metadata
    // only, accepted-and-carried.
    version: z.string().optional(),
    // Computed by edp-api Pydantic @property: list of devices still carrying
    // PROVISIONED_AT_COMMISSIONING sentinels. Accept-and-carry; device-api
    // re-derives if it needs the same view.
    pending_devices: z.array(Device).optional(),
  })
  // parent_chain_resolves: every device.parent must be null or a key in devices
  .refine(
    (dtm) =>
      Object.values(dtm.devices).every(
        (dev) =>
          dev.parent === null ||
          dev.parent === undefined ||
          dev.parent in dtm.devices,
      ),
    "device.parent must resolve in devices",
  )
  // template_refs_resolve: every device.template must be a key in templates_used
  .refine(
    (dtm) =>
      Object.values(dtm.devices).every(
        (dev) => dev.template in dtm.templates_used,
      ),
    "device.template must resolve in templates_used",
  )
  // bus_members_resolve: every bus member device_id must be a key in devices
  .refine(
    (dtm) =>
      dtm.buses.every((bus) =>
        bus.members.every((member) => member.device_id in dtm.devices),
      ),
    "bus member device_id must resolve in devices",
  );

export type DtmType = z.infer<typeof Dtm>;
