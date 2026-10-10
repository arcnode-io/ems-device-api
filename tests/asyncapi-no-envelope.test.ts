/**
 * Integration — a real edp-api DTM for a commissioning-stage order (compute,
 * one BESS module, one rack; no poi_meter, no operating_envelope, no
 * der_dispatch) must still yield a spec. The gateway starts on it with the
 * parts that need the envelope left out, not a 503.
 */
import * as assert from "assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, test } from "node:test";
import { buildSpec } from "../src/asyncapi/spec-generator";
import { Dtm } from "../src/topology/dtm.schema";

const FIXTURE = Dtm.parse(
  JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "fixtures", "dtm_no_envelope.json"),
      "utf-8",
    ),
  ),
);

type SourceMap = Record<string, Record<string, Record<string, unknown>>>;

describe("AsyncAPI on a topology with no POI meter and no operating envelope", () => {
  test("the spec builds, without the channels and guards that need them", () => {
    // Arrange
    const dtm = FIXTURE;

    // Act
    const spec = buildSpec(dtm, "1.0.0") as unknown as {
      "x-protocol-source": SourceMap;
      "x-command-source": SourceMap;
    };

    // Assert — headroom can only be computed against the meter and the envelope
    const bessMeasurements = spec["x-protocol-source"]["bess_module_1"]!;
    assert.equal(bessMeasurements["import_headroom"], undefined);
    assert.equal(bessMeasurements["export_headroom"], undefined);
    assert.ok(
      bessMeasurements["state_of_charge"],
      "rack rollups still resolve",
    );
    // the dispatch itself still exists, unguarded: nothing to guard against
    const dispatch =
      spec["x-command-source"]["bess_module_1"]!["set_active_power"]!;
    assert.equal(dispatch["protocol"], "distribute");
    assert.ok(Array.isArray(dispatch["children"]));
    assert.equal(dispatch["import_limit_topic"], undefined);
    assert.equal(dispatch["poi_active_power_topic"], undefined);
    const cap =
      spec["x-command-source"]["compute_module_1"]!["set_power_limit"]!;
    assert.equal(cap["protocol"], "power_cap");
    assert.equal(cap["import_limit_topic"], undefined);
  });
});
