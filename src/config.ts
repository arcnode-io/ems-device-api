import * as fs from "fs";
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

const Config = z.object({
  logLevel: z.enum(LogLevel),
  port: z.number().min(80),
  host: z.string().transform((val) => new Address4(val).address),
  e2e: z.boolean(),
  templateCatalogRoot: z.string(),
  mqttBrokerUrl: z.string(),
  mqttUsername: z.string(),
  edpApiUrl: z.url(),
});

export type ConfigType = z.infer<typeof Config>;
// Reason: a record rather than fixed keys, so adding a cfg.yml block is enough to add a profile.
// z.object would silently strip any block it does not name.
const ConfigMap = z.record(z.string(), Config);

/**
 * Loads configuration from cfg.yml file based on environment.
 * @returns Config object for the block $ENV names, or `local` when $ENV is unset
 * @throws Error if cfg.yml cannot be read or parsed, or names no such block
 * @example loadConfig() // { logLevel: 'INFO' }
 */
export function loadConfig(): ConfigType {
  const file = fs.readFileSync("cfg.yml", "utf8");
  const config = ConfigMap.parse(yaml.parse(file));
  const environment = process.env.ENV ?? "local";
  const block = config[environment];
  if (block === undefined) {
    // Reason: falling back to local would put a container on a localhost broker with a relative
    // template path, surfacing as a connection bug rather than a misconfiguration.
    throw new Error(`no '${environment}' block in cfg.yml`);
  }
  return block;
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
