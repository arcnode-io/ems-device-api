# PR 6 — Sub-Project C3 MQTT topology_changed Broadcast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ems-device-api connects to a configurable MQTT broker at app boot and publishes `system/topology_changed { ts, version }` after every successful `TopologyService.save`.

**Architecture:** In-process Node `mqtt` client wrapped as a NestJS-injectable `MqttClientService` with `OnModuleInit`/`OnModuleDestroy` lifecycle hooks. `TopologyService.save` injects it and fires `publishTopologyChanged(version)` after the row insert. Fire-and-forget (no block on broker ack); broker outage drops the broadcast and logs a warning. Anonymous broker per v1-no-auth. emqx testcontainer for integration via existing `tests/fixtures/containers.ts` pattern.

**Tech Stack:** TypeScript 5.x, NestJS 11, `mqtt` (Node MQTT client), `emqx/emqx:latest` testcontainer, node --test runner.

**Reference:**
- `arcnode/ems/topic_structure_adr.md` ADR-002 §3 (system family), §10 (broadcast payload), §11 (QoS/retain), §13 (basic auth deferred)
- Spec at `arcnode/ems/docs/superpowers/specs/2026-05-10-c3-mqtt-broadcast-design.md`
- `tests/fixtures/containers.ts` — existing `startContainer` / `startPostgres` / `startLocalStack` patterns to mirror

---

## Verification Gate (mandatory)

After every small step:

```
npm run checks && npm run unit
```

After integration changes:

```
npm run integration
```

The 9 historical lint errors in `tests/asyncapi.test.ts` were resolved in PR 3 commit `66882f7`. Expect green.

---

## File Structure

**Create:**
- `src/mqtt/mqtt.client.service.ts` — `MqttClientService` with `onModuleInit`/`onModuleDestroy` + `publishTopologyChanged(version)`. ≤ 100 lines.
- `src/mqtt/mqtt.client.service.test.ts` — colocated unit tests with mocked client.
- `src/mqtt/mqtt.module.ts` — DI wiring. ≤ 15 lines.
- `tests/mqtt.test.ts` — integration: emqx + Postgres testcontainers, real subscriber asserts message receipt.

**Modify:**
- `src/config.ts` — `Config` Zod schema gains `mqttBrokerUrl: z.string().url()`.
- `cfg.yml` — both `local:` and `beta:` blocks gain `mqttBrokerUrl`.
- `src/topology/topology.module.ts` — import `MqttModule`.
- `src/topology/topology.service.ts` — inject `MqttClientService`, call `publishTopologyChanged(version)` after `repo.save`.
- `src/topology/topology.service.test.ts` — extend mock graph with `MqttClientService`; assert call after save.
- `tests/fixtures/containers.ts` — add `startEmqx()` helper.
- `package.json` — add `mqtt` dependency.

---

## Task 1: Config — `mqttBrokerUrl`

**Files:**
- Modify: `cfg.yml`
- Modify: `src/config.ts`

- [ ] **Step 1: Add `mqttBrokerUrl` to `cfg.yml`**

Replace `cfg.yml` with:

```yaml
local:
  logLevel: DEBUG
  port: 3000
  host: 127.0.0.1
  e2e: false
  postgresHost: localhost
  templateCatalogRoot: device_templates
  bootDtmS3Url: ~
  s3EndpointUrl: http://localhost:4566
  mqttBrokerUrl: mqtt://localhost:1883

beta:
  logLevel: INFO
  port: 3000
  host: 0.0.0.0
  e2e: true
  postgresHost: postgres
  templateCatalogRoot: /app/device_templates
  bootDtmS3Url: ~
  s3EndpointUrl: ~
  mqttBrokerUrl: mqtt://emqx:1883
```

- [ ] **Step 2: Update `Config` Zod schema in `src/config.ts`**

Find the `Config = z.object({...})` block. Add `mqttBrokerUrl: z.string().url()` so the schema reads:

```typescript
const Config = z.object({
  logLevel: z.enum(LogLevel),
  port: z.number().min(80),
  host: z.string().transform((val) => new Address4(val).address),
  e2e: z.boolean(),
  postgresHost: z.enum(PostgresHost),
  templateCatalogRoot: z.string(),
  bootDtmS3Url: z.string().nullable(),
  s3EndpointUrl: z.string().nullable(),
  mqttBrokerUrl: z.string().url(),
});
```

- [ ] **Step 3: Run gate**

