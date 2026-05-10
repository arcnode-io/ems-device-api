import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { MqttClientService } from "./mqtt.client.service";

/**
 *
 */
@Module({
  imports: [ConfigModule],
  providers: [MqttClientService],
  exports: [MqttClientService],
})
export class MqttModule {}
