# PR 3 — ems-device-api Migration to Canonical DTM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `ems-device-api`'s Zod schemas + topology service to consume the canonical Dtm shape that edp-api now emits (PR 1 + PR 2). Bundle the `device_templates/` catalog from edp-api into the device-api Docker image at build time. Add cross-template referential-integrity validation at POST /topology so authoring drift is caught at the boundary.

**Architecture:** Mirror the Pydantic → Zod for the canonical Dtm + DeviceTemplate schemas. Add a NestJS-injectable `TemplateLoaderService` that walks the bundled `/app/device_templates/` directory at startup. Topology controller validates incoming DTMs against (a) Zod schema (structural + parent-chain + bus-member referential integrity, expressed via Zod `.refine()`), and (b) catalog-resolution check (every `device.template` resolves against the bundled catalog OR the inline `templates_used`). Reject with 400 + ZodError details on failure.

**Tech Stack:** TypeScript 5.x, NestJS 11, Zod 4, nestjs-zod, TypeORM, yaml package, node --test runner. Existing patterns from `src/topology/topology.controller.ts` and `src/templates/template.schema.ts`.

**Reference:**
- `ems/docs/superpowers/specs/2026-05-09-redo-device-api-foundation-design.md` — canonical Dtm + template schema sections
- edp-api PR 2 (already shipped): `src/shared/schemas/dtm.py` + `src/shared/schemas/template.py` + `src/dtm/template_loader.py` are the Pydantic source of truth this PR mirrors
- `arcnode/ems/topic_structure_adr.md` ADR-002 §7 (templates), §9 (slug), §14 (CRUD endpoints, future)

---

## Verification Gate (mandatory)

After every small step, run:

```bash
npm run checks && npm run unit
```

`npm run checks` runs depcheck + format + typecheck + security + lint. `npm run unit` runs `node --test src/**/*.test.ts`. After files in `tests/` change, also run `npm run integration`. Final pipeline before push runs `npm run test` (unit + integration combined) plus `npm run cover` for coverage.

If either fails, fix before the next step. Targeted `node --test src/path/file.test.ts` invocations are in addition to the gate, not a substitute.

---

## File Structure

**Replace:**
- `src/topology/dtm.schema.ts` — full rewrite. Mirror the canonical Pydantic Dtm shape: `Connection`, `Device`, `BusMember`, `Bus`, `Dtm` keyed by snake_case slug, embedded `templates_used`. Drops the existing `DtmDevice` / `DtmType` shape that lives there today.
- `src/templates/template.schema.ts` — full rewrite. Mirror the Pydantic DeviceTemplate: `Binding` discriminated union, `Measurement`, `Command`, `ContainsEntry`, `DeviceTemplate` with kind/equipment_id/vendor/model validators.
- `src/topology/topology.controller.ts` — replace inline `ZodValidationPipe(Dtm)` with a service-layer validation flow that runs Zod parse first, then a catalog-resolution check.
- `src/topology/topology.service.ts` — add `validateAgainstCatalog(dtm: DtmType): void` method. Throws `BadRequestException` if a referenced template isn't in the bundled catalog.
- `src/topology/topology.entity.ts` — leave as-is if the JSON column accepts the new shape; otherwise update column type only (no migration since no production data).
- `src/topology/topology.module.ts` — import the new `TemplatesModule`.

**Create:**
- `src/templates/template_loader.service.ts` — NestJS service that walks `<root>/{leaf,module}/*.yaml`, validates each via Zod, exposes `getCatalog()`. Mirrors `edp-api/src/dtm/template_loader.py`.
- `src/templates/templates.module.ts` — NestJS module exporting `TemplateLoaderService`.
- `src/templates/template_loader.service.test.ts` — unit tests using `tmp` fixtures.
- Tests for the new schemas: `src/topology/dtm.schema.test.ts`, `src/templates/template.schema.test.ts`.

**Modify (build/CI):**
- `Dockerfile` — add a step in the builder stage that fetches `edp-api/device_templates/` and bakes it into the production image at `/app/device_templates/`.
- `.gitlab-ci.yml` — none required if the Docker build does the fetch (next-best alternative is a CI step that prepares the templates directory before `docker build`).

**Out of scope for PR 3:**
- AsyncAPI generation off the new shape (sub-project C).
- The day-1 boot wiring that loads from `/etc/ems/dtm.json` (sub-project B).
- Dynamic CRUD endpoints (POST/PUT/DELETE /devices) per ADR-002 §14 (future PR).

---

## Task 1: Mirror DeviceTemplate Zod Schema

**Files:**
- Modify: `src/templates/template.schema.ts` (full rewrite)
- Create: `src/templates/template.schema.test.ts`

The Pydantic source is `edp-api/src/shared/schemas/template.py` + `template_protocols.py`. Mirror it exactly in shape so a DTM emitted by edp-api parses cleanly here.

- [ ] **Step 1: Write failing tests for the new schema**

Tests should cover the same surface the Pydantic tests cover (template_kind values, binding variants, measurement/command XOR validators, DeviceTemplate kind/equipment_id/vendor/model rules, slug format, `extra="forbid"`-equivalent in Zod via `.strict()`).

