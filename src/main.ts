import { NestFactory } from "@nestjs/core";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModuleWithDatabase } from "./app.module";
import { loadConfig, setupLogger } from "./config";
/**
 * Bootstrap the NestJS application.
 * Creates the NestJS app instance and starts listening on specified port.
 * @example bootstrap() // Starts server on PORT env var or 3000
 */
async function bootstrap(): Promise<void> {
  const cfg = loadConfig();
  const logger = setupLogger(cfg.logLevel);
  logger.info(`Running with Config ${JSON.stringify(cfg)}`);
  const app = await NestFactory.create(AppModuleWithDatabase);

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