```
npm run checks && npm run unit
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add cfg.yml src/config.ts
git commit -m "$(cat <<'EOF'
✨ feat: cfg adds mqttBrokerUrl

Per ADR-002 §3 + sub-project C3 spec. Local cfg points at localhost:1883;
beta points at deployment-internal emqx:1883. Production deployments
override via env (mqtts:// for TLS).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

DO NOT push.

---

## Task 2: Add `mqtt` Dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
npm install mqtt
```

- [ ] **Step 2: Verify**

```bash
grep '"mqtt":' package.json
```

Expected: a `"dependencies"` entry like `"mqtt": "^5.x.x"`.

- [ ] **Step 3: Run gate**

```
npm run checks && npm run unit
```

If `depcheck` complains the new dep is unused, add it temporarily to `--ignores` in the `package.json` `depcheck` script (will be removed in Task 3 once `MqttClientService` imports it). Otherwise proceed.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
🔧 build: add mqtt dep for topology_changed broadcast

Per ADR-002 §3. Used by MqttClientService in PR 6 Task 3. Eclipse
Paho-derived; standard Node MQTT client.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `MqttClientService` — Unit Tests First

**Files:**
- Create: `src/mqtt/mqtt.client.service.ts`
- Create: `src/mqtt/mqtt.client.service.test.ts`

### Step 1: Write failing tests

```typescript
// src/mqtt/mqtt.client.service.test.ts
import { describe, it, mock } from "node:test";
import { strict as assert } from "node:assert";
import type { ConfigService } from "@nestjs/config";
import type { MqttClient } from "mqtt";
import { MqttClientService } from "./mqtt.client.service";

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
    endAsync: mock.fn(async () => undefined),
  };
  return fake as unknown as MqttClient & FakeClient;
}

describe("MqttClientService", () => {
  it("publishTopologyChanged sends correct topic + payload", () => {
    // Arrange
    const fake = makeClient(true);
    const svc = new MqttClientService(makeCfg("mqtt://test:1883"));
    (svc as unknown as { client: MqttClient }).client = fake;
    // Act
    svc.publishTopologyChanged("1.0.42");
    // Assert
    assert.equal(fake.publishCalls.length, 1);
    const { topic, payload, opts } = fake.publishCalls[0];
    assert.equal(topic, "system/topology_changed");
    const parsed = JSON.parse(payload) as { ts: string; version: string };
    assert.equal(parsed.version, "1.0.42");
    assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(opts, { qos: 1, retain: false });
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
```

### Step 2: Run tests — expect failure

```bash
node --test src/mqtt/mqtt.client.service.test.ts
```

