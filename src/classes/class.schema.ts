/**
 * Zod schemas for the device class catalog.
 *
 * Mirror of the schema documented in `arcnode/device_classes/readme.md`.
 * MVP scope: validates the bits the AsyncAPI generator actually consumes
 * (class, version, measurements, commands). Other fields pass through
 * untouched until a feature needs them.
 */

import { z } from "zod";

export const Measurement = z.object({
  unit: z.string(),
  type: z.enum(["float", "bool", "enum"]),
  poll_rate_hz: z.number().optional(),
  display_name_default: z.string().optional(),
  iec_61850_ref: z.string().optional(),
  values: z.record(z.string(), z.unknown()).optional(),
});

export const Command = z.object({
  verb: z.enum(["set", "reset", "clear", "start", "stop", "enable", "disable"]),
  target: z.string(),
  unit: z.string(),
  payload: z.enum(["float", "bool", "enum", "trigger"]),
  display_name_default: z.string().optional(),
});

export const DeviceClass = z
  .object({
    class: z.string(),
    version: z.string().regex(/^v\d+$/, 'version must match "vN"'),
    measurements: z.record(z.string(), Measurement).optional(),
    commands: z.record(z.string(), Command).optional(),
  })
  .passthrough()
  .refine(
    (cls) =>
      Object.keys(cls.measurements ?? {}).length > 0 ||
      Object.keys(cls.commands ?? {}).length > 0,
    {
      message: "class must declare at least one of measurements: or commands:",
    },
  );

export type DeviceClassType = z.infer<typeof DeviceClass>;
export type MeasurementType = z.infer<typeof Measurement>;
export type CommandType = z.infer<typeof Command>;
