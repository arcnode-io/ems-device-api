import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModuleWithDatabase } from "./app.module";
import { loadConfig, setupLogger } from "./config";
import { seedFromS3 } from "./seed/seed_from_s3";

/**
 * Bootstrap the NestJS application.
 * Loads config, starts the app, fetches + seeds boot DTM (per ADR-003),
 * mounts Swagger docs, and listens.
 * @example bootstrap() // Starts server with day-1 boot seed
 */
async function bootstrap(): Promise<void> {
  const cfg = loadConfig();
  const logger = setupLogger(cfg.logLevel);
  logger.info(`Running with Config ${JSON.stringify(cfg)}`);
  const app = await NestFactory.create(AppModuleWithDatabase);

  await seedFromS3(
    app,
    cfg.bootDtmS3Url,
    cfg.s3EndpointUrl,
    new Logger("bootstrap"),
  );

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
