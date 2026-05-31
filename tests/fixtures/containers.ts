/** Testcontainer fixtures with dynamic port allocation. */

import { GenericContainer, Wait } from "testcontainers";
import { PostgreSqlContainer } from "@testcontainers/postgresql";

/**
 * Seed the five AUTH_* / MQTT_* env vars that AuthModule reads at boot.
 * Idempotent — only sets values that are currently unset, so tests that
 * want specific values (e.g. auth.test.ts) can set them first and keep
 * authority. Without this, unrelated integration tests would fail to
 * compile the Nest module because of missing-env throws in AuthModule
 * factories. AuthModule bcrypt-hashes the plaintext PWs at boot.
 */
function seedAuthTestEnvIfUnset(): void {
  if (!process.env["AUTH_JWT_SECRET"]) {
    process.env["AUTH_JWT_SECRET"] = "test-jwt-secret-default";
  }
  if (!process.env["AUTH_OPERATOR_PW"]) {
    process.env["AUTH_OPERATOR_PW"] = "test-placeholder-operator";
  }
  if (!process.env["AUTH_VIEWER_PW"]) {
    process.env["AUTH_VIEWER_PW"] = "test-placeholder-viewer";
  }
  if (!process.env["MQTT_OPERATOR_PASSWORD"]) {
    process.env["MQTT_OPERATOR_PASSWORD"] = "test-operator-broker-pw";
  }
  if (!process.env["MQTT_VIEWER_PASSWORD"]) {
    process.env["MQTT_VIEWER_PASSWORD"] = "test-viewer-broker-pw";
  }
}

/** Connection info for a running testcontainer. */
interface Container {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  stop(): Promise<unknown>;
}

/**
 * Start a generic Docker container with dynamic port. Internal building block.
 * @param image Docker image (e.g. "redis:7")
 * @param port Internal container port to expose
 * @param waitForLog Log message indicating readiness
 * @returns Container with http:// URL and dynamic port
 */
async function startContainer(
  image: string,
  port: number,
  waitForLog: string,
): Promise<Container> {
  const started = await new GenericContainer(image)
    .withExposedPorts(port)
    .withWaitStrategy(Wait.forLogMessage(waitForLog))
    .start();

  const mapped = started.getMappedPort(port);
  return {
    host: "localhost",
    port: mapped,
    url: `http://localhost:${mapped}`,
    stop: () => started.stop(),
  };
}

/**
 * Start a Postgres container with dynamic port.
 * @param password DB password
 * @param opts Optional configuration
 * @param opts.image Docker image (default: postgres:15)
 * @param opts.username Database username (default: postgres)
 * @param opts.dbname Database name (default: postgres)
 * @returns Container with postgresql:// URL and dynamic port
 */
async function startPostgres(
  password = "test",
  opts?: {
    image?: string;
    username?: string;
    dbname?: string;
  },
): Promise<Container> {
  seedAuthTestEnvIfUnset();
  const username = opts?.username ?? "postgres";
  const dbname = opts?.dbname ?? "postgres";
  const image = opts?.image ?? "postgres:15";

  const started = await new PostgreSqlContainer(image)
    .withUsername(username)
    .withPassword(password)
    .withDatabase(dbname)
    .start();

  const port = Number(started.getPort());
  return {
    host: "localhost",
    port,
    url: `postgresql://${username}:${password}@localhost:${port}/${dbname}`,
    stop: () => started.stop(),
  };
}

/**
 * Start an hivemq broker container with dynamic port. MQTT 3.1.1 / 5 on 1883.
 * Anonymous broker — no auth per v1.
 * @returns Container with mqtt:// URL pointing at hivemq
 */
async function startHivemq(): Promise<Container> {
  const started = await new GenericContainer("hivemq/hivemq-ce:latest")
    .withExposedPorts(1883)
    .withWaitStrategy(
      Wait.forLogMessage(
        "Started TCP Listener on address 0.0.0.0 and on port 1883.",
      ),
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

export { startContainer, startPostgres, startHivemq };
export type { Container };
