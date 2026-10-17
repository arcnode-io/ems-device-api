/**
 * Keep-alive a device needs from the EMS, declared on its template. Mirror of
 * edp-api's template_heartbeat.py.
 *
 * The gateway writes a counter (0, 1, … counter_modulo-1, 0, …) to `binding`
 * every `period_s`, only while its broker link is up and the device isn't
 * locked out; if the EMS goes away the beat stops and the device's own
 * watchdog fails safe.
 */

import { z } from "zod";
import { ModbusBinding } from "./template.protocols.schema";

export const Heartbeat = z.strictObject({
  // Where the counter goes: a Modbus write (function code 6 or 16).
  binding: ModbusBinding,
  counter_modulo: z.number().int().gt(1),
  period_s: z.number().gt(0),
});
export type HeartbeatType = z.infer<typeof Heartbeat>;
