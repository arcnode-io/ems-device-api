import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { diffDtm, nextVersion } from "./dtm_diff";
import type { DtmType, DeviceType } from "./dtm.schema";

const TEMPLATE_BESS = {
  template: "bess_module",
  kind: "module" as const,
  description: "BESS aggregate.",
  contains: [],
  measurements: {
    voltage_dc: {
      unit: "volts",
      type: "float" as const,
      publisher: "line_controller" as const,
    },
  },
  commands: {},
};

/**
 * Returns a minimal valid DTM for test arrangement.
 * @returns A DtmType with a single BESS device and no buses.
 */
function baseDtm(): DtmType {
  return {
    deployment_uuid: "123e4567-e89b-12d3-a456-426614174000",
    ems_mode: "sim",
    sizing_ref: null,
    sizing_params: {
      P_compute_total_kW: 100,
      E_BESS_total_kWh: 200,
      T_coolant_setpoint_C: 18,
    },
    devices: {
      bess_module_1: {
        device_id: "bess_module_1",
        template: "bess_module",
        parent: null,
        display_name: null,
        connection: null,
        blocking: ["live_mode"],
        extra_measurements: null,
      },
    },
    buses: [],
    templates_used: { bess_module: TEMPLATE_BESS as never },
  };
}

/**
 * Returns dtm with an additional device keyed by id.
 * @param dtm Base DTM to extend.
 * @param id device_id slug for the new device.
 * @returns New DTM with the extra device included.
 */
function withDevice(dtm: DtmType, id: string): DtmType {
  return {
    ...dtm,
    devices: {
      ...dtm.devices,
      [id]: {
        device_id: id,
        template: "bess_module",
        parent: null,
        display_name: null,
        connection: null,
        blocking: ["live_mode"],
        extra_measurements: null,
      },
    },
  };
}

describe("diffDtm — bootstrap", () => {
  it("prev null → bump=none, no reasons", () => {
    const diff = diffDtm(null, baseDtm());
    assert.equal(diff.bump, "none");
    assert.deepEqual(diff.reasons, []);
  });
});

describe("diffDtm — identical", () => {
  it("deep-equal DTMs → bump=none", () => {
    const diff = diffDtm(baseDtm(), baseDtm());
    assert.equal(diff.bump, "none");
    assert.deepEqual(diff.reasons, []);
  });
});

describe("diffDtm — device add/remove", () => {
  it("device added → minor", () => {
    const prev = baseDtm();
    const next = withDevice(prev, "bess_module_2");
    const diff = diffDtm(prev, next);
    assert.equal(diff.bump, "minor");
    assert.ok(
      diff.reasons.some((reason) =>
        reason.includes("device added: bess_module_2"),
      ),
    );
  });

  it("device removed → major", () => {
    const prev = withDevice(baseDtm(), "bess_module_2");
    const next = baseDtm();
    const diff = diffDtm(prev, next);
    assert.equal(diff.bump, "major");
    assert.ok(
      diff.reasons.some((reason) =>
        reason.includes("device removed: bess_module_2"),
      ),
    );
  });
});

describe("diffDtm — device template/parent", () => {
  it("device.template changed → major", () => {
    const prev = baseDtm();
    const next: DtmType = {
      ...prev,
      devices: {
        bess_module_1: {
          ...prev.devices.bess_module_1,
          template: "compute_module",
        } as DeviceType,
      },
      templates_used: {
        bess_module: TEMPLATE_BESS as never,
        compute_module: {
          ...TEMPLATE_BESS,
          template: "compute_module",
        } as never,
      },
    };
    const diff = diffDtm(prev, next);
    assert.equal(diff.bump, "major");
    assert.ok(
      diff.reasons.some((reason) => reason.includes("template changed")),
    );
  });

  it("device.parent changed → minor", () => {
    const prev = withDevice(baseDtm(), "bess_module_2");
    const next: DtmType = {
      ...prev,
      devices: {
        ...prev.devices,
        bess_module_1: {
          ...prev.devices.bess_module_1,
          parent: "bess_module_2",
        } as DeviceType,
      },
    };
    const diff = diffDtm(prev, next);
    assert.equal(diff.bump, "minor");
    assert.ok(diff.reasons.some((reason) => reason.includes("parent changed")));
  });
});