```typescript
// src/templates/template.schema.test.ts
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  Binding,
  Command,
  ContainsEntry,
  DeviceTemplate,
  Fanout,
  Measurement,
  Publisher,
  TemplateKind,
} from "./template.schema";


describe("TemplateKind / Publisher / Fanout enums", () => {
  it("TemplateKind values are leaf | module", () => {
    assert.equal(TemplateKind.parse("leaf"), "leaf");
    assert.equal(TemplateKind.parse("module"), "module");
    assert.throws(() => TemplateKind.parse("other"));
  });

  it("Publisher values", () => {
    assert.equal(Publisher.parse("line_controller"), "line_controller");
    assert.equal(Publisher.parse("analyst"), "analyst");
    assert.throws(() => Publisher.parse("nope"));
  });

  it("Fanout values", () => {
    assert.equal(Fanout.parse("line_controller"), "line_controller");
  });
});

describe("Binding discriminated union", () => {
  it("modbus_tcp binding parses", () => {
    const b = Binding.parse({
      protocol: "modbus_tcp",
      function_code: 4,
      address: 100,
      data_type: "int16",
      scale: 0.1,
    });
    assert.equal(b.protocol, "modbus_tcp");
    if (b.protocol === "modbus_tcp") {
      assert.equal(b.scale, 0.1);
    }
  });

  it("dnp3_tcp binding parses", () => {
    const b = Binding.parse({
      protocol: "dnp3_tcp",
      point_index: 10,
      point_type: "analog_input",
    });
    assert.equal(b.protocol, "dnp3_tcp");
  });

  it("snmp / redfish / canopen_gw bindings parse", () => {
    Binding.parse({ protocol: "snmp", oid: "1.3.6.1.4.1.1718.4.1.3.3.1.7" });
    Binding.parse({
      protocol: "redfish",
      uri: "/Chassis/1/Power",
      json_pointer: "/PowerControl/0/PowerConsumedWatts",
    });
    Binding.parse({
      protocol: "canopen_gw",
      cob_id: 0x180,
      byte_offset: 0,
      byte_length: 2,
    });
  });

  it("rejects unknown protocol", () => {
    assert.throws(() => Binding.parse({ protocol: "bacnet", foo: "bar" }));
  });
});

describe("Measurement", () => {
  it("with binding parses", () => {
    const m = Measurement.parse({
      unit: "volts",
      type: "float",
      poll_rate_hz: 1,
      binding: { protocol: "modbus_tcp", function_code: 4, address: 100 },
    });
    assert.equal(m.unit, "volts");
    assert.equal(m.publisher, undefined);
  });

  it("with publisher parses", () => {
    const m = Measurement.parse({
      unit: "percent",
      type: "float",
      publisher: "line_controller",
    });
    assert.equal(m.publisher, "line_controller");
  });

  it("rejects both binding and publisher", () => {
    assert.throws(
      () =>
        Measurement.parse({
          unit: "volts",
          type: "float",
          binding: { protocol: "modbus_tcp", function_code: 4, address: 100 },
          publisher: "line_controller",
        }),
      /exactly one of/,
    );
  });

  it("rejects neither binding nor publisher", () => {
    assert.throws(
      () => Measurement.parse({ unit: "volts", type: "float" }),
      /exactly one of/,
    );
  });

  it("type=enum requires values", () => {
    assert.throws(
      () =>
        Measurement.parse({
          unit: "none",
          type: "enum",
          binding: { protocol: "modbus_tcp", function_code: 3, address: 200 },
        }),
      /values required/,
    );
  });
});

describe("Command", () => {
  it("with binding parses", () => {
    const c = Command.parse({
      verb: "reset",
      target: "counters",
      unit: "none",
      payload: "trigger",
      binding: { protocol: "modbus_tcp", function_code: 6, address: 300 },
    });
    assert.equal(c.verb, "reset");
  });

  it("with fanout parses", () => {
    const c = Command.parse({
      verb: "set",
      target: "active_power",
      unit: "watts",
      payload: "float",
      fanout: "line_controller",
    });
    assert.equal(c.fanout, "line_controller");
  });

  it("rejects both binding and fanout", () => {
    assert.throws(
      () =>
        Command.parse({
          verb: "set",
          target: "active_power",
          unit: "watts",
          payload: "float",
          binding: { protocol: "modbus_tcp", function_code: 6, address: 400 },
          fanout: "line_controller",
        }),
      /exactly one of/,
    );
  });
});

describe("DeviceTemplate", () => {
  const minimalLeaf = {
    template: "revenue_meter",
    kind: "leaf",
    equipment_id: "GRD-MTR-001",
    vendor: "Schneider",
    model: "ION9000",
    description: "t",
    measurements: {
      voltage_a: {
        unit: "volts",
        type: "float",
        binding: { protocol: "modbus_tcp", function_code: 4, address: 100 },
      },
    },
  };

  it("minimal leaf parses", () => {
    const t = DeviceTemplate.parse(minimalLeaf);
    assert.equal(t.kind, "leaf");
    assert.equal(t.equipment_id, "GRD-MTR-001");
  });

  it("minimal module parses", () => {
    const t = DeviceTemplate.parse({
      template: "bess_module",
      kind: "module",
      description: "agg",
      contains: [{ template: "bess_rack", qty: "scalable" }],
      measurements: {
        soc: { unit: "percent", type: "float", publisher: "line_controller" },
      },
    });
    assert.equal(t.kind, "module");
  });

  it("leaf without equipment_id rejected", () => {
    const bad = { ...minimalLeaf, equipment_id: undefined };
    assert.throws(() => DeviceTemplate.parse(bad), /equipment_id required/);
  });

  it("module with equipment_id rejected", () => {
    assert.throws(
      () =>
        DeviceTemplate.parse({
          template: "bess_module",
          kind: "module",
          equipment_id: "X",
          description: "x",
          measurements: {
            soc: { unit: "percent", type: "float", publisher: "line_controller" },
          },
        }),
      /equipment_id forbidden/,
    );
  });

  it("template without channels rejected", () => {
    assert.throws(
      () => DeviceTemplate.parse({ ...minimalLeaf, measurements: undefined }),
      /at least one of measurements or commands/,
    );
  });

  it("invalid slug rejected", () => {
    assert.throws(
      () => DeviceTemplate.parse({ ...minimalLeaf, template: "Revenue-Meter" }),
      /slug/,
    );
  });

  it("unknown field rejected (strict)", () => {
    assert.throws(
      () => DeviceTemplate.parse({ ...minimalLeaf, foo: "bar" }),
      /unrecognized/i,
    );
  });
});
```

