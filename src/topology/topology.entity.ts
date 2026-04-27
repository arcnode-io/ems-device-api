import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from "typeorm";

/**
 * One persisted DTM submission. Single-tenant: GET returns the most recent.
 * History is retained for audit; not currently exposed via API.
 */
@Entity()
export class Topology {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "jsonb" })
  dtm!: Record<string, unknown>;

  @CreateDateColumn()
  receivedAt!: Date;
}
