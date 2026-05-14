import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModuleWithDatabase } from "./app.module";
import { loadConfig, setupLogger } from "./config";
import { seedFromFile } from "./seed/seed_from_file";

/**
 * Bootstrap the NestJS application.
 * Loads config, starts the app, reads + seeds boot DTM (per system_adr §22),
 * mounts Swagger docs, and listens.
 * @example bootstrap() // Starts server with day-1 boot seed
 */
async function bootstrap(): Promise<void> {
  const cfg = loadConfig();
  const logger = setupLogger(cfg.logLevel);
  logger.info(`Running with Config ${JSON.stringify(cfg)}`);
  const app = await NestFactory.create(AppModuleWithDatabase);

  await seedFromFile(app, cfg.bootDtmPath, new Logger("bootstrap"));

  const config = new DocumentBuilder()
    .setTitle("NestJS API")
    .setDescription("The NestJS API description")
    .setVersion("1.0.0-beta")
    .setOpenAPIVersion("3.1.0")
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document);

  await app.listen(cfg.port, cfg.host);
}
bootstrap();