Run `node --test src/templates/template.schema.test.ts`. Expect failures (schema not yet rewritten). Then run gate.

- [ ] **Step 2: Implement `src/templates/template.schema.ts`** (full rewrite)

Use Zod 4 patterns:
- `z.discriminatedUnion("protocol", [...])` for `Binding`
- `z.enum([...])` for `TemplateKind`, `Publisher`, `Fanout`, the verb/payload literals, the data_type/word_order/point_type enums
- `.strict()` (or `z.strictObject`) on every model so unknown keys throw — equivalent to Pydantic `extra="forbid"`
- `.refine((data) => ...)` for cross-field validators (Measurement xor, DeviceTemplate kind/equipment_id, etc.)

Sketch:

```typescript
// src/templates/template.schema.ts
import { z } from "zod";

export const TemplateKind = z.enum(["leaf", "module"]);
export type TemplateKindType = z.infer<typeof TemplateKind>;

export const Publisher = z.enum(["line_controller", "analyst"]);
export type PublisherType = z.infer<typeof Publisher>;

export const Fanout = z.enum(["line_controller"]);
export type FanoutType = z.infer<typeof Fanout>;

export const ModbusBinding = z.strictObject({
  protocol: z.literal("modbus_tcp"),
  function_code: z.number().int(),
  address: z.number().int(),
  data_type: z
    .enum(["int16", "uint16", "int32", "uint32", "float32"])
    .default("int16"),
  word_order: z.enum(["high_low", "low_high"]).default("high_low"),
  scale: z.number().default(1.0),
  offset: z.number().default(0.0),
});

export const Dnp3Binding = z.strictObject({
  protocol: z.literal("dnp3_tcp"),
  point_index: z.number().int(),
  point_type: z.enum([
    "analog_input",
    "binary_input",
    "analog_output",
    "binary_output",
    "counter",
  ]),
});

export const SnmpBinding = z.strictObject({
  protocol: z.literal("snmp"),
  oid: z.string(),
});

export const RedfishBinding = z.strictObject({
  protocol: z.literal("redfish"),
  uri: z.string(),
  json_pointer: z.string().nullish(),
});

export const CanopenBinding = z.strictObject({
  protocol: z.literal("canopen_gw"),
  cob_id: z.number().int(),
  byte_offset: z.number().int(),
  byte_length: z.number().int(),
});

export const Binding = z.discriminatedUnion("protocol", [
  ModbusBinding,
  Dnp3Binding,
  SnmpBinding,
  RedfishBinding,
  CanopenBinding,
]);
export type BindingType = z.infer<typeof Binding>;

export const Measurement = z
  .strictObject({
    unit: z.string(),
    type: z.enum(["float", "bool", "enum"]),
    poll_rate_hz: z.number().nullish(),
    display_name_default: z.string().nullish(),
    iec_61850_ref: z.string().nullish(),
    values: z.record(z.string(), z.string()).nullish(),
    binding: Binding.nullish(),
    publisher: Publisher.nullish(),
  })
  .refine(
    (m) => Boolean(m.binding) !== Boolean(m.publisher),
    "measurement requires exactly one of binding (gateway-bound) or publisher (rollup)",
  )
  .refine(
    (m) => (m.type === "enum" ? Boolean(m.values) : !m.values),
    "type=enum requires values; values forbidden for non-enum",
  );
export type MeasurementType = z.infer<typeof Measurement>;

export const Command = z
  .strictObject({
    verb: z.enum([
      "set",
      "reset",
      "clear",
      "start",
      "stop",
      "enable",
      "disable",
    ]),
    target: z.string(),
    unit: z.string(),
    payload: z.enum(["float", "bool", "enum", "trigger"]),
    display_name_default: z.string().nullish(),
    binding: Binding.nullish(),
    fanout: Fanout.nullish(),
  })
  .refine(
    (c) => Boolean(c.binding) !== Boolean(c.fanout),
    "command requires exactly one of binding (gateway-bound) or fanout (line-controller-handled)",
  );
export type CommandType = z.infer<typeof Command>;

export const ContainsEntry = z.strictObject({
  template: z.string(),
  qty: z.union([z.literal("scalable"), z.number().int().positive()]).default("scalable"),
});
export type ContainsEntryType = z.infer<typeof ContainsEntry>;

const SLUG_RE = /^[a-z][a-z0-9_]{0,62}[a-z0-9]$/;

export const DeviceTemplate = z
  .strictObject({
    template: z.string().regex(SLUG_RE, "template slug must be snake_case"),
    kind: TemplateKind,
    equipment_id: z.string().nullish(),
    vendor: z.string().nullish(),
    model: z.string().nullish(),
    description: z.string(),
    contains: z.array(ContainsEntry).default([]),
    measurements: z.record(z.string(), Measurement).default({}),
    commands: z.record(z.string(), Command).default({}),
  })
  .refine((t) => {
    if (t.kind === "leaf") return Boolean(t.equipment_id);
    return !t.equipment_id;
  }, (t) => ({
    message:
      t.kind === "leaf"
        ? "equipment_id required for kind=leaf"
        : "equipment_id forbidden for kind=module",
  }))
  .refine(
    (t) =>
      Object.keys(t.measurements).length > 0 ||
      Object.keys(t.commands).length > 0,
    "template must declare at least one of measurements or commands",
  );
export type DeviceTemplateType = z.infer<typeof DeviceTemplate>;
```

