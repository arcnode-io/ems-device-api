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
 * `version` is the semver assigned when this row was persisted —
 * monotonic patch bump per ADR-002 §10 (MVP simplification; no diff).
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
