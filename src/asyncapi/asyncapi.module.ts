import { Module } from "@nestjs/common";
import { TopologyModule } from "../topology/topology.module";
import { AsyncapiService } from "./asyncapi.service";
import { AsyncapiController } from "./asyncapi.controller";

/** AsyncAPI module — generates + serves spec from the persisted DTM. */
@Module({
  imports: [TopologyModule],
  controllers: [AsyncapiController],
  providers: [AsyncapiService],
})
export class AsyncapiModule {}