Run targeted: `node --test src/templates/template.schema.test.ts`. All tests pass. Run gate.

- [ ] **Step 3: Commit**

```bash
git add src/templates/template.schema.ts src/templates/template.schema.test.ts
git commit -m "$(cat <<'EOF'
✨ feat: device template Zod schema mirrors edp-api Pydantic

Replaces the existing template.schema.ts with the full canonical
shape: TemplateKind/Publisher/Fanout enums, 5-variant Binding
discriminated union (Modbus/Dnp3/Snmp/Redfish/CANopen), Measurement +
Command with exactly-one-of binding/{publisher,fanout} refines,
ContainsEntry, DeviceTemplate with kind ↔ equipment_id consistency
and channels-required validators. Strict object schemas reject
unknown fields. Mirrors edp-api/src/shared/schemas/template.py.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

DO NOT push. Lock-step coordination at Task 7.

---

## Task 2: Mirror Canonical Dtm Zod Schema

**Files:**
- Modify: `src/topology/dtm.schema.ts` (full rewrite)
- Create: `src/topology/dtm.schema.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/topology/dtm.schema.test.ts
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  Bus,
  BusMember,
  Connection,
  Device,
  Dtm,
} from "./dtm.schema";
import { DeviceTemplate } from "../templates/template.schema";


function _modbusBinding() {
  return { protocol: "modbus_tcp", function_code: 4, address: 100 };
}

function _revenueMeterTemplate() {
  return {
    template: "revenue_meter",
    kind: "leaf",
    equipment_id: "GRD-MTR-001",
    vendor: "Schneider",
    model: "ION9000",
    description: "t",
    measurements: {
      voltage_a: { unit: "volts", type: "float", binding: _modbusBinding() },
    },
  };
}

function _device(overrides: Record<string, unknown> = {}) {
  return {
    device_id: "revenue_meter_1",
    template: "revenue_meter",
    parent: null,
    connection: { host: "10.0.0.1", port: 502, unit_id: "2" },
    ...overrides,
  };
}

function _dtm(overrides: Record<string, unknown> = {}) {
  return {
    deployment_uuid: "00000000-0000-0000-0000-000000000010",
    ems_mode: "sim",
    sizing_params: {
      P_compute_total_kW: 10.0,
      E_BESS_total_kWh: 5000.0,
      T_coolant_setpoint_C: 30.0,
    },
    devices: { revenue_meter_1: _device() },
    buses: [],
    templates_used: { revenue_meter: _revenueMeterTemplate() },
    ...overrides,
  };
}

describe("Device", () => {
  it("device_id must be snake_case slug", () => {
    assert.throws(
      () => Device.parse({ ..._device(), device_id: "RevenueMeter-1" }),
      /slug/,
    );
  });

  it("blocking defaults to live_mode", () => {
    const d = Device.parse(_device());
    assert.deepEqual(d.blocking, ["live_mode"]);
  });

  it("module-kind device may have null connection", () => {
    const d = Device.parse({
      device_id: "grid_module_1",
      template: "grid_module",
      parent: null,
      connection: null,
    });
    assert.equal(d.connection, null);
  });
});

describe("Dtm referential integrity", () => {
  it("devices keyed by device_id", () => {
    const d = Dtm.parse(_dtm());
    assert.ok("revenue_meter_1" in d.devices);
  });

  it("rejects orphan parent ref", () => {
    const orphan = _device({ parent: "ghost_module" });
    assert.throws(
      () => Dtm.parse(_dtm({ devices: { revenue_meter_1: orphan } })),
      /parent/,
    );
  });

  it("rejects orphan template ref", () => {
    const orphan = _device({ template: "not_a_template" });
    assert.throws(
      () => Dtm.parse(_dtm({ devices: { revenue_meter_1: orphan } })),
      /templates_used/,
    );
  });

  it("rejects orphan bus member", () => {
    const bus = {
      bus_id: "ac_main",
      type: "ac",
      members: [{ device_id: "ghost_device", port: "line" }],
    };
    assert.throws(() => Dtm.parse(_dtm({ buses: [bus] })), /bus member/);
  });

  it("bus type is dc or ac only", () => {
    assert.throws(() => Bus.parse({ bus_id: "x", type: "rf", members: [] }));
  });
});

describe("Strictness", () => {
  it("rejects unknown top-level field", () => {
    assert.throws(() => Dtm.parse({ ..._dtm(), foo: "bar" }), /unrecognized/i);
  });

  it("rejects unknown device field", () => {
    assert.throws(
      () =>
        Dtm.parse(
          _dtm({ devices: { revenue_meter_1: { ..._device(), foo: "bar" } } }),
        ),
      /unrecognized/i,
    );
  });
});
```

Run `node --test src/topology/dtm.schema.test.ts`. Expect failures. Run gate.

- [ ] **Step 2: Implement `src/topology/dtm.schema.ts`** (full rewrite)

Mirror the Pydantic Dtm shape:

```typescript
// src/topology/dtm.schema.ts
import { z } from "zod";
import { DeviceTemplate, Measurement } from "../templates/template.schema";

