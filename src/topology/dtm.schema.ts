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

// edp-api types deployment_uuid as Python uuid.UUID, which accepts any 128-bit
// value — including the NCS-variant ids with no version nibble that its DTM
// generator emits. Zod's .uuid() enforces RFC 9562 versions and rejects those,
// so mirroring Pydantic means validating the 8-4-4-4-12 shape, not the version.
const UUID_SHAPE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Sentinel used in DTM YAML for fields the utility assigns at commissioning.
export const PROVISIONED_AT_COMMISSIONING = "PROVISIONED_AT_COMMISSIONING";

// Int field that may carry the placeholder until the utility provisions it.
export const ProvisionedInt = z.union([
  z.number().int(),
  z.literal(PROVISIONED_AT_COMMISSIONING),
]);

export const EmsMode = z.enum(["sim", "live"]);
export type EmsModeType = z.infer<typeof EmsMode>;

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
  // Islanding ride-through reserve, set at order time — mirrors edp-api
  // ConfiguratorPayload.ride_through_hours / dtm_primitives.SizingParams.
  ride_through_hours: z.number().default(0),
  bess_reserve_floor_mwh: z.number().default(0),
  // Energy the site wants held ready to answer the next operating envelope, and the grid-charge
  // rate that refills it between events. edp-api derives both from the contracted flex
  // obligation — readiness is the ride-through floor plus the curtailment-response energy, so it
  // is never below bess_reserve_floor_mwh, and equals it on a site with no flex obligation.
  //
  // Defaulted, not required: every DTM emitted before these existed must keep validating, and a
  // readiness of zero means the site charges to nothing, which is the behaviour every
  // deployment has today. Shipping this must not start a site importing.
  bess_readiness_mwh: z.number().default(0),
  bess_recharge_mw: z.number().default(0),
  // Whether this site lets the EMS cap compute on its own when the operating
  // envelope binds and storage cannot cover it. Per-site because throttling a
  // tenant's workload needs standing the EMS does not have by default, so the
  // safe value is off: absent means the envelope guard never reaches for
  // compute, and a module's power_cap command stays operator-only.
  compute_shed_enabled: z.boolean().default(false),
});
export type SizingParamsType = z.infer<typeof SizingParams>;

export const Device = z.strictObject({
  device_id: z.string().regex(SLUG_RE, "device_id must be a snake_case slug"),
  template: z.string(),
  parent: z.string().nullish(),
  display_name: z.string().nullish(),
  connection: Connection.nullish(),
  // Accepted but unused. ems/system_adr.md §25 dropped the site-level live/
  // commissioned state this gated, and nothing in any repo ever enforced it.
  // Device is strictObject, so the field has to stay accepted while any DTM
  // still carries it — including ones already persisted in customer databases.
  // Not defaulted, not projected to the view, and stripped before edp-api.
  blocking: z.array(z.string()).optional(),
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
    deployment_uuid: z
      .string()
      .regex(UUID_SHAPE_RE, "deployment_uuid must be a uuid"),
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
