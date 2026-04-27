/**
 * Pure builder: DTM → AsyncAPI v3 spec object.
 *
 * MVP scope (option A): one channel per device with a generic `health` measurement
 * topic per ADR-002 (`sites/{site_id}/devices/{device_id}/measurements/health/none`).
 * No per-channel `x-modbus` / `x-source` bindings yet — those land in the next slice
 * once the device class catalog is wired in.
 */

import type { DtmType } from "../topology/dtm.schema";

const SPEC_VERSION = "3.0.0";
const READING_SCHEMA_REF = "#/components/schemas/Reading";

interface Channel {
  address: string;
  messages: Record<string, { $ref: string }>;
}

interface AsyncApiSpec {
  asyncapi: string;
  info: { title: string; version: string; description: string };
  channels: Record<string, Channel>;
  operations: Record<string, { action: "receive"; channel: { $ref: string } }>;
  components: {
    messages: Record<string, { name: string; payload: { $ref: string } }>;
    schemas: Record<string, unknown>;
  };
}

/**
 * Build the AsyncAPI v3 spec from a DTM.
 * @param dtm Validated Device Topology Manifest
 * @returns The AsyncAPI 3.0.0 spec
 */
export function buildSpec(dtm: DtmType): AsyncApiSpec {
  const siteId = dtm.deployment_uuid;
  const channels: Record<string, Channel> = {};
  const operations: Record<
    string,
    { action: "receive"; channel: { $ref: string } }
  > = {};

  for (const deviceId of Object.keys(dtm.devices)) {
    const channelKey = `${deviceId}_health`;
    channels[channelKey] = {
      address: `sites/${siteId}/devices/${deviceId}/measurements/health/none`,
      messages: {
        reading: { $ref: "#/components/messages/Reading" },
      },
    };
    operations[`${channelKey}_receive`] = {
      action: "receive",
      channel: { $ref: `#/channels/${channelKey}` },
    };
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
        Reading: {
          name: "Reading",
          payload: { $ref: READING_SCHEMA_REF },
        },
      },
      schemas: {
        Reading: {
          type: "object",
          required: ["ts", "value"],
          properties: {
            ts: {
              type: "string",
              format: "date-time",
              description: "RFC3339 / ISO8601 sample timestamp (Z suffix).",
            },
            value: {
              description: "Sample value — type depends on the channel.",
            },
          },
        },
      },
    },
  };
}
