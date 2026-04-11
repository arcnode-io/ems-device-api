import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { APP_PIPE } from "@nestjs/core";
import { ZodValidationPipe } from "nestjs-zod";
import { AppController } from "./app.controller";
import { ExampleModule } from "./example/example.module";
import { loadConfig } from "./config";
import { CallApiModule } from "./call-api/call-api.module";

/**
 * Main application module without database dependencies for basic tests
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
      useFactory: (configService: ConfigService) => ({
        type: "postgres",
        host: configService.get("postgresHost"),
        port: configService.get("postgresPort"),
        username: "postgres",
        password: process.env["POSTGRES_PASSWORD"],
        database: "postgres",
        autoLoadEntities: true,
        synchronize: true,
      }),
      inject: [ConfigService],
    }),
    ExampleModule,
    CallApiModule,
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
