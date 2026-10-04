/**
 * Top-level AsyncAPI v3 spec builder.
 *
 * Produces the wire shape mandated by ADR-002: templated channels with
 * parameters (one per family × wire-type), operation-level MQTT bindings,
 * four sample schemas under components, top-level x-protocol-source /
 * x-command-source maps for gateway codegen, and x-enum-values for HMI
 * typed-union codegen.
 *
 * Channels and components are template-agnostic at the spec level —
 * per-device variability lives entirely in the x-* extensions, keeping the
 * channel count constant regardless of deployment size. Per-template enum
 * vocabulary is derived from `dtm.templates_used`, which the DTM author
 * (`edp-api`) embeds in the payload.
 */

import type { DtmType } from "../topology/dtm.schema";
import { buildComponents } from "./spec-components";
import { buildChannels, buildOperations } from "./spec-channels";
import {
  buildAlarmsMap,
  buildProtocolSourceMap,
  buildCommandSourceMap,
  buildEnumValuesMap,
  type AlarmsMap,
  type ProtocolSourceMap,
  type CommandSourceMap,
  type EnumValuesMap,
} from "./spec-extensions";
import {
  validateProtocolSourceMap,
  validateCommandSourceMap,
} from "./spec-contract";

const SPEC_VERSION = "3.0.0";

/**
 * Identifies the generator that produced this spec, so a consumer can tell two specs apart when
 * the topology behind them is identical.
 *
 * Bump it whenever the *generated shape* changes — a new resolved field, a renamed one, a changed
 * payload. It is not a build number: a deploy that produces an identical spec should not make
 * every consumer reconcile.
 *
 * Reason: `info.version` otherwise came from the topology version alone, which changes only when a
 * DTM is submitted. Deploying new generator code therefore changed the spec's content while its
 * version stayed put, no `system/topology_changed` beacon fired, and a consumer that reconciles on
 * version never re-fetched — so new resolver fields were live in the code and silently absent from
 * what the gateway actually held.
 *
 * Carried as semver build metadata, which reads correctly to a human and changes the string for
 * anyone comparing versions for equality. Note that semver defines build metadata as ignored for
 * precedence*, so a consumer must compare these for difference rather than ordering — which is
 * also why the value is published on its own as `x-generator-version`.
 */
const SPEC_GENERATOR_VERSION = "gen.1";
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
  "x-generator-version": string;
  "x-protocol-source": ProtocolSourceMap;
  "x-command-source": CommandSourceMap;
  "x-enum-values": EnumValuesMap;
  "x-alarms": AlarmsMap;
}

/**
 * Build the full AsyncAPI v3 spec from the self-describing persisted DTM.
 * @param dtm Validated Device Topology Manifest (latest persisted) — its
 *            `templates_used` map provides every template referenced by
 *            `devices`, removing the need for a separate catalog lookup.
 * @param version Semver assigned to this DTM by TopologyService.save
 *            per ADR-002 §10. Embedded as info.version, suffixed with
 *            SPEC_GENERATOR_VERSION so a consumer can tell two specs apart when
 *            the topology behind them is identical.
 * @returns The AsyncAPI 3.0.0 spec ready for JSON / YAML serialization
 */
export function buildSpec(dtm: DtmType, version: string): AsyncApi3Spec {
  const templates = Object.values(dtm.templates_used);
  return {
    asyncapi: SPEC_VERSION,
    info: {
      title: `ARCNODE EMS — ${dtm.deployment_uuid}`,
      version: `${version}+${SPEC_GENERATOR_VERSION}`,
      description: `AsyncAPI v3 contract generated from DTM ${dtm.deployment_uuid}.`,
    },
    servers: DEFAULT_SERVERS,
    channels: buildChannels(dtm),
    operations: buildOperations(),
    components: buildComponents(templates),
    // Self-validated against the real contract (spec-contract.ts) rather
    // than trusted blindly — catches drift between the resolvers and the
    // published schema at generation time, not just in tests.
    "x-generator-version": SPEC_GENERATOR_VERSION,
    "x-protocol-source": validateProtocolSourceMap(buildProtocolSourceMap(dtm)),
    "x-command-source": validateCommandSourceMap(buildCommandSourceMap(dtm)),
    "x-enum-values": buildEnumValuesMap(templates),
    "x-alarms": buildAlarmsMap(dtm),
  };
}
