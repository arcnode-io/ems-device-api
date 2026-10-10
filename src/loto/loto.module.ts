import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LotoLock } from "./loto.entity";
import { LotoService } from "./loto.service";
import { LotoController } from "./loto.controller";
import { TopologyModule } from "../topology/topology.module";
import { MqttModule } from "../mqtt/mqtt.module";
import { AuthModule } from "../auth/auth.module";

/** Lockout/tagout — `/loto`, `/devices/:id/loto`, the `loto_lock` table and its beacon. */
@Module({
  imports: [
    TypeOrmModule.forFeature([LotoLock]),
    TopologyModule,
    MqttModule,
    AuthModule,
  ],
  controllers: [LotoController],
  providers: [LotoService],
})
export class LotoModule {}
