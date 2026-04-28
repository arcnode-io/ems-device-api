import { Injectable } from "@nestjs/common";
import * as yaml from "yaml";
import { TopologyService } from "../topology/topology.service";
import { buildSpec } from "./spec-generator";

const ASYNCAPI_REACT_VERSION = "1.4.18";

/**
 * Generates an AsyncAPI v3 spec from the persisted DTM and renders it in
 * three formats — JSON for codegen, YAML for human-friendly machine reads,
 * and HTML for engineers.
 *
 * The DTM is self-describing: every template referenced by the device map
 * appears under `templates_used`, so the generator never reads from disk.
 */
@Injectable()
export class AsyncapiService {
  /**
   * Wires the persistence dependency.
   * @param topology Source of the persisted DTM
   */
  constructor(private readonly topology: TopologyService) {}

  /**
   * Build the spec object from the latest persisted DTM.
   * @returns The AsyncAPI 3.0.0 spec, or null if no DTM has been submitted yet.
   */
  async generateSpec(): Promise<Record<string, unknown> | null> {
    const dtm = await this.topology.getLatest();
    if (!dtm) return null;
    const spec = buildSpec(dtm);
    return spec as unknown as Record<string, unknown>;
  }

  /**
   * Render the spec as YAML.
   * @returns YAML string, or null if no DTM has been submitted yet.
   */
  async generateYaml(): Promise<string | null> {
    const spec = await this.generateSpec();
    if (!spec) return null;
    return yaml.stringify(spec);
  }

  /**
   * Render the spec as a self-contained HTML page that loads the canonical
   * AsyncAPI react-component standalone bundle from unpkg and embeds the spec.
   * @returns HTML string, or null if no DTM has been submitted yet.
   */
  async generateHtml(): Promise<string | null> {
    const spec = await this.generateSpec();
    if (!spec) return null;
    const json = JSON.stringify(spec).replace(/</g, "\\u003c");
    return [
      "<!DOCTYPE html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="utf-8">',
      "<title>AsyncAPI — ARCNODE EMS</title>",
      `<link rel="stylesheet" href="https://unpkg.com/@asyncapi/react-component@${ASYNCAPI_REACT_VERSION}/styles/default.min.css">`,
      "</head>",
      "<body>",
      '<div id="asyncapi-container"></div>',
      `<script src="https://unpkg.com/@asyncapi/react-component@${ASYNCAPI_REACT_VERSION}/browser/standalone/index.js"></script>`,
      "<script>",
      `const schema = ${json};`,
      "AsyncApiStandalone.render(",
      "  { schema: { content: schema } },",
      '  document.getElementById("asyncapi-container")',
      ");",
      "</script>",
      "</body>",
      "</html>",
    ].join("\n");
  }
}
