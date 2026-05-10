import { Module } from "@nestjs/common";
import { TemplateLoaderService } from "./template_loader.service";

/**
 *
 */
@Module({
  providers: [TemplateLoaderService],
  exports: [TemplateLoaderService],
})
export class TemplatesModule {}
