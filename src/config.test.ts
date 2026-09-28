/**
 * Unit tests for config block selection. $ENV names the cfg.yml block, so adding a block is
 * enough to add a profile — and a name with no block fails loudly rather than quietly running
 * `local`, which inside a container would mean a localhost broker and a relative template path.
 */

import "reflect-metadata";
import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  /**
   * Runs `loadConfig` with $ENV set to a chosen value, restoring it afterwards.
   * @param value The ENV value to use, or undefined to leave it unset
   * @param run What to execute while ENV is set
   * @returns Whatever `run` returns
   */
  function withEnv<T>(value: string | undefined, run: () => T): T {
    const previous = process.env.ENV;
    if (value === undefined) delete process.env.ENV;
    else process.env.ENV = value;
    try {
      return run();
    } finally {
      if (previous === undefined) delete process.env.ENV;
      else process.env.ENV = previous;
    }
  }

  it("selects the block $ENV names", () => {
    // Act
    const config = withEnv("device-demo", () => loadConfig());

    // Assert: the demo stack's broker, not localhost
    assert.equal(config.mqttBrokerUrl, "mqtt://hivemq:1883");
    assert.equal(config.templateCatalogRoot, "/app/device_templates");
  });

  it("defaults to local when $ENV is unset", () => {
    // Act
    const config = withEnv(undefined, () => loadConfig());

    // Assert
    assert.equal(config.mqttBrokerUrl, "mqtt://localhost:1883");
  });

  it("throws when $ENV names no block", () => {
    // Arrange: silently falling back to local would put a container on a localhost broker and
    // present as a connection bug rather than a misconfiguration
    // Act / Assert
    assert.throws(() => withEnv("nope", () => loadConfig()), /nope/);
  });
});
