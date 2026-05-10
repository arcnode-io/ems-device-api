import * as fs from "fs";
import { match } from "ts-pattern";
import * as yaml from "yaml";
import * as winston from "winston";
import { z } from "zod";
import { Address4 } from "ip-address";

export enum LogLevel {
  ERROR = "ERROR",
  WARN = "WARN",
  INFO = "INFO",
  DEBUG = "DEBUG",
}

export enum PostgresHost {
  LOCALHOST = "localhost",
  POSTGRES = "postgres",
}

const Config = z.object({
  logLevel: z.enum(LogLevel),
  port: z.number().min(80),
  host: z.string().transform((val) => new Address4(val).address),
  e2e: z.boolean(),
  postgresHost: z.enum(PostgresHost),
  templateCatalogRoot: z.string(),
});

export type ConfigType = z.infer<typeof Config>;
const ConfigMap = z.object({
  local: Config,
  beta: Config,
});

/**
 * Loads configuration from cfg.yml file based on environment.
 * @returns Config object for current environment (ENV var or 'local' default)
 * @throws Error if cfg.yml file cannot be read or parsed
 * @example loadConfig() // { logLevel: 'INFO' }
 */
export function loadConfig(): ConfigType {
  const file = fs.readFileSync("cfg.yml", "utf8");
  const config = ConfigMap.parse(yaml.parse(file));
  const environment = process.env.ENV ?? "local";
  return match(environment)
    .with("beta", () => config.beta)
    .otherwise(() => config.local);
}

/**
 * Creates and configures a Winston logger with colored console output.
 * @param level Log Level enum
 * @returns Configured Winston logger instance
 * @example setupLogger('INFO') // Winston logger with INFO level
 */
export function setupLogger(level: LogLevel): winston.Logger {
  return winston.createLogger({
    level: level.toLowerCase(),
    format: winston.format.combine(
      winston.format((info) => ({
        ...info,
        level: info.level.toUpperCase(),
      }))(),
      winston.format.colorize(),
      winston.format.printf(
        (info) =>
          `${new Date().toISOString()} ${String(info.level)}: ${String(info.message)}`,
      ),
    ),
    transports: [new winston.transports.Console()],
  });
}
