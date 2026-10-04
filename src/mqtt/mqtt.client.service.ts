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
 * ADR-002 §3 + §10 + §11. Authenticates as the `arcnode_device_api`
 * File-RBAC identity (username in cfg, password from env
 * MQTT_DEVICE_API_PASSWORD) — the broker rejects anonymous since v1 auth.
 */
const PASSWORD_ENV = "MQTT_DEVICE_API_PASSWORD";

/**
 * Holds the one broker connection this service publishes through, connecting on
 * boot and reconnecting on a fixed period so a broker that is not up yet is an
 * ordinary condition rather than a startup failure.
 */
@Injectable()
export class MqttClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttClientService.name);
  private client?: MqttClient;
  private readonly onConnectListeners: (() => void)[] = [];

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
    const username = this.cfg.get<string>("mqttUsername");
    const password = process.env[PASSWORD_ENV];
    this.client = connect(url, {
      username,
      password,
      reconnectPeriod: RECONNECT_PERIOD_MS,
    });
    this.client.on("connect", () => {
      this.logger.log(`mqtt connected ${url}`);
      for (const listener of this.onConnectListeners) listener();
    });
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
   * Registers a callback to run on every broker (re)connection, and immediately if already
   * connected.
   *
   * Reason: a publish issued before the socket is up is dropped with a warning, and connection is
   * async — so anything that must be announced at startup has to wait for this rather than fire
   * during module init. It runs on reconnection too, since a broker that dropped its session
   * dropped whatever we had told it.
   * @param listener Called after each successful connect
   */
  onConnected(listener: () => void): void {
    this.onConnectListeners.push(listener);
    if (this.client?.connected === true) listener();
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
