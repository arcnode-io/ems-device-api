/**
 * Subtree expansion for lockout: a lock on a device inhibits everything under
 * it (module → racks). Computed here, not by consumers, because device-api is
 * the only service holding the DTM parent chain — `/asyncapi` carries none.
 */

/** The one DTM field this walk needs. */
export interface HasParent {
  parent?: string | null;
}

/**
 * Every device that is locked itself or sits under a locked device.
 * A locked id absent from `devices` is still returned: the lock row is real
 * even after the device left the topology. Sorted for stable responses.
 * @param devices DTM devices keyed by device_id
 * @param locked device_ids carrying at least one active lock
 * @returns Sorted, de-duplicated device_ids no consumer may write to
 */
export function lockedDevices(
  devices: Record<string, HasParent>,
  locked: Iterable<string>,
): string[] {
  const roots = new Set(locked);
  if (roots.size === 0) return [];
  const out = new Set(roots);
  for (const id of Object.keys(devices)) {
    if (underLockedRoot(devices, id, roots)) out.add(id);
  }
  return [...out].sort();
}

/**
 * Walk the parent chain from `id` looking for a locked ancestor.
 * @param devices DTM devices keyed by device_id
 * @param id Device whose ancestors are checked
 * @param roots Locked device_ids
 * @returns true when some ancestor is locked
 */
function underLockedRoot(
  devices: Record<string, HasParent>,
  id: string,
  roots: Set<string>,
): boolean {
  // Reason: the DTM schema checks that parents resolve, not that the chain is
  // acyclic — a visited set turns a bad manifest into a wrong answer, not a hang.
  const visited = new Set<string>([id]);
  let cursor = devices[id]?.parent;
  while (cursor != null && !visited.has(cursor)) {
    if (roots.has(cursor)) return true;
    visited.add(cursor);
    cursor = devices[cursor]?.parent;
  }
  return false;
}
