import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import type { LotoLock } from "./loto.entity";

const NAME_MAX = 120;

export const SetLockRequestSchema = z.object({
  holder_name: z.string().trim().min(1).max(NAME_MAX),
  permit_ref: z.string().trim().max(NAME_MAX).nullish(),
});
export type SetLockRequest = z.infer<typeof SetLockRequestSchema>;

/** Body of POST /devices/{device_id}/loto, with OpenAPI metadata. */
export class SetLockRequestDto extends createZodDto(SetLockRequestSchema) {}

/** One lock row as the contract serializes it. */
export interface LockResponse {
  id: number;
  device_id: string;
  holder_name: string;
  permit_ref: string | null;
  set_at: string;
  set_by_role: string;
  cleared_at: string | null;
  cleared_by_role: string | null;
}

/** GET /loto: the active rows, and the set every consumer must not write to. */
export interface ActiveLocksResponse {
  locks: LockResponse[];
  locked_devices: string[];
}

/**
 * Entity → contract row. Timestamps go out ISO-8601 UTC.
 * @param row Persisted lock
 * @returns Contract shape
 */
export function toLockResponse(row: LotoLock): LockResponse {
  return {
    id: row.id,
    device_id: row.deviceId,
    holder_name: row.holderName,
    permit_ref: row.permitRef,
    set_at: row.setAt.toISOString(),
    set_by_role: row.setByRole,
    cleared_at: row.clearedAt === null ? null : row.clearedAt.toISOString(),
    cleared_by_role: row.clearedByRole,
  };
}
