import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ExampleService } from "./example.service";
import { ExampleController } from "./example.controller";
import { Example } from "./entities/example.entity";

/**
 * Example module handling Example-related functionality with database persistence.
 * Includes TypeORM repository configuration for the Example entity.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Example])],
  controllers: [ExampleController],
  providers: [ExampleService],
})
export class ExampleModule {}
