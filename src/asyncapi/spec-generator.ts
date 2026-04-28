/**
 * Top-level AsyncAPI v3 spec builder.
 *
 * Produces the wire shape mandated by ADR-002: templated channels with
 * parameters (one per family × wire-type), operation-level MQTT bindings,
 * four sample schemas under components, top-level x-protocol-source map
 * for gateway codegen, and x-enum-values for HMI typed-union codegen.
 *
 * Channels and components are class-agnostic at the spec level — per-device
 * variability lives entirely in the x-* extensions, keeping the channel
 * count constant regardless of deployment size.
 */

import type { DtmType } from "../topology/dtm.schema";
import type { DeviceClassType } from "../classes/class.schema";
import type { ClassLookup } from "./types";
import { buildComponents } from "./spec-components";
import { buildChannels, buildOperations } from "./spec-channels";
import {
  buildProtocolSourceMap,
  buildEnumValuesMap,
  type ProtocolSourceMap,
  type EnumValuesMap,
} from "./spec-extensions";

const SPEC_VERSION = "3.0.0";
const MQTT_BINDING_VERSION = "0.2.0";

/** Default MQTT broker server entry. Customer overrides via cfg/secrets. */
const DEFAULT_SERVERS: Record<string, unknown> = {
  production: {
    host: "{host}:{port}",
    protocol: "secure-mqtt",
    protocolVersion: "5",
    description:
      "Per-deployment MQTT broker. Variables resolved from operator config.",
    variables: {
      host: { default: "mqtt.local", description: "Broker host" },
      port: { default: "8883", description: "Broker port (TLS)" },
    },
    bindings: {
      mqtt: {
        clientId: "{client_id}",
        cleanSession: false,
        keepAlive: 60,
        bindingVersion: MQTT_BINDING_VERSION,
      },
    },
  },
};

interface AsyncApi3Spec {
  asyncapi: string;
  info: { title: string; version: string; description: string };
  servers: Record<string, unknown>;
  channels: Record<string, unknown>;
  operations: Record<string, unknown>;
  components: {
    messages: Record<string, unknown>;
    schemas: Record<string, unknown>;
  };
  "x-protocol-source": ProtocolSourceMap;
  "x-enum-values": EnumValuesMap;
}

export type { ClassLookup } from "./types";

/**
 * Build the full AsyncAPI v3 spec from the persisted DTM and class catalog.
 * @param dtm Validated Device Topology Manifest (latest persisted)
 * @param lookup Resolves a class ref like `bess_module.v1` to its definition
 * @param classes All loaded classes — used for enum-vocabulary projection
 *                regardless of whether the DTM currently references them
 * @returns The AsyncAPI 3.0.0 spec ready for JSON / YAML serialization
 */
export function buildSpec(
  dtm: DtmType,
  lookup: ClassLookup,
  classes: readonly DeviceClassType[],
): AsyncApi3Spec {
  return {
    asyncapi: SPEC_VERSION,
    info: {
      title: `ARCNODE EMS — ${dtm.deployment_uuid}`,
      version: dtm.dtm_version,
      description: `AsyncAPI v3 contract generated from DTM ${dtm.deployment_uuid}.`,
    },
    servers: DEFAULT_SERVERS,
    channels: buildChannels(),
    operations: buildOperations(),
    components: buildComponents(classes),
    "x-protocol-source": buildProtocolSourceMap(dtm, lookup),
    "x-enum-values": buildEnumValuesMap(classes),
  };
}
