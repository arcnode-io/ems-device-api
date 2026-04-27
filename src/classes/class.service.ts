import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import { DeviceClass, type DeviceClassType } from "./class.schema";

const CATALOG_DIR = "device_classes";

/**
 * Loads the device class catalog from `device_classes/**\/*.yaml` at startup.
 * Single source of truth for the AsyncAPI spec generator's per-device channel
 * expansion.
 */
@Injectable()
export class ClassService implements OnModuleInit {
  private readonly logger = new Logger(ClassService.name);
  private readonly catalog = new Map<string, DeviceClassType>();

  /**
   * Walk the catalog directory, parse + validate every YAML file, register
   * each class keyed by `${class}.${version}`. Runs once at module init.
   */
  onModuleInit(): void {
    if (!fs.existsSync(CATALOG_DIR)) {
      this.logger.warn(
        `class catalog dir ${CATALOG_DIR} not found — generator will fall back to placeholder channels`,
      );
      return;
    }
    const files = this.findYamlFiles(CATALOG_DIR);
    for (const file of files) {
      const cls = DeviceClass.parse(yaml.parse(fs.readFileSync(file, "utf8")));
      const key = `${cls.class}.${cls.version}`;
      this.catalog.set(key, cls);
      this.logger.log(`loaded class ${key} from ${file}`);
    }
    this.logger.log(`class catalog ready: ${this.catalog.size} classes`);
  }

  /**
   * Look up a class by `${class}.${version}` slug (matches DTM device.class).
   * @param classRef Slug as it appears in DTM `devices[*].class`
   * @returns The class definition, or undefined if the catalog has no match.
   */
  get(classRef: string): DeviceClassType | undefined {
    return this.catalog.get(classRef);
  }

  /**
   * Recursively walk a directory, returning every `*.yaml` path.
   * @param dir Directory to walk
   * @returns Absolute paths to YAML files.
   */
  private findYamlFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...this.findYamlFiles(full));
      else if (entry.isFile() && full.endsWith(".yaml")) out.push(full);
    }
    return out;
  }
}
