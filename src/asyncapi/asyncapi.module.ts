import { Module } from "@nestjs/common";
import { TopologyModule } from "../topology/topology.module";
import { ClassModule } from "../classes/class.module";
import { AsyncapiService } from "./asyncapi.service";
import { AsyncapiController } from "./asyncapi.controller";

/** AsyncAPI module — generates + serves spec from the persisted DTM + class catalog. */
@Module({
  imports: [TopologyModule, ClassModule],
  controllers: [AsyncapiController],
  providers: [AsyncapiService],
})
export class AsyncapiModule {}
