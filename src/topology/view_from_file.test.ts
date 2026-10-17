import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { viewFromFile } from "./view_from_file";

const STUB_DTM = {
  deployment_uuid: "123e4567-e89b-12d3-a456-426614174000",
  sizing_params: {
    P_compute_total_kW: 100.0,
    E_BESS_total_kWh: 200.0,
    T_coolant_setpoint_C: 18.0,
  },
  devices: {
    pump_01: {
      device_id: "pump_01",
      template: "pump",
      connection: { host: "10.0.0.5", port: 502 },
    },
  },
  buses: [],
  templates_used: {
    pump: {
      template: "pump",
      kind: "leaf",
      equipment_id: "PMP-001",
      vendor: "stub",
      model: "stub",
      description: "stub pump",
      measurements: {
        state: {
          unit: "none",
          type: "enum",
          values: { "0": "OFF", "1": "ON" },
          binding: {
            protocol: "modbus_tcp",
            function_code: 3,
            address: 1,
            value_map: { "0": "OFF", "1": "ON" },
          },
        },
      },
    },
  },
};

/**
 * Write a DTM to a throwaway file.
 * @param dtm DTM body
 * @returns Path to the file
 */
function writeDtm(dtm: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "view-from-file-"));
  const file = path.join(dir, "dtm.json");
  fs.writeFileSync(file, JSON.stringify(dtm));
  return file;
}

describe("viewFromFile", () => {
  it("refuses a template the catalog doesn't carry, as POST /topology does", () => {
    // Arrange
    const file = writeDtm(STUB_DTM);

    // Act + Assert
    assert.throws(() => viewFromFile(file, {}), BadRequestException);
  });
});
