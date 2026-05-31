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
import { AuthModule } from './auth/auth.module';

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
