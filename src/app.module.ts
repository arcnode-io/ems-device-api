import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { APP_PIPE } from "@nestjs/core";
import { ZodValidationPipe } from "nestjs-zod";
import { AppController } from "./app.controller";
import { ExampleModule } from "./example/example.module";
import { loadConfig } from "./config";
import { CallApiModule } from "./call-api/call-api.module";
import { TopologyModule } from "./topology/topology.module";
import { AsyncapiModule } from "./asyncapi/asyncapi.module";
import { AuthModule } from "./auth/auth.module";

// Raised from Express's 100 KB default via `app.useBodyParser`, which replaces
// Nest's built-in parser — route middleware is too late, the built-in one has
// already rejected the request.
//
// A DTM is one JSON document whose size tracks device count: a generated
// 234-device manifest is 173 KB, most of it the embedded templates_used. Express
// defaults JSON bodies to 100 KB, which made device-api reject its own
// generator's output with 413. At roughly 740 bytes per device this ceiling
// leaves room for about a 14,000-device site.
export const MAX_BODY_SIZE = "10mb";

/**
 * Main application module without database dependencies for basic tests.
 * Excludes AuthModule (which requires env-seeded secrets at boot) — auth
 * lives in AppModuleWithDatabase only.
 */
@Module({
  imports: [CallApiModule],
  controllers: [AppController],
})
export class AppModule {}

/**
 * Application module with database configuration
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      load: [loadConfig],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (_configService: ConfigService) => {
        const documentUrl = process.env["DOCUMENT_URL"];
        if (documentUrl === undefined || documentUrl.length === 0) {
          throw new Error("DOCUMENT_URL is required");
        }
        return {
          type: "postgres",
          url: documentUrl,
          autoLoadEntities: true,
          synchronize: true,
        };
      },
      inject: [ConfigService],
    }),
    ExampleModule,
    CallApiModule,
    TopologyModule,
    AsyncapiModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe,
    },
  ],
})
export class AppModuleWithDatabase {}
