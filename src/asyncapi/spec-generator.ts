/**
 * Pure builder: DTM + class catalog → AsyncAPI v3 spec object.
 *
 * One channel per measurement and per command, per device. Topic shape per
 * ADR-002:
 *   measurements: sites/{site_id}/devices/{device_id}/measurements/{name}/{unit}
 *   commands:     sites/{site_id}/devices/{device_id}/commands/{verb}/{target}/{unit}
 *
 * If a device's class is not in the catalog, it falls back to a single
 * placeholder `health` measurement so the device is at least represented.
 */

import type { DtmType } from "../topology/dtm.schema";
import type { DeviceClassType } from "../classes/class.schema";

const SPEC_VERSION = "3.0.0";
const READING_REF = "#/components/messages/Reading";
const COMMAND_REF = "#/components/messages/Command";
const READING_SCHEMA_REF = "#/components/schemas/Reading";
const COMMAND_SCHEMA_REF = "#/components/schemas/Command";

interface Channel {
  address: string;
  messages: Record<string, { $ref: string }>;
}

interface Operation {
  action: "receive" | "send";
  channel: { $ref: string };
}

interface AsyncApiSpec {
  asyncapi: string;
  info: { title: string; version: string; description: string };
  channels: Record<string, Channel>;
  operations: Record<string, Operation>;
  components: {
    messages: Record<string, { name: string; payload: { $ref: string } }>;
    schemas: Record<string, unknown>;
  };
}

/** Resolves DTM device class refs to their catalog entries (or undefined). */
export type ClassLookup = (classRef: string) => DeviceClassType | undefined;

/**
 * Build the AsyncAPI v3 spec from a DTM + class catalog lookup.
 * @param dtm Validated Device Topology Manifest
 * @param lookup Resolves a class ref like `bess_module.v1` to its definition
 * @returns The AsyncAPI 3.0.0 spec
 */
export function buildSpec(dtm: DtmType, lookup: ClassLookup): AsyncApiSpec {
  const siteId = dtm.deployment_uuid;
  const channels: Record<string, Channel> = {};
  const operations: Record<string, Operation> = {};

  for (const [deviceId, device] of Object.entries(dtm.devices)) {
    const cls = lookup(device.class);
    if (cls) {
      addClassChannels(channels, operations, siteId, deviceId, cls);
    } else {
      addPlaceholderChannel(channels, operations, siteId, deviceId);
    }
  }

  return {
    asyncapi: SPEC_VERSION,
    info: {
      title: `ARCNODE EMS — ${siteId}`,
      version: dtm.dtm_version,
      description: `AsyncAPI v3 contract generated from DTM ${dtm.deployment_uuid}.`,
    },
    channels,
    operations,
    components: {
      messages: {
        Reading: { name: "Reading", payload: { $ref: READING_SCHEMA_REF } },
        Command: { name: "Command", payload: { $ref: COMMAND_SCHEMA_REF } },
      },
      schemas: {
        Reading: {
          type: "object",
          required: ["ts", "value"],
          properties: {
            ts: { type: "string", format: "date-time" },
            value: { description: "Sample value — type depends on channel." },
          },
        },
        Command: {
          type: "object",
          required: ["ts", "value"],
          properties: {
            ts: { type: "string", format: "date-time" },
            value: { description: "Command payload — type per class command." },
          },
        },
      },
    },
  };
}

/**
 * Fan out one device into N channels per its class definition.
 * @param channels Mutable channels map being built
 * @param operations Mutable operations map being built
 * @param siteId Topic-prefix site id (DTM deployment_uuid)
 * @param deviceId DTM device id whose channels are being added
 * @param cls Resolved class definition for the device
 */
function addClassChannels(
  channels: Record<string, Channel>,
  operations: Record<string, Operation>,
  siteId: string,
  deviceId: string,
  cls: DeviceClassType,
): void {
  for (const [name, meas] of Object.entries(cls.measurements ?? {})) {
    const key = `${deviceId}_${name}`;
    channels[key] = {
      address: `sites/${siteId}/devices/${deviceId}/measurements/${name}/${meas.unit}`,
      messages: { reading: { $ref: READING_REF } },
    };
    operations[`${key}_receive`] = {
      action: "receive",
      channel: { $ref: `#/channels/${key}` },
    };
  }
  for (const [name, cmd] of Object.entries(cls.commands ?? {})) {
    const key = `${deviceId}_${name}`;
    channels[key] = {
      address: `sites/${siteId}/devices/${deviceId}/commands/${cmd.verb}/${cmd.target}/${cmd.unit}`,
      messages: { command: { $ref: COMMAND_REF } },
    };
    operations[`${key}_send`] = {
      action: "send",
      channel: { $ref: `#/channels/${key}` },
    };
  }
}

/**
 * Fallback when a device's class is missing from the catalog.
 * @param channels Mutable channels map being built
 * @param operations Mutable operations map being built
 * @param siteId Topic-prefix site id (DTM deployment_uuid)
 * @param deviceId DTM device id whose placeholder channel is being added
 */
function addPlaceholderChannel(
  channels: Record<string, Channel>,
  operations: Record<string, Operation>,
  siteId: string,
  deviceId: string,
): void {
  const key = `${deviceId}_health`;
  channels[key] = {
    address: `sites/${siteId}/devices/${deviceId}/measurements/health/none`,
    messages: { reading: { $ref: READING_REF } },
  };
  operations[`${key}_receive`] = {
    action: "receive",
    channel: { $ref: `#/channels/${key}` },
  };
}
