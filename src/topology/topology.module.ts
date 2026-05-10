import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Topology } from "./topology.entity";
import { TopologyService } from "./topology.service";
import { TopologyController } from "./topology.controller";
import {
  TemplatesModule,
  TEMPLATE_CATALOG,
} from "../templates/templates.module";
import { TemplateLoaderService } from "../templates/template_loader.service";
import type { DeviceTemplateType } from "../templates/template.schema";

// Loads the catalog once when TopologyModule initialises.
// TEMPLATE_CATALOG_ROOT env override lets integration tests point at a tmp dir.
const templateCatalogProvider = {
  provide: TEMPLATE_CATALOG,
  useFactory: (
    loader: TemplateLoaderService,
  ): Record<string, DeviceTemplateType> =>
    loader.loadCatalog(
      process.env["TEMPLATE_CATALOG_ROOT"] ?? "/app/device_templates",
    ),
  inject: [TemplateLoaderService],
};

/** Topology module — POST/GET /topology + the Topology TypeORM entity. */
@Module({
  imports: [TypeOrmModule.forFeature([Topology]), TemplatesModule],
  controllers: [TopologyController],
  providers: [TopologyService, templateCatalogProvider],
  exports: [TopologyService],
})
export class TopologyModule {}