const SLUG_RE = /^[a-z][a-z0-9_]{0,62}[a-z0-9]$/;
const SENTINEL = "PROVISIONED_AT_COMMISSIONING";

export const ProvisionedInt = z.union([z.number().int(), z.literal(SENTINEL)]);

export const EmsMode = z.enum(["sim", "live"]);
export type EmsModeType = z.infer<typeof EmsMode>;

export const BlockingKind = z.enum(["live_mode", "commissioning_complete"]);
export type BlockingKindType = z.infer<typeof BlockingKind>;

export const Connection = z.strictObject({
  host: z.string(),
  port: ProvisionedInt,
  unit_id: z.string().nullish(),
});
export type ConnectionType = z.infer<typeof Connection>;

export const SizingParams = z.strictObject({
  P_compute_total_kW: z.number(),
  E_BESS_total_kWh: z.number(),
  T_coolant_setpoint_C: z.number(),
});

export const Device = z.strictObject({
  device_id: z.string().regex(SLUG_RE, "device_id must be a snake_case slug"),
  template: z.string(),
  parent: z.string().nullish(),
  display_name: z.string().nullish(),
  connection: Connection.nullish(),
  blocking: z.array(BlockingKind).default(["live_mode"]),
  extra_measurements: z.record(z.string(), Measurement).nullish(),
});
export type DeviceType = z.infer<typeof Device>;

export const BusMember = z.strictObject({
  device_id: z.string(),
  port: z.string().nullish(),
});
export type BusMemberType = z.infer<typeof BusMember>;

export const Bus = z.strictObject({
  bus_id: z.string(),
  type: z.enum(["dc", "ac"]),
  members: z.array(BusMember),
});
export type BusType = z.infer<typeof Bus>;

export const Dtm = z
  .strictObject({
    deployment_uuid: z.string().uuid(),
    ems_mode: EmsMode.default("sim"),
    sizing_ref: z.string().nullish(),
    sizing_params: SizingParams,
    devices: z.record(z.string(), Device),
    buses: z.array(Bus),
    templates_used: z.record(z.string(), DeviceTemplate),
  })
  .refine((d) => {
    for (const dev of Object.values(d.devices)) {
      if (dev.parent && !(dev.parent in d.devices)) return false;
    }
    return true;
  }, "device.parent must resolve in devices")
  .refine((d) => {
    for (const dev of Object.values(d.devices)) {
      if (!(dev.template in d.templates_used)) return false;
    }
    return true;
  }, "device.template must resolve in templates_used")
  .refine((d) => {
    for (const bus of d.buses) {
      for (const m of bus.members) {
        if (!(m.device_id in d.devices)) return false;
      }
    }
    return true;
  }, "bus member device_id must resolve in devices");

export type DtmType = z.infer<typeof Dtm>;
```

Note: Zod's `.refine()` produces a single error message regardless of which device/bus_member triggered it. For PR 3 that's fine (clear-enough error to catch authoring drift). For nicer per-field errors, an after-`.parse()` service-layer validator can produce specific paths — that comes in Task 4.

Run targeted: `node --test src/topology/dtm.schema.test.ts`. All tests pass. Run gate.

- [ ] **Step 3: Commit**

```bash
git add src/topology/dtm.schema.ts src/topology/dtm.schema.test.ts
git commit -m "$(cat <<'EOF'
✨ feat: canonical Dtm Zod schema mirrors edp-api Pydantic

Replaces dtm.schema.ts with the canonical shape per ADR-002 §7:
slug-keyed devices dict, parent-chain refs, dc/ac buses, embedded
templates_used. Three referential-integrity refines:
parent_chain_resolves, template_refs_resolve, bus_members_resolve.
Strict object schemas reject unknown fields end-to-end.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: TemplateLoaderService

**Files:**
- Create: `src/templates/template_loader.service.ts`
- Create: `src/templates/template_loader.service.test.ts`
- Create: `src/templates/templates.module.ts`

The TS counterpart of `edp-api/src/dtm/template_loader.py`. Walks `<root>/{leaf,module}/*.yaml`, parses with the `yaml` package, validates each via `DeviceTemplate.parse`, raises `TemplateLoadError` on invalid YAML, schema validation, duplicate slug, or unresolved `contains[]` ref.

- [ ] **Step 1: Write failing tests**

```typescript
// src/templates/template_loader.service.test.ts
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TemplateLoaderService,
  TemplateLoadError,
} from "./template_loader.service";


function _withTmp(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "tpl-loader-"));
  mkdirSync(join(root, "leaf"));
  mkdirSync(join(root, "module"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}


function _writeRevenueMeter(dir: string) {
  writeFileSync(
    join(dir, "revenue_meter.yaml"),
    `template: revenue_meter
kind: leaf
equipment_id: GRD-MTR-001
vendor: Schneider
model: ION9000
description: t
measurements:
  voltage_a:
    unit: volts
    type: float
    binding:
      protocol: modbus_tcp
      function_code: 4
      address: 100
