import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Repository } from "typeorm";
import { LotoLock } from "./loto.entity";
import { lockedDevices } from "./locked_devices";
import {
  toLockResponse,
  type ActiveLocksResponse,
  type LockResponse,
  type SetLockRequest,
} from "./loto.dto";
import { TopologyService } from "../topology/topology.service";
import { MqttClientService } from "../mqtt/mqtt.client.service";
import type { RoleType } from "../auth/auth.types";

/**
 * Lockout/tagout state. Group lockout: a device is locked while at least one
 * row for it has no `clearedAt`; one person's clear never lifts another's.
 * Every set and clear is followed by a `system/loto_changed` beacon, and the
 * beacon is repeated on every broker connect so a consumer that booted
 * before us, or outlived a broker restart, re-reads the state.
 */
@Injectable()
export class LotoService implements OnModuleInit {
  private readonly logger = new Logger(LotoService.name);

  /**
   * Wires the lock repository, the topology (for device existence and the
   * parent chain) and the broker client.
   * @param repo TypeORM repository for LotoLock rows
   * @param topology Latest DTM source
   * @param mqtt Broker client for the loto_changed beacon
   */
  constructor(
    @InjectRepository(LotoLock)
    private readonly repo: Repository<LotoLock>,
    private readonly topology: TopologyService,
    private readonly mqtt: MqttClientService,
  ) {}

  /** Beacon on every (re)connect — same rule as the topology beacon. */
  onModuleInit(): void {
    this.mqtt.onConnected(() => this.mqtt.publishLotoChanged());
  }

  /**
   * Active locks plus the expanded set of devices they inhibit.
   * @returns Locks oldest-first, and the sorted locked device set
   */
  async active(): Promise<ActiveLocksResponse> {
    const rows = await this.repo.find({
      where: { clearedAt: IsNull() },
      order: { setAt: "ASC", id: "ASC" },
    });
    const dtm = await this.topology.getLatest();
    return {
      locks: rows.map(toLockResponse),
      locked_devices: lockedDevices(
        dtm?.devices ?? {},
        rows.map((row) => row.deviceId),
      ),
    };
  }

  /**
   * Every row ever written for a device, newest first. A device that left the
   * DTM keeps its history.
   * @param deviceId DTM device_id
   * @returns Rows newest first
   */
  async history(deviceId: string): Promise<LockResponse[]> {
    const rows = await this.repo.find({
      where: { deviceId },
      order: { setAt: "DESC", id: "DESC" },
    });
    return rows.map(toLockResponse);
  }

  /**
   * Add one person's lock to a device.
   * @param deviceId Device to lock; must be in the current DTM
   * @param request Holder and optional permit, already trimmed by validation
   * @param role Role claim of the caller's token
   * @returns The new row
   * @throws NotFoundException when the device is not in the DTM
   * @throws ConflictException when that holder already holds an active lock on it
   */
  async set(
    deviceId: string,
    request: SetLockRequest,
    role: RoleType,
  ): Promise<LockResponse> {
    const dtm = await this.topology.getLatest();
    if (dtm === null || !(deviceId in dtm.devices)) {
      throw new NotFoundException(`device ${deviceId} is not in the topology`);
    }
    const holder = request.holder_name;
    const activeHere = await this.repo.find({
      where: { deviceId, clearedAt: IsNull() },
    });
    // Reason: names are typed, so "Tech One" and "tech one" are the same person
    // double-clicking, not two people. ILIKE would read "_" as a wildcard.
    const duplicate = activeHere.some(
      (row) => row.holderName.toLowerCase() === holder.toLowerCase(),
    );
    if (duplicate) {
      throw new ConflictException(
        `${holder} already holds an active lock on ${deviceId}`,
      );
    }
    const saved = await this.repo.save(
      this.repo.create({
        deviceId,
        holderName: holder,
        permitRef: request.permit_ref ?? null,
        setAt: new Date(),
        setByRole: role,
        clearedAt: null,
        clearedByRole: null,
      }),
    );
    this.logger.log(`lock ${saved.id} set on ${deviceId} by ${holder}`);
    this.mqtt.publishLotoChanged();
    return toLockResponse(saved);
  }

  /**
   * Clear exactly one lock row.
   * @param id Lock id
   * @param role Role claim of the caller's token
   * @returns The row, now cleared
   * @throws NotFoundException when no such id
   * @throws ConflictException when it was already cleared
   */
  async clear(id: number, role: RoleType): Promise<LockResponse> {
    const row = await this.repo.findOne({ where: { id } });
    if (row === null) throw new NotFoundException(`no lock ${id}`);
    if (row.clearedAt !== null) {
      throw new ConflictException(`lock ${id} was already cleared`);
    }
    row.clearedAt = new Date();
    row.clearedByRole = role;
    const saved = await this.repo.save(row);
    this.logger.log(`lock ${id} cleared on ${row.deviceId}`);
    this.mqtt.publishLotoChanged();
    return toLockResponse(saved);
  }
}
