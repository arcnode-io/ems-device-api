import { Module } from "@nestjs/common";
import { TemplateLoaderService } from "./template_loader.service";

/** Injection token for the slug-keyed device template catalog. */
export const TEMPLATE_CATALOG = "TEMPLATE_CATALOG";

/** Provides TemplateLoaderService for catalog construction. */
@Module({
  providers: [TemplateLoaderService],
  exports: [TemplateLoaderService],
})
export class TemplatesModule {}
