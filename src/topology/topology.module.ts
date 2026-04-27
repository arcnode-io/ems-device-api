import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Topology } from "./topology.entity";
import { TopologyService } from "./topology.service";
import { TopologyController } from "./topology.controller";

/** Topology module — POST/GET /topology + the Topology TypeORM entity. */
@Module({
  imports: [TypeOrmModule.forFeature([Topology])],
  controllers: [TopologyController],
  providers: [TopologyService],
  exports: [TopologyService],
})
export class TopologyModule {}
