import { Injectable } from "@nestjs/common";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as yamlParse } from "yaml";
import { DeviceTemplate, type DeviceTemplateType } from "./template.schema";

/**
 * Raised when a template file fails to parse or validate.
 */
export class TemplateLoadError extends Error {
  /**
   * Creates a new TemplateLoadError with the given message.
   * @param message Human-readable description of the failure
   */
  constructor(message: string) {
    super(message);
    this.name = "TemplateLoadError";
  }
}

/**
 * Walks device_templates/{leaf,module}/*.yaml, validates each, and builds a slug-keyed catalog.
 * Mirrors edp-api TemplateLoader (src/dtm/template_loader.py).
 */
@Injectable()
export class TemplateLoaderService {
  /**
   * Walks <root>/{leaf,module}/*.yaml in alphabetical order, validates each file,
   * and returns a catalog keyed by template slug.
   * Raises TemplateLoadError on invalid YAML, schema validation failure,
   * duplicate slug, or unresolved contains[].template ref.
   * @param root Absolute path to the root directory containing leaf/ and module/ subdirs
   * @returns Catalog of validated DeviceTemplate objects keyed by slug
   */
  loadCatalog(root: string): Record<string, DeviceTemplateType> {
    const catalog: Record<string, DeviceTemplateType> = {};
    for (const sub of ["leaf", "module"]) {
      const dir = join(root, sub);
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir)
        .filter((fname) => fname.endsWith(".yaml"))
        .sort();
      for (const fname of files) {
        const filePath = join(dir, fname);
        const tpl = this._loadFile(filePath);
        if (tpl.template in catalog) {
          throw new TemplateLoadError(
            `duplicate template slug ${tpl.template}: ${filePath} conflicts with prior file`,
          );
        }
        catalog[tpl.template] = tpl;
      }
    }
    this._checkContainsRefs(catalog);
    return catalog;
  }

  /**
   * Parses and validates a single YAML template file.
   * @param filePath Absolute path to the YAML file to load
   * @returns Validated DeviceTemplate object
   */
  private _loadFile(filePath: string): DeviceTemplateType {
    let raw: unknown;
    try {
      raw = yamlParse(readFileSync(filePath, "utf8"));
    } catch (err) {
      throw new TemplateLoadError(
        `${filePath}: invalid YAML: ${(err as Error).message}`,
      );
    }
    const result = DeviceTemplate.safeParse(raw);
    if (!result.success) {
      throw new TemplateLoadError(
        `${filePath}: schema validation failed: ${result.error.message}`,
      );
    }
    return result.data;
  }

  /**
   * Asserts every module's contains[].template resolves to a catalog key.
   * @param catalog Fully built catalog to check for dangling refs
   */
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