`,
  );
}


describe("TemplateLoaderService", () => {
  it("load empty dir → empty catalog", () => {
    const { root, cleanup } = _withTmp();
    try {
      const svc = new TemplateLoaderService();
      const catalog = svc.loadCatalog(root);
      assert.deepEqual(catalog, {});
    } finally {
      cleanup();
    }
  });

  it("loads one leaf template", () => {
    const { root, cleanup } = _withTmp();
    try {
      _writeRevenueMeter(join(root, "leaf"));
      const svc = new TemplateLoaderService();
      const catalog = svc.loadCatalog(root);
      assert.ok("revenue_meter" in catalog);
      assert.equal(catalog.revenue_meter.equipment_id, "GRD-MTR-001");
    } finally {
      cleanup();
    }
  });

  it("raises on invalid YAML", () => {
    const { root, cleanup } = _withTmp();
    try {
      writeFileSync(join(root, "leaf", "broken.yaml"), "template: : :\n");
      const svc = new TemplateLoaderService();
      assert.throws(() => svc.loadCatalog(root), TemplateLoadError);
    } finally {
      cleanup();
    }
  });

  it("raises on validation failure", () => {
    const { root, cleanup } = _withTmp();
    try {
      writeFileSync(
        join(root, "leaf", "bad.yaml"),
        "template: empty\nkind: leaf\nequipment_id: GRD-MTR-001\nvendor: V\nmodel: M\ndescription: x\n",
      );
      const svc = new TemplateLoaderService();
      assert.throws(() => svc.loadCatalog(root), /validation/);
    } finally {
      cleanup();
    }
  });

  it("rejects duplicate slug", () => {
    const { root, cleanup } = _withTmp();
    try {
      _writeRevenueMeter(join(root, "leaf"));
      writeFileSync(
        join(root, "leaf", "dup.yaml"),
        `template: revenue_meter
kind: leaf
equipment_id: GRD-MTR-001
vendor: V
model: M
description: dup
measurements:
  v:
    unit: volts
    type: float
    binding: { protocol: modbus_tcp, function_code: 4, address: 100 }
`,
      );
      const svc = new TemplateLoaderService();
      assert.throws(() => svc.loadCatalog(root), /duplicate/);
    } finally {
      cleanup();
    }
  });

  it("rejects unresolved contains ref", () => {
    const { root, cleanup } = _withTmp();
    try {
      _writeRevenueMeter(join(root, "leaf"));
      writeFileSync(
        join(root, "module", "broken_module.yaml"),
        `template: broken_module
kind: module
description: refs missing leaf
contains:
  - template: nonexistent_leaf
    qty: 1
measurements:
  rollup:
    unit: watts
    type: float
    publisher: line_controller
`,
      );
      const svc = new TemplateLoaderService();
      assert.throws(() => svc.loadCatalog(root), /not in catalog/);
    } finally {
      cleanup();
    }
  });
});
```

Run targeted: `node --test src/templates/template_loader.service.test.ts`. Expect failures. Run gate.

- [ ] **Step 2: Implement `src/templates/template_loader.service.ts`**

```typescript
// src/templates/template_loader.service.ts
import { Injectable } from "@nestjs/common";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as yamlParse } from "yaml";
import {
  DeviceTemplate,
  type DeviceTemplateType,
} from "./template.schema";

export class TemplateLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateLoadError";
  }
}

@Injectable()
export class TemplateLoaderService {
  /** Walks <root>/{leaf,module}/*.yaml; raises on bad YAML, schema, dup, or unresolved refs. */
  loadCatalog(root: string): Record<string, DeviceTemplateType> {
    const catalog: Record<string, DeviceTemplateType> = {};
    for (const sub of ["leaf", "module"]) {
      const dir = join(root, sub);
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir)
        .filter((f) => f.endsWith(".yaml"))
        .sort();
      for (const fname of files) {
        const path = join(dir, fname);
        const tpl = this._loadFile(path);
        if (tpl.template in catalog) {
          throw new TemplateLoadError(
            `duplicate template slug ${tpl.template}: ${path} conflicts with prior file`,
          );
        }
        catalog[tpl.template] = tpl;
      }
    }
    this._checkContainsRefs(catalog);
    return catalog;
  }

  private _loadFile(path: string): DeviceTemplateType {
    let raw: unknown;
    try {
      raw = yamlParse(readFileSync(path, "utf8"));
    } catch (e) {
      throw new TemplateLoadError(`${path}: invalid YAML: ${e}`);
    }
    const result = DeviceTemplate.safeParse(raw);
    if (!result.success) {
      throw new TemplateLoadError(
        `${path}: schema validation failed: ${result.error.message}`,
      );
    }
    return result.data;
  }

  private _checkContainsRefs(
    catalog: Record<string, DeviceTemplateType>,
  ): void {
    for (const tpl of Object.values(catalog)) {
      for (const entry of tpl.contains) {
        if (!(entry.template in catalog)) {
          throw new TemplateLoadError(
            `template ${tpl.template}: contains[].template ${entry.template} not in catalog`,
          );
        }
      }
    }
  }
}
```

Run targeted: `node --test src/templates/template_loader.service.test.ts`. All 6 tests pass. Run gate.

- [ ] **Step 3: Create `src/templates/templates.module.ts`**

```typescript
// src/templates/templates.module.ts
import { Module } from "@nestjs/common";
import { TemplateLoaderService } from "./template_loader.service";

@Module({
  providers: [TemplateLoaderService],
  exports: [TemplateLoaderService],
})
export class TemplatesModule {}
```

- [ ] **Step 4: Commit**

