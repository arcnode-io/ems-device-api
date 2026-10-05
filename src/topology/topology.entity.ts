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

  /**
   * The SLD HMI SVG rendered from this row's DTM. Persisted rather than held in
   * memory because edp-api authors the SVG and is an engineering tool the customer
   * never receives — a shipped EMS that re-rendered on every boot would lose its
   * single-line diagram the first time it restarted. The SVG is a pure function of
   * the DTM, so storing it beside the DTM it belongs to is the whole of the cache.
   *
   * Null until the first successful render: `POST /topology` deliberately does not
   * fail when edp-api is unreachable, so a row can exist before its SVG does.
   */
  @Column({ type: "bytea", nullable: true })
  sldSvg!: Buffer | null;

  @CreateDateColumn()
  receivedAt!: Date;
}
