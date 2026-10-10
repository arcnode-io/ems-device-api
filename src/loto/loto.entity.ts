import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * One lockout/tagout lock. Active while `clearedAt` is null; every row stays
 * forever, so the table is the state and the audit trail at once. Group
 * lockout: a device carries one row per person holding it, and clearing one
 * never touches another. All timestamps UTC.
 */
@Entity("loto_lock")
export class LotoLock {
  @PrimaryGeneratedColumn()
  id!: number;

  /** DTM device_id slug, exactly as locked. Kept after the device leaves the DTM. */
  @Index()
  @Column({ name: "device_id", type: "varchar", length: 120 })
  deviceId!: string;

  /** Typed by the person at lock time — v1 accounts are role-shared, so the JWT can't name them. */
  @Column({ name: "holder_name", type: "varchar", length: 120 })
  holderName!: string;

  @Column({ name: "permit_ref", type: "varchar", length: 120, nullable: true })
  permitRef!: string | null;

  @Column({ name: "set_at", type: "timestamptz" })
  setAt!: Date;

  @Column({ name: "set_by_role", type: "varchar", length: 32 })
  setByRole!: string;

  @Column({ name: "cleared_at", type: "timestamptz", nullable: true })
  clearedAt!: Date | null;

  @Column({
    name: "cleared_by_role",
    type: "varchar",
    length: 32,
    nullable: true,
  })
  clearedByRole!: string | null;
}