```bash
git add src/templates/
git commit -m "$(cat <<'EOF'
✨ feat: TemplateLoaderService walks bundled device_templates/

NestJS-injectable service that walks <root>/{leaf,module}/*.yaml,
parses with the yaml package, validates each file via
DeviceTemplate.parse, and accumulates a catalog keyed by slug.
Throws TemplateLoadError on bad YAML, schema validation failure,
duplicate slug, or unresolved contains[].template ref.

Mirrors edp-api/src/dtm/template_loader.py.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Catalog-Aware Validation in Topology Service

**Files:**
- Modify: `src/topology/topology.service.ts` — add `validateAgainstCatalog(dtm: DtmType): void`
- Modify: `src/topology/topology.controller.ts` — call the new validator before persisting
- Modify: `src/topology/topology.module.ts` — import `TemplatesModule`

The Zod schema's `template_refs_resolve` refine validates that every `device.template` exists in the embedded `templates_used`. The catalog check is one level up: every entry in `templates_used` must match (or at least be a known slug from) the bundled catalog. This catches DTMs that embed an outdated template body or reference templates the device-api hasn't seen.

For MVP scope we only check slug-presence, not deep equality of template bodies. Body-equality is a stricter check we can add later.

- [ ] **Step 1: Test the validator**

Add to `src/topology/topology.service.test.ts` (or create if absent — it doesn't exist today; you'll need to scaffold it):

```typescript
// src/topology/topology.service.test.ts
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { TopologyService } from "./topology.service";
import { TemplateLoaderService } from "../templates/template_loader.service";
// ...

// Helpers and a test that:
// - constructs a Dtm whose templates_used contains a slug NOT in the catalog
// - calls service.validateAgainstCatalog(dtm)
// - asserts BadRequestException is thrown with a message referencing the unknown slug
```

Note: TopologyService also depends on TypeORM Repository; for a unit test, mock the repo.

- [ ] **Step 2: Implement `validateAgainstCatalog`**

```typescript
// in src/topology/topology.service.ts
import { BadRequestException, Injectable } from "@nestjs/common";
// ...
import { TemplateLoaderService } from "../templates/template_loader.service";
// ...

@Injectable()
export class TopologyService {
  constructor(
    @InjectRepository(Topology)
    private readonly repo: Repository<Topology>,
    private readonly templates: TemplateLoaderService,
    // catalog injected at module-bootstrap time via APP-level provider; see Task 5
  ) {}

  validateAgainstCatalog(dtm: DtmType, catalog: Record<string, unknown>): void {
    for (const slug of Object.keys(dtm.templates_used)) {
      if (!(slug in catalog)) {
        throw new BadRequestException(
          `templates_used contains slug ${slug} not in bundled catalog`,
        );
      }
    }
  }

  // existing save/getLatest unchanged
}
```

The catalog itself is a singleton produced at app boot. Wiring approach: the AppModule (or TemplatesModule) provides a value-token `TEMPLATE_CATALOG` that's the result of `TemplateLoaderService.loadCatalog("/app/device_templates")`. TopologyService injects it.

- [ ] **Step 3: Wire AppModule to compute the catalog at startup**

```typescript
// in src/app.module.ts (find the existing module)
import { TemplateLoaderService } from "./templates/template_loader.service";

const TEMPLATE_CATALOG = "TEMPLATE_CATALOG";

const templateCatalogProvider = {
  provide: TEMPLATE_CATALOG,
  useFactory: (loader: TemplateLoaderService) =>
    loader.loadCatalog(process.env.TEMPLATE_CATALOG_ROOT ?? "/app/device_templates"),
  inject: [TemplateLoaderService],
};

@Module({
  imports: [TemplatesModule, /* existing */],
  providers: [templateCatalogProvider],
  exports: [TEMPLATE_CATALOG],
})
export class AppModule {}
```

Then TopologyService injects it via `@Inject(TEMPLATE_CATALOG)`.

- [ ] **Step 4: Update controller to call validateAgainstCatalog**

```typescript
// src/topology/topology.controller.ts
@Post()
async submit(@Body(new ZodValidationPipe(Dtm)) dtm: DtmType): Promise<{ ok: true }> {
  this.service.validateAgainstCatalog(dtm, this.catalog);
  await this.service.save(dtm);
  return { ok: true };
}
```

The controller may also need to inject the catalog if the service doesn't already receive it.

- [ ] **Step 5: Run gate (unit + integration)**

```bash
npm run checks && npm run unit && npm run integration
```

All pass.

- [ ] **Step 6: Commit**

```bash
git add src/
git commit -m "$(cat <<'EOF'
✨ feat: POST /topology validates against bundled template catalog

TopologyService.validateAgainstCatalog rejects DTMs whose
templates_used entries aren't slugs the bundled catalog knows. App
module loads the catalog once at startup via TemplateLoaderService
and provides it as TEMPLATE_CATALOG injection token. Authoring drift
between edp-api templates and what device-api can resolve surfaces
as a 400 at the boundary, not a stale-data accident downstream.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Bundle device_templates/ at Docker Build

**Files:**
- Modify: `Dockerfile`
- Modify: `.gitlab-ci.yml` — possibly, depending on how the templates are fetched

The bundled-template approach: at Docker build time, the `device_templates/` directory from edp-api is copied into the production image at `/app/device_templates/`. Two reasonable mechanisms:

**Option A — git submodule:** `ems-device-api/device_templates` is a submodule pointing at edp-api's `device_templates/`. Dockerfile copies the submodule contents at build time. Submodules are easy to forget to update.

