import { Module } from "@nestjs/common";
import { CallApiController } from "./call-api.controller";
import { CallApiService } from "./call-api.service";

/**
 * Example module demonstrating how to call an external API using NestJS.
 */
@Module({
  controllers: [CallApiController],
  providers: [CallApiService],
})
export class CallApiModule {}
