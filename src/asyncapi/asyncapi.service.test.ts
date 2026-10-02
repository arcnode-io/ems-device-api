/**
 * Unit tests for AsyncapiService — specifically that a persisted DTM the
 * current contract can't serve becomes a 503 naming what to do, not a bare 500.
 */

import "reflect-metadata";
import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import { AsyncapiService } from "./asyncapi.service";
import type { TopologyService } from "../topology/topology.service";

/**
 * AsyncapiService wired to a topology stub returning one row.
 * @param dtm The persisted DTM to serve
 * @param version The row's version
 * @returns A service instance backed by that row
 */
function serviceWithRow(dtm: unknown, version: string): AsyncapiService {
  const topology = {
    getLatestRow: () => Promise.resolve({ dtm, version }),
  } as unknown as TopologyService;
  return new AsyncapiService(topology);
}

describe("AsyncapiService", () => {
  it("row the contract can't serve → 503 naming the version and the fix", async () => {
    // Arrange — any row buildSpec rejects; a narrowed field is one way there.
    const service = serviceWithRow({}, "1.0.11");

    // Act / Assert — 503, not 500: the row is stale, the service is fine, and
    // the caller needs to know a POST /topology clears it.
    await assert.rejects(
      () => service.generateSpec(),
      (err: unknown) => {
        assert.ok(err instanceof ServiceUnavailableException);
        assert.match(err.message, /1\.0\.11/);
        assert.match(err.message, /POST \/topology/);
        return true;
      },
    );
  });

  it("no DTM yet → null, so the controller can 404", async () => {
    // Arrange
    const topology = {
      getLatestRow: () => Promise.resolve(null),
    } as unknown as TopologyService;

    // Act
    const spec = await new AsyncapiService(topology).generateSpec();

    // Assert
    assert.equal(spec, null);
  });
});