**Option B — CI step before Docker build:** the `.gitlab-ci.yml` `publish` stage clones edp-api at a pinned tag and copies `device_templates/` next to the Dockerfile so the build context has it. Pinning logic stays in CI config.

**Recommend Option B** (avoids submodule discipline; pin happens in CI YAML which is reviewed normally).

- [ ] **Step 1: Update Dockerfile**

Add a COPY step that brings `device_templates/` into the image. The build context must include this directory before `docker build` runs.

```dockerfile
FROM node:24-slim AS builder
WORKDIR /app
COPY package* .
RUN npm ci
COPY tsconfig*.json nest-cli.json cfg.yml .
COPY src src
COPY device_templates device_templates  # Reason: bundled catalog from edp-api
RUN find src -name "*.test.ts" -delete
RUN npm run build

FROM node:24-slim AS production
WORKDIR /app
COPY package* .
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/device_templates ./device_templates
COPY cfg.yml .
CMD [ "node", "dist/main"]
```

- [ ] **Step 2: Update `.gitlab-ci.yml` `publish` stage**

```yaml
publish:
    stage: publish
    script:
      - rm -rf device_templates
      - git clone --depth 1 https://gitlab-ci-token:$CI_JOB_TOKEN@gitlab.com/arcnode-io/edp-api.git /tmp/edp-api
      - cp -r /tmp/edp-api/device_templates ./device_templates
      - docker login -u admin -p $HARBOR_PASSWORD 173.211.12.43:8083
      - docker build -t 173.211.12.43:8083/library/ems-device-api .
      - docker push 173.211.12.43:8083/library/ems-device-api
```

(`$CI_JOB_TOKEN` is gitlab-issued and works for cross-repo reads in the same group.)

- [ ] **Step 3: Add `.gitignore` entry for `device_templates/`**

To avoid accidentally committing the cloned templates:

```
device_templates/
```

But you also want local dev to be able to test against device_templates/. For local dev, symlink `device_templates -> ../edp-api/device_templates` (manual setup; document in readme).

- [ ] **Step 4: Verify the bundled-template path resolves at runtime**

Run the app locally with the symlink (or `cp -r ../edp-api/device_templates .`), boot, hit a smoke endpoint, confirm catalog loaded. Document the local-dev setup in the project readme.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .gitlab-ci.yml .gitignore [readme.md if updated]
git commit -m "$(cat <<'EOF'
🔧 build: bundle edp-api/device_templates/ into image at build time

Dockerfile copies device_templates/ into the production image at
/app/device_templates/. CI clones edp-api at HEAD before docker
build to populate the build context. Local dev can symlink
../edp-api/device_templates instead.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: End-to-End Smoke + Integration Test

**Files:**
- Create: `tests/test_topology_e2e.test.ts` — POSTs a known-good DTM (from edp-api PR 2) and asserts 201 + retrievable
- Modify: existing topology integration tests if any conflict

- [ ] **Step 1: Write the e2e test**

The DTM under test should be a representative shape edp-api emits — e.g., a small commercial-ac fixture with one compute_module, one grid_module, a couple of leaf devices, one bus. Either inline as a TypeScript object literal or read from a JSON fixture file (`tests/fixtures/sample_dtm.json`).

Verify:
- POST /topology with the canonical DTM → 201
- GET /topology → returns the same DTM
- POST /topology with an unresolved-template DTM → 400

- [ ] **Step 2: Run gate**

```bash
npm run checks && npm run test
```

All green.

- [ ] **Step 3: Commit**

```bash
git add tests/
git commit -m "$(cat <<'EOF'
✅ test: end-to-end POST /topology accepts canonical Dtm

Integration test posts a representative commercial-ac DTM
(matching edp-api's PR 2 emit shape), confirms 201, then GETs the
same and asserts round-trip equality. Negative test: POST with an
unknown template slug rejects with 400.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Final Pipeline + Push + CI

- [ ] **Step 1: Confirm green locally**

```bash
npm run checks && npm run test && npm run cover
```

All pass.

- [ ] **Step 2: Push**

```bash
git push
```

- [ ] **Step 3: Watch CI**

```bash
glab ci status
until glab ci status 2>&1 | grep -qE "passed|failed|canceled|skipped"; do sleep 15; done
glab ci status | tail -10
```

Expected: success (the publish stage now also clones edp-api templates).

If publish fails because of the new clone+copy step, debug the CI YAML and patch.

---

## Self-Review

**Spec coverage:**
- Replace dtm.schema.ts with canonical Dtm → Task 2
- Replace template.schema.ts with full template schema → Task 1
- TemplateLoaderService walks bundled catalog → Task 3
- Validate referential integrity (template ref + parent + bus members) on POST /topology → Task 2 + Task 4
- CI bundles device_templates/ at image build → Task 5
- Update tests → Tasks 1, 2, 3, 6

**Placeholder scan:**
- TemplateLoaderService.test.ts skeleton uses `tmp` dir helpers — concrete, no TBDs.
- Integration test "tests/fixtures/sample_dtm.json" mentioned — implementer should inline the DTM literal in TypeScript rather than create an extra fixture file.

**Type consistency:**
- Zod types named `Foo` for the schema and `FooType` for the inferred TS type, matching existing precedent in the file.
- `Connection`, `Device`, `BusMember`, `Bus`, `Dtm` exactly mirror Pydantic class names.
- `BlockingKindType` carried over.

**Scope:** Single PR. Sub-projects B (day-1 boot from `/etc/ems/dtm.json`) and C (dynamic CRUD per ADR §14, AsyncAPI spec generation) are separate.