describe("diffDtm — patch-level", () => {
  it("device.display_name changed → patch", () => {
    const prev = baseDtm();
    const next: DtmType = {
      ...prev,
      devices: {
        bess_module_1: {
          ...prev.devices.bess_module_1,
          display_name: "Renamed",
        } as DeviceType,
      },
    };
    const diff = diffDtm(prev, next);
    assert.equal(diff.bump, "patch");
    assert.ok(
      diff.reasons.some((reason) => reason.includes("display_name changed")),
    );
  });

  it("device.connection changed → patch", () => {
    const prev = baseDtm();
    const next: DtmType = {
      ...prev,
      devices: {
        bess_module_1: {
          ...prev.devices.bess_module_1,
          connection: { host: "10.0.0.1", port: 502, unit_id: null },
        } as DeviceType,
      },
    };
    const diff = diffDtm(prev, next);
    assert.equal(diff.bump, "patch");
    assert.ok(
      diff.reasons.some((reason) => reason.includes("connection changed")),
    );
  });

  it("device.blocking changed → patch", () => {
    const prev = baseDtm();
    const next: DtmType = {
      ...prev,
      devices: {
        bess_module_1: {
          ...prev.devices.bess_module_1,
          blocking: ["live_mode", "commissioning_complete"],
        } as DeviceType,
      },
    };
    const diff = diffDtm(prev, next);
    assert.equal(diff.bump, "patch");
  });

  it("ems_mode changed → patch", () => {
    const prev = baseDtm();
    const next: DtmType = { ...prev, ems_mode: "live" };
    const diff = diffDtm(prev, next);
    assert.equal(diff.bump, "patch");
  });

  it("sizing_params changed → patch", () => {
    const prev = baseDtm();
    const next: DtmType = {
      ...prev,
      sizing_params: { ...prev.sizing_params, P_compute_total_kW: 200 },
    };
    const diff = diffDtm(prev, next);
    assert.equal(diff.bump, "patch");
  });

  it("sizing_ref changed → patch", () => {
    const prev = baseDtm();
    const next: DtmType = { ...prev, sizing_ref: "abc-123" };
    const diff = diffDtm(prev, next);
    assert.equal(diff.bump, "patch");
  });
});

describe("diffDtm — extra_measurements", () => {
  it("extra_measurements added → minor", () => {
    const prev = baseDtm();
    const next: DtmType = {
      ...prev,
      devices: {
        bess_module_1: {
          ...prev.devices.bess_module_1,
          extra_measurements: {
            new_signal: {
              unit: "volts",
              type: "float",
              publisher: "line_controller",
            } as never,
          },
        } as DeviceType,
      },
    };
    const diff = diffDtm(prev, next);
    assert.equal(diff.bump, "minor");
    assert.ok(
      diff.reasons.some((reason) =>
        reason.includes("extra_measurements added"),
      ),
    );
  });

  it("extra_measurements removed → major", () => {
    const prev: DtmType = {
      ...baseDtm(),
      devices: {
        bess_module_1: {
          ...baseDtm().devices.bess_module_1,
          extra_measurements: {
            old_signal: {
              unit: "volts",
              type: "float",
              publisher: "line_controller",
            } as never,
          },
        } as DeviceType,
      },
    };
    const next = baseDtm();
    const diff = diffDtm(prev, next);
    assert.equal(diff.bump, "major");
    assert.ok(
      diff.reasons.some((reason) =>
        reason.includes("extra_measurements removed"),
      ),
    );
  });
});

