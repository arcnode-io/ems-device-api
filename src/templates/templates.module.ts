import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TemplateLoaderService } from "./template_loader.service";
import type { DeviceTemplateType } from "./template.schema";

/** Injection token for the slug-keyed device template catalog. */
export const TEMPLATE_CATALOG = "TEMPLATE_CATALOG";

// Loads the catalog once at module init; root path comes from cfg.yml via ConfigService.
const templateCatalogProvider = {
  provide: TEMPLATE_CATALOG,
  useFactory: (
    loader: TemplateLoaderService,
    cfg: ConfigService,
  ): Record<string, DeviceTemplateType> =>
    loader.loadCatalog(cfg.get<string>("templateCatalogRoot")!),
  inject: [TemplateLoaderService, ConfigService],
};

/** Provides TemplateLoaderService and the slug-keyed TEMPLATE_CATALOG token. */
@Module({
  imports: [ConfigModule],
  providers: [TemplateLoaderService, templateCatalogProvider],
  exports: [TemplateLoaderService, TEMPLATE_CATALOG],
})
export class TemplatesModule {}
