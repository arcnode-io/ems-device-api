/** Testcontainer fixtures with dynamic port allocation. */

import { GenericContainer, Wait } from "testcontainers";
import { PostgreSqlContainer } from "@testcontainers/postgresql";

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
  password: string,
  opts?: {
    image?: string;
    username?: string;
    dbname?: string;
  },
): Promise<Container> {
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

export { startContainer, startPostgres };
export type { Container };