describe("diffDtm — buses", () => {
  it("bus added → minor", () => {
    const prev = baseDtm();
    const next: DtmType = {
      ...prev,
      buses: [{ bus_id: "ac_main", type: "ac", members: [] }],
    };
    const diff = diffDtm(prev, next);
    assert.equal(diff.bump, "minor");
  });

  it("bus removed → major", () => {
    const prev: DtmType = {
      ...baseDtm(),
      buses: [{ bus_id: "ac_main", type: "ac", members: [] }],
    };
    const next = baseDtm();
    const diff = diffDtm(prev, next);
    assert.equal(diff.bump, "major");
  });

  it("bus.type changed → major", () => {
    const prev: DtmType = {
      ...baseDtm(),
      buses: [{ bus_id: "ac_main", type: "ac", members: [] }],
    };
    const next: DtmType = {
      ...baseDtm(),
      buses: [{ bus_id: "ac_main", type: "dc", members: [] }],
    };
    const diff = diffDtm(prev, next);
    assert.equal(diff.bump, "major");
  });

  it("bus.members added → minor", () => {
    const prev: DtmType = {
      ...baseDtm(),
      buses: [{ bus_id: "ac_main", type: "ac", members: [] }],
    };
    const next: DtmType = {
      ...baseDtm(),
      buses: [
        {
          bus_id: "ac_main",
          type: "ac",
          members: [{ device_id: "bess_module_1", port: null }],
        },
      ],
    };
    const diff = diffDtm(prev, next);
    assert.equal(diff.bump, "minor");
  });
});

describe("diffDtm — templates_used", () => {
  it("templates_used body changed → major", () => {
    const prev = baseDtm();
    const next: DtmType = {
      ...prev,
      templates_used: {
        bess_module: { ...TEMPLATE_BESS, description: "different" } as never,
      },
    };
    const diff = diffDtm(prev, next);
    assert.equal(diff.bump, "major");
    assert.ok(
      diff.reasons.some((reason) => reason.includes("template body changed")),
    );
  });

  it("templates_used slug added → minor", () => {
    const prev = baseDtm();
    const next: DtmType = {
      ...prev,
      templates_used: {
        bess_module: TEMPLATE_BESS as never,
        compute_module: {
          ...TEMPLATE_BESS,
          template: "compute_module",
        } as never,
      },
    };
    const diff = diffDtm(prev, next);
    assert.equal(diff.bump, "minor");
  });
});

describe("diffDtm — top-level", () => {
  it("deployment_uuid changed → major", () => {
    const prev = baseDtm();
    const next: DtmType = {
      ...prev,
      deployment_uuid: "999e4567-e89b-12d3-a456-426614174000",
    };
    const diff = diffDtm(prev, next);
    assert.equal(diff.bump, "major");
  });
});

describe("diffDtm — severity hierarchy", () => {
  it("multiple changes → highest severity wins", () => {
    const prev = withDevice(baseDtm(), "bess_module_2");
    const next: DtmType = {
      ...baseDtm(),
      devices: {
        bess_module_1: {
          ...baseDtm().devices.bess_module_1,
          display_name: "Renamed",
        } as DeviceType,
      },
    };
    const diff = diffDtm(prev, next);
    assert.equal(diff.bump, "major");
    assert.ok(diff.reasons.length >= 2);
  });
});

describe("nextVersion", () => {
  it("prev null → 1.0.0", () => {
    assert.equal(nextVersion(null, { bump: "none", reasons: [] }), "1.0.0");
  });

  it("none bump → unchanged", () => {
    assert.equal(nextVersion("2.4.7", { bump: "none", reasons: [] }), "2.4.7");
  });

  it("patch bump", () => {
    assert.equal(nextVersion("2.4.7", { bump: "patch", reasons: [] }), "2.4.8");
  });

  it("minor bump resets patch", () => {
    assert.equal(nextVersion("2.4.7", { bump: "minor", reasons: [] }), "2.5.0");
  });

  it("major bump resets minor + patch", () => {
    assert.equal(nextVersion("2.4.7", { bump: "major", reasons: [] }), "3.0.0");
  });
});
