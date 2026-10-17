/**
 * `x-heartbeat-source` — per device, the counter the gateway must keep
 * writing or the device's watchdog faults it (CATL's BMS may open its
 * contactors). The template declares the register; the device's connection is
 * merged in the same way x-command-source entries get theirs.
 */

import { Logger } from "@nestjs/common";
import { z } from "zod";
import { ModbusBinding } from "../templates/template.protocols.schema";
import {
  Connection,
  PROVISIONED_AT_COMMISSIONING,
} from "../topology/dtm.schema";
import type { DtmType } from "../topology/dtm.schema";

const logger = new Logger("SpecHeartbeat");

/**
 * One gateway-ready heartbeat. Strict, like every source entry: the gateway's
 * HeartbeatSource flattens a ProtocolBinding and denies unknown fields.
 * value_map is dropped — it maps a read to an enum label, and this is a write.
 */
export const HeartbeatSourceEntry = ModbusBinding.omit({
  value_map: true,
}).extend({
  ...Connection.shape,
  counter_modulo: z.number().int().gt(1),
  period_s: z.number().gt(0),
});
export type HeartbeatSourceMap = Record<
  string,
  z.infer<typeof HeartbeatSourceEntry>
>;

/**
 * Build the heartbeat map for every provisioned device whose template has one.
 * @param dtm The self-describing deployment manifest
 * @returns device_id -> Modbus write binding + connection + counter_modulo + period_s
 */
export function buildHeartbeatSourceMap(dtm: DtmType): HeartbeatSourceMap {
  const out: HeartbeatSourceMap = {};
  for (const [deviceId, device] of Object.entries(dtm.devices)) {
    const heartbeat = dtm.templates_used[device.template]?.heartbeat;
    if (!heartbeat) continue;
    const conn = device.connection;
    if (!conn) {
      // Reason: /asyncapi builds for any topology; a heartbeat with nowhere to
      // go is a DTM gap to log, not a reason to refuse every other device.
      logger.warn(
        `device ${deviceId}: template ${device.template} has a heartbeat but the device has no connection`,
      );
      continue;
    }
    if (
      conn.host === PROVISIONED_AT_COMMISSIONING ||
      conn.port === PROVISIONED_AT_COMMISSIONING
    ) {
      continue;
    }
    const write = { ...heartbeat.binding };
    delete write.value_map;
    out[deviceId] = HeartbeatSourceEntry.parse({
      ...write,
      ...conn,
      counter_modulo: heartbeat.counter_modulo,
      period_s: heartbeat.period_s,
    });
  }
  return out;
}