Expected: import error (file doesn't exist).

### Step 3: Implement `src/mqtt/mqtt.client.service.ts`

```typescript
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { connect, type MqttClient } from "mqtt";

const TOPIC_TOPOLOGY_CHANGED = "system/topology_changed";

/**
 * MQTT client wrapper. Connects to deployment broker on app boot,
 * publishes system/topology_changed on each topology mutation per
 * ADR-002 §3 + §10 + §11. Anonymous (no auth) per v1.
 */
@Injectable()
export class MqttClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttClientService.name);
  private client?: MqttClient;

  /**
   * Wires NestJS ConfigService for the broker URL.
   * @param cfg ConfigService — reads cfg.yml mqttBrokerUrl
   */
  constructor(private readonly cfg: ConfigService) {}

  /**
   * Connect to the broker on app boot. Reconnects every 5s on failure.
   * Returns immediately; connection is async.
   */
  onModuleInit(): void {
    const url = this.cfg.get<string>("mqttBrokerUrl");
    if (url === undefined) {
      this.logger.warn("mqttBrokerUrl not configured; broadcasts disabled");
      return;
    }
    this.client = connect(url, { reconnectPeriod: 5000 });
    this.client.on("connect", () => this.logger.log(`mqtt connected ${url}`));
    this.client.on("error", (err) =>
      this.logger.warn(`mqtt error: ${err.message}`),
    );
  }

  /**
   * Disconnect cleanly on app shutdown.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.client !== undefined) {
      await this.client.endAsync();
    }
  }

  /**
   * Fire-and-forget broadcast that topology version changed.
   * Drops + logs warning if broker is disconnected.
   * @param version New semver string from TopologyService.save
   */
  publishTopologyChanged(version: string): void {
    if (this.client === undefined || !this.client.connected) {
      this.logger.warn(
        `mqtt not connected; dropping topology_changed v${version}`,
      );
      return;
    }
    const payload = JSON.stringify({
      ts: new Date().toISOString(),
      version,
    });
    this.client.publish(
      TOPIC_TOPOLOGY_CHANGED,
      payload,
      { qos: 1, retain: false },
      (err) => {
        if (err) this.logger.warn(`mqtt publish failed: ${err.message}`);
      },
    );
  }
}
```

### Step 4: Run tests — expect pass

```bash
node --test src/mqtt/mqtt.client.service.test.ts
```

Expected: 3 passing.

### Step 5: Run gate

```
npm run checks && npm run unit
```

If `depcheck` ignore was added in Task 2, REMOVE it now — `mqtt` is imported by this file.

### Step 6: Commit

```bash
git add src/mqtt/mqtt.client.service.ts src/mqtt/mqtt.client.service.test.ts
git commit -m "$(cat <<'EOF'
✨ feat: MqttClientService publishes topology_changed broadcasts

Per ADR-002 §3 + §10 + §11. NestJS-injectable singleton with
OnModuleInit/OnModuleDestroy lifecycle. publishTopologyChanged(version)
fires JSON {ts, version} at system/topology_changed with qos=1,
retain=false. Drops + logs warning when broker disconnected; never
throws. Reconnect every 5s built-in via mqtt lib.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `MqttModule`

**Files:**
- Create: `src/mqtt/mqtt.module.ts`

### Step 1: Write the module

```typescript
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { MqttClientService } from "./mqtt.client.service";

@Module({
  imports: [ConfigModule],
  providers: [MqttClientService],
  exports: [MqttClientService],
})
export class MqttModule {}
```

### Step 2: Run gate

```
npm run checks && npm run unit
```

Expected: green.

### Step 3: Commit

```bash
git add src/mqtt/mqtt.module.ts
git commit -m "$(cat <<'EOF'
✨ feat: MqttModule wires MqttClientService for DI

Imports ConfigModule for broker URL access; exports MqttClientService
so TopologyModule can inject it. Mirrors TemplatesModule shape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire MqttClientService Into TopologyService.save

**Files:**
- Modify: `src/topology/topology.module.ts`
- Modify: `src/topology/topology.service.ts`
- Modify: `src/topology/topology.service.test.ts`

### Step 1: Read current `topology.module.ts`

```bash
cat src/topology/topology.module.ts
```

Identify the `imports:` array — `MqttModule` will be added there.

### Step 2: Update `topology.module.ts` to import `MqttModule`

Find the `imports:` array. Add `MqttModule`. Add the import statement at the top:

```typescript
import { MqttModule } from "../mqtt/mqtt.module";
```

Then in the `@Module({ imports: [...] })` decorator, add `MqttModule` to the imports array.

### Step 3: Write failing tests in `topology.service.test.ts`

Append to `src/topology/topology.service.test.ts` (after existing test blocks):

```typescript
describe("TopologyService.save — MQTT broadcast", () => {
  function baseDtm() {
    return {
      deployment_uuid: "123e4567-e89b-12d3-a456-426614174000",
      ems_mode: "sim" as const,
      sizing_ref: null,
      sizing_params: {
        P_compute_total_kW: 100,
        E_BESS_total_kWh: 200,
        T_coolant_setpoint_C: 18,
      },
      devices: {},
      buses: [],
      templates_used: {},
    };
  }

  it("save → publishTopologyChanged called with new version", async () => {
    // Arrange
    const repo = {
      findOne: mock.fn(async () => null),
      create: mock.fn((arg: { dtm: unknown; version: string }) => arg),
      save: mock.fn(async (row: { dtm: unknown; version: string }) => ({
        ...row,
        id: 1,
        receivedAt: new Date(),
      })),
    };
    const publishMock = mock.fn();
    const mqtt = { publishTopologyChanged: publishMock };
    const svc = new TopologyService(repo as never, {}, mqtt as never);
    // Act
    await svc.save(baseDtm() as never);
    // Assert
    assert.equal(publishMock.mock.callCount(), 1);
    assert.equal(publishMock.mock.calls[0].arguments[0], "1.0.0");
  });

  it("subsequent save → publishTopologyChanged with bumped version", async () => {
    // Arrange — prior row sets version to 1.0.5
    const prior = { dtm: baseDtm(), version: "1.0.5" };
    const repo = {
      findOne: mock.fn(async () => prior),
      create: mock.fn((arg: { dtm: unknown; version: string }) => arg),
      save: mock.fn(async (row: { dtm: unknown; version: string }) => ({
        ...row,
        id: 6,
        receivedAt: new Date(),
      })),
    };
    const publishMock = mock.fn();
    const mqtt = { publishTopologyChanged: publishMock };
    const svc = new TopologyService(repo as never, {}, mqtt as never);
    // Act
    await svc.save(baseDtm() as never);
    // Assert
    assert.equal(publishMock.mock.callCount(), 1);
    assert.equal(publishMock.mock.calls[0].arguments[0], "1.0.6");
  });
});
```

If existing service tests construct `TopologyService` with two args, they'll fail typecheck after Step 4 (constructor gains a third param). Update each existing instantiation to pass a stub MQTT object — e.g.:

```typescript
const stubMqtt = { publishTopologyChanged: () => undefined };
const svc = new TopologyService(repo as never, {}, stubMqtt as never);
```

Run targeted tests: `node --test src/topology/topology.service.test.ts`. Expect failures (constructor mismatch + new tests fail).

### Step 4: Update `src/topology/topology.service.ts`

Inject `MqttClientService`. Replace the file content with:

```typescript
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Topology } from "./topology.entity";
import type { DtmType } from "./dtm.schema";
import { TEMPLATE_CATALOG } from "../templates/templates.module";
import type { DeviceTemplateType } from "../templates/template.schema";
import { MqttClientService } from "../mqtt/mqtt.client.service";

/**
 * Compute the next monotonic version per ADR-002 §10 (MVP simplification).
 * Bootstrap → 1.0.0; subsequent saves bump the patch component by 1.
 * @param prev Prior version (e.g., "1.0.7") or null on bootstrap.
 * @returns Next semver string.
 */
function nextMonotonicVersion(prev: string | null): string {
  if (prev === null) return "1.0.0";
  const [major, minor, patch] = prev.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Persists DTM submissions, returns the most recent, and broadcasts
 * topology_changed on each save per ADR-002 §10.
 *
 * Each save() increments a monotonic version. After repo.save succeeds,
 * fires MqttClientService.publishTopologyChanged(version) fire-and-forget.
 */
@Injectable()
export class TopologyService {
  private readonly logger = new Logger(TopologyService.name);

  /**
   * Wires the TypeORM repository, bundled template catalog, and MQTT client.
   * @param repo TypeORM repository for Topology rows
   * @param catalog Slug-keyed device template catalog loaded at startup
   * @param mqtt MQTT client for topology_changed broadcasts
   */
  constructor(
    @InjectRepository(Topology)
    private readonly repo: Repository<Topology>,
    @Inject(TEMPLATE_CATALOG)
    private readonly catalog: Record<string, DeviceTemplateType>,
    private readonly mqtt: MqttClientService,
  ) {}

  /**
   * Throws BadRequestException if any slug in dtm.templates_used is not in
   * the bundled catalog.
   * @param dtm Validated Device Topology Manifest
   */
  validateAgainstCatalog(dtm: DtmType): void {
    const unknown = Object.keys(dtm.templates_used).filter(
      (slug) => !(slug in this.catalog),
    );
    if (unknown.length > 0) {
      throw new BadRequestException(
        `templates_used contains slug(s) not in bundled catalog: ${unknown.join(", ")}`,
      );
    }
  }

  /**
   * Persist a DTM with monotonic version + broadcast topology_changed.
   * Bootstrap → 1.0.0. Every subsequent save → patch + 1.
   * @param dtm Validated Device Topology Manifest
   * @returns The persisted Topology row
   */
  async save(dtm: DtmType): Promise<Topology> {
    const prior = await this.repo.findOne({
      where: {},
      order: { receivedAt: "DESC" },
    });
    const priorVersion = prior?.version ?? null;
    const version = nextMonotonicVersion(priorVersion);
    if (priorVersion === null) {
      this.logger.log(`seeded topology v${version} (initial)`);
    } else {
      this.logger.log(`updated topology v${priorVersion} → v${version}`);
    }
    const row = this.repo.create({
      dtm: dtm as unknown as Record<string, unknown>,
      version,
    });
    const saved = await this.repo.save(row);
    this.mqtt.publishTopologyChanged(version);
    return saved;
  }

  /**
   * Return the most-recently persisted DTM, or null if nothing has been
   * submitted.
   * @returns The latest DTM, or null
   */
  async getLatest(): Promise<DtmType | null> {
    const row = await this.repo.findOne({
      where: {},
      order: { receivedAt: "DESC" },
    });
    return row ? (row.dtm as DtmType) : null;
  }

  /**
   * Return the most-recently persisted Topology row, or null.
   * @returns The latest row, or null
   */
  async getLatestRow(): Promise<Topology | null> {
    return this.repo.findOne({
      where: {},
      order: { receivedAt: "DESC" },
    });
  }
}
```

### Step 5: Run gate

```
npm run checks && npm run unit
```

Expected: green. All existing service tests pass with the stub MQTT param; new broadcast tests pass.

### Step 6: Commit

```bash
git add src/topology/topology.module.ts src/topology/topology.service.ts src/topology/topology.service.test.ts
git commit -m "$(cat <<'EOF'
✨ feat: TopologyService.save broadcasts topology_changed via MQTT

After repo.save succeeds, fires MqttClientService.publishTopologyChanged
(version) fire-and-forget. Save semantics unchanged — broadcast is
best-effort, broker outage drops the event per ADR-002 §11.
TopologyModule imports MqttModule; tests inject a stub mqtt service.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: emqx Testcontainer Helper

**Files:**
- Modify: `tests/fixtures/containers.ts`

### Step 1: Add `startEmqx` helper

Append to `tests/fixtures/containers.ts` before the existing `export { ... }` line:

```typescript
/**
 * Start an emqx broker container with dynamic port. MQTT 3.1.1 / 5 on 1883.
 * Anonymous broker — no auth per v1.
 * @returns Container with mqtt:// URL pointing at emqx
 */
async function startEmqx(): Promise<Container> {
  const started = await new GenericContainer("emqx/emqx:latest")
    .withExposedPorts(1883)
    .withWaitStrategy(
      Wait.forLogMessage("Listener tcp:default on 0.0.0.0:1883 started."),
    )
    .start();

  const port = started.getMappedPort(1883);
  return {
    host: "localhost",
    port,
    url: `mqtt://localhost:${port}`,
    stop: () => started.stop(),
  };
}
```

Update the export line at the bottom from:

```typescript
export { startContainer, startPostgres, startLocalStack };
```

To:

```typescript
export { startContainer, startPostgres, startLocalStack, startEmqx };
```

### Step 2: Run gate

```
npm run checks
```

Expected: green. (Helper not yet consumed; no test changes.)

### Step 3: Commit

```bash
git add tests/fixtures/containers.ts
git commit -m "$(cat <<'EOF'
🔧 build: startEmqx testcontainer helper

emqx/emqx:latest container, exposes 1883, waits for the canonical
"Listener tcp:default on 0.0.0.0:1883 started." log line. Used by
tests/mqtt.test.ts (Task 7). Mirrors startLocalStack pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Integration Test — Real emqx + Real Subscriber

**Files:**
- Create: `tests/mqtt.test.ts`

### Step 1: Write the integration test

```typescript
/** Integration — TopologyService.save broadcasts via emqx. */

import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { connect, type MqttClient } from "mqtt";
import * as assert from "assert";
import { describe, test } from "node:test";
import { AppModuleWithDatabase } from "../src/app.module";
import { TEMPLATE_CATALOG } from "../src/templates/templates.module";
import { TopologyService } from "../src/topology/topology.service";
import type { DeviceTemplateType } from "../src/templates/template.schema";
import { startEmqx, startPostgres } from "./fixtures/containers";

const TEMPLATE_BESS = {
  template: "bess_module_v1",
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

const STUB_CATALOG: Record<string, DeviceTemplateType> = {
  bess_module_v1: TEMPLATE_BESS as unknown as DeviceTemplateType,
};

const SAMPLE_DTM = {
  deployment_uuid: "123e4567-e89b-12d3-a456-426614174099",
  ems_mode: "sim",
  sizing_ref: null,
  sizing_params: {
    P_compute_total_kW: 100,
    E_BESS_total_kWh: 200,
    T_coolant_setpoint_C: 18,
  },
  devices: {
    bess_001: {
      device_id: "bess_001",
      template: "bess_module_v1",
      parent: null,
      display_name: null,
      connection: { host: "10.0.0.1", port: 502, unit_id: null },
      blocking: ["live_mode"],
      extra_measurements: null,
    },
  },
  buses: [],
  templates_used: { bess_module_v1: TEMPLATE_BESS },
};

async function bootstrap(opts: {
  dbHost: string;
  dbPort: number;
  brokerUrl: string;
}): Promise<{
  app: import("@nestjs/common").INestApplication;
  service: TopologyService;
}> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModuleWithDatabase],
  })
    .overrideProvider(ConfigService)
    .useValue({
      get: <T>(key: string): T | undefined => {
        if (key === "postgresHost") return opts.dbHost as unknown as T;
        if (key === "mqttBrokerUrl") return opts.brokerUrl as unknown as T;
        return undefined;
      },
    })
    .overrideProvider(TEMPLATE_CATALOG)
    .useValue(STUB_CATALOG)
    .compile();

  const app = await moduleRef.createNestApplication().init();
  const service = app.get(TopologyService);
  return { app, service };
}

describe("MQTT topology_changed broadcast integration", () => {
  test("save → emqx broadcasts system/topology_changed { ts, version }", async () => {
    // Arrange — emqx + postgres testcontainers
    const broker = await startEmqx();
    const pg = await startPostgres("test", { dbname: "postgres" });
    process.env["POSTGRES_PASSWORD"] = "test";
    process.env["POSTGRES_PORT"] = String(pg.port);

    const { app, service } = await bootstrap({
      dbHost: pg.host,
      dbPort: pg.port,
      brokerUrl: broker.url,
    });

    let subscriber: MqttClient | undefined;
    try {
      // Subscribe to topology_changed
      subscriber = connect(broker.url);
      const messages: string[] = [];
      await new Promise<void>((res, rej) => {
        subscriber!.on("connect", () => {
          subscriber!.subscribe("system/topology_changed", (err) => {
            if (err) rej(err);
            else res();
          });
        });
      });
      subscriber.on("message", (_topic, payload) => {
        messages.push(payload.toString());
      });

      // Give the device-api MQTT client a moment to connect to emqx
      await new Promise((r) => setTimeout(r, 1000));

      // Act — save a DTM
      await service.save(SAMPLE_DTM as never);

      // Wait for the broadcast to round-trip
      await new Promise((r) => setTimeout(r, 1000));

      // Assert
      assert.equal(messages.length, 1);
      const parsed = JSON.parse(messages[0]) as {
        ts: string;
        version: string;
      };
      assert.equal(parsed.version, "1.0.0");
      assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T/);
    } finally {
      if (subscriber !== undefined) {
        await subscriber.endAsync();
      }
      await app.close();
      await pg.stop();
      await broker.stop();
    }
  });
});
```

### Step 2: Run integration

```bash
npm run integration
```

Expected: existing tests pass + new test passes. First run pulls `emqx/emqx:latest` image (~30s).

### Step 3: Run full gate

```
npm run checks && npm run unit && npm run integration
```

Expected: all green.

### Step 4: Commit

```bash
git add tests/mqtt.test.ts
git commit -m "$(cat <<'EOF'
✅ test: integration asserts topology_changed reaches a real subscriber

emqx + Postgres testcontainers; standalone mqtt subscriber receives
the broadcast after TopologyService.save. Confirms ts is ISO8601 and
version matches the persisted row. Mirrors tests/seed.test.ts pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Push + CI

### Step 1: Confirm green locally

```
npm run checks && npm run unit && npm run integration
```

Expected: all green.

### Step 2: Push

```bash
git push
```

### Step 3: Watch CI

```bash
sleep 60 && glab ci list 2>&1 | head -3
until glab ci status 2>&1 | grep -qE "passed|failed|canceled|skipped"; do sleep 20; done
glab ci status | tail -10
```

Expected: success.

If publish stage fails on `/tmp/edp-api`, the PR 4 commit `a3e2f0e` already added cleanup; should be fine. emqx container in CI integration tests adds ~15s to runtime.

---

## Self-Review

**Spec coverage:**
- `mqttBrokerUrl` config → Task 1
- `mqtt` dependency → Task 2
- `MqttClientService` with `OnModuleInit/OnModuleDestroy` + `publishTopologyChanged` → Task 3
- `MqttModule` DI wiring → Task 4
- `TopologyService.save` hook + tests → Task 5
- `startEmqx` testcontainer helper → Task 6
- Integration test against real emqx → Task 7
- Push + CI → Task 8

ADR-002 covered:
- §3 topic shape: `system/topology_changed` (Task 3)
- §10 payload `{ts, version}` (Task 3)
- §11 QoS=1, retain=false (Task 3)
- §13 anonymous (no auth) — implicit, no auth code

**Placeholder scan:** None.

**Type consistency:**
- `MqttClientService.publishTopologyChanged(version: string): void` consistent across Task 3 + Task 5
- `mqttBrokerUrl: string` in cfg.yml ↔ `z.string().url()` in Config schema ↔ `cfg.get<string>("mqttBrokerUrl")` in service
- `system/topology_changed` topic + `{ ts, version }` payload shape consistent across spec, service, and integration test
