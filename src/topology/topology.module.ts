import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Topology } from "./topology.entity";
import { TopologyService } from "./topology.service";
import { TopologyController } from "./topology.controller";
import { TemplatesModule } from "../templates/templates.module";
import { MqttModule } from "../mqtt/mqtt.module";

/** Topology module — POST/GET /topology + the Topology TypeORM entity. */
@Module({
  imports: [TypeOrmModule.forFeature([Topology]), TemplatesModule, MqttModule],
  controllers: [TopologyController],
  providers: [TopologyService],
  exports: [TopologyService],
})
export class TopologyModule {}
