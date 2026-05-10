import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { connect, type MqttClient } from "mqtt";

const TOPIC_TOPOLOGY_CHANGED = "system/topology_changed";
const RECONNECT_PERIOD_MS = 5000;

/**
 * MQTT client wrapper. Connects to deployment broker on app boot,
 * publishes system/topology_changed on each topology mutation per
 * ADR-002 §3 + §10 + §11. Anonymous (no auth) per v1.
 */
@Injectable()
export class MqttClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttClientService.name);
  private client?: MqttClient;

  /**
   * Wires NestJS ConfigService for the broker URL.
   * @param cfg ConfigService — reads cfg.yml mqttBrokerUrl
   */
  constructor(private readonly cfg: ConfigService) {}

  /**
   * Connect to the broker on app boot. Reconnects every 5s on failure.
   * Returns immediately; connection is async.
   */
  onModuleInit(): void {
    const url = this.cfg.get<string>("mqttBrokerUrl");
    if (url === undefined) {
      this.logger.warn("mqttBrokerUrl not configured; broadcasts disabled");
      return;
    }
    this.client = connect(url, { reconnectPeriod: RECONNECT_PERIOD_MS });
    this.client.on("connect", () => this.logger.log(`mqtt connected ${url}`));
    this.client.on("error", (err) =>
      this.logger.warn(`mqtt error: ${err.message}`),
    );
  }

  /**
   * Disconnect cleanly on app shutdown.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.client !== undefined) {
      await this.client.endAsync();
    }
  }

  /**
   * Fire-and-forget broadcast that topology version changed.
   * Drops + logs warning if broker is disconnected.
   * @param version New semver string from TopologyService.save
   */
  publishTopologyChanged(version: string): void {
    if (this.client === undefined || !this.client.connected) {
      this.logger.warn(
        `mqtt not connected; dropping topology_changed v${version}`,
      );
      return;
    }
    const payload = JSON.stringify({
      ts: new Date().toISOString(),
      version,
    });
    this.client.publish(
      TOPIC_TOPOLOGY_CHANGED,
      payload,
      { qos: 1, retain: false },
      (err) => {
        if (err) this.logger.warn(`mqtt publish failed: ${err.message}`);
      },
    );
  }
}
