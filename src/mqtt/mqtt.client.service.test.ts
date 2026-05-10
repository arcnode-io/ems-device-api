/** Unit tests for MqttClientService — mocked client. */

import { describe, it, mock } from "node:test";
import { strict as assert } from "node:assert";
import type { ConfigService } from "@nestjs/config";
import type { MqttClient } from "mqtt";
import { MqttClientService } from "./mqtt.client.service";

/**
 * Build a stub ConfigService that always returns the given URL.
 * @param url Mqtt broker URL the stub should serve to consumers
 * @returns A minimal ConfigService stub
 */
function makeCfg(url: string): ConfigService {
  return { get: () => url } as unknown as ConfigService;
}

interface FakeClient {
  connected: boolean;
  publishCalls: Array<{
    topic: string;
    payload: string;
    opts: Record<string, unknown>;
  }>;
}

/**
 * Build a fake MqttClient that records publish calls.
 * @param connected Initial connected state of the fake client
 * @returns A FakeClient typed as MqttClient with a publishCalls array
 */
function makeClient(connected: boolean): MqttClient & FakeClient {
  const calls: FakeClient["publishCalls"] = [];
  const fake = {
    connected,
    publishCalls: calls,
    on: mock.fn(),
    publish: mock.fn(
      (
        topic: string,
        payload: string,
        opts: Record<string, unknown>,
        cb?: (err?: Error) => void,
      ) => {
        calls.push({ topic, payload, opts });
        if (cb) cb();
      },
    ),
    endAsync: mock.fn(() => Promise.resolve(undefined)),
  };
  return fake as unknown as MqttClient & FakeClient;
}

describe("MqttClientService", () => {
  it("publishTopologyChanged sends correct topic + payload + opts", () => {
    // Arrange
    const fake = makeClient(true);
    const svc = new MqttClientService(makeCfg("mqtt://test:1883"));
    (svc as unknown as { client: MqttClient }).client = fake;
    // Act
    svc.publishTopologyChanged("1.0.42");
    // Assert
    assert.equal(fake.publishCalls.length, 1);
    const call = fake.publishCalls[0];
    assert.ok(call !== undefined);
    assert.equal(call.topic, "system/topology_changed");
    const parsed = JSON.parse(call.payload) as { ts: string; version: string };
    assert.equal(parsed.version, "1.0.42");
    assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(call.opts, { qos: 1, retain: false });
  });

  it("publishTopologyChanged drops + logs when disconnected", () => {
    // Arrange
    const fake = makeClient(false);
    const svc = new MqttClientService(makeCfg("mqtt://test:1883"));
    (svc as unknown as { client: MqttClient }).client = fake;
    // Act
    svc.publishTopologyChanged("1.0.42");
    // Assert
    assert.equal(fake.publishCalls.length, 0);
  });

  it("publishTopologyChanged is a no-op before onModuleInit", () => {
    // Arrange — client property never set
    const svc = new MqttClientService(makeCfg("mqtt://test:1883"));
    // Act / Assert — should not throw
    svc.publishTopologyChanged("1.0.0");
  });
});
