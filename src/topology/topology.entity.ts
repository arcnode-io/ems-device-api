import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from "typeorm";

/**
 * One persisted DTM submission. Single-tenant: GET returns the most recent.
 * History is retained for audit; not currently exposed via API.
 *
 * `version` is the semver assigned when this row was persisted, computed by
 * dtm_diff against the prior row per ADR-002 §10.
 */
@Entity()
export class Topology {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "jsonb" })
  dtm!: Record<string, unknown>;

  @Column({ type: "varchar", length: 32, default: "1.0.0" })
  version!: string;

  @CreateDateColumn()
  receivedAt!: Date;
}
