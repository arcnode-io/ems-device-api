/**
 * Zod schemas for the Device Topology Manifest.
 *
 * Mirror of `edp-api/src/generators/dtm_models.py` (Pydantic). edp-api emits;
 * device-api receives. Drift between the two ⇒ POST /topology rejects with 400.
 *
 * Per ADR-002 §7, the DTM is self-describing: every template referenced by
 * `devices[*].template` appears verbatim under `templates_used`, so the
 * spec generator never reads from disk.
 */

import { z } from "zod";
import { DeviceTemplate } from "../templates/template.schema";

export const DeviceConnection = z.object({
  host: z.string().optional(),
  port: z.number().int().optional(),
  unit_id: z.string().optional(),
});

export const DtmDevice = z.object({
  template: z.string(),
  display_name: z.string().optional(),
  parent: z.string().optional(),
  connection: DeviceConnection.optional(),
});

export const BusMember = z.object({
  device_id: z.string(),
  port: z.string().optional(),
});

// ADR-002 §1: bus type is "dc" | "ac". Be stricter on the receive side than
// edp-api's free-form string so drift surfaces at the boundary.
export const Bus = z.object({
  id: z.string(),
  type: z.enum(["dc", "ac"]),
  members: z.array(BusMember),
});

export const SizingParams = z.object({
  P_compute_total_kW: z.number(),
  E_BESS_total_kWh: z.number(),
  T_coolant_setpoint_C: z.number(),
});

export const Dtm = z.object({
  dtm_version: z.string(),
  deployment_uuid: z.string(),
  generated_at: z.string(),
  sizing_ref: z.string(),
  sizing_params: SizingParams,
  devices: z.record(z.string(), DtmDevice),
  buses: z.array(Bus),
  templates_used: z.record(z.string(), DeviceTemplate),
});

export type DtmType = z.infer<typeof Dtm>;
