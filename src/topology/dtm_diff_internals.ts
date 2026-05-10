/**
 * Internal diff helpers for dtm_diff.ts — pure, no I/O.
 */
import type { BusType, DeviceType, DtmType } from "./dtm.schema";
import type { Bump } from "./dtm_diff";

const SEVERITY: Record<Bump, number> = {
  none: 0,
  patch: 1,
  minor: 2,
  major: 3,
};

/**
 * Stable JSON with sorted keys — prevents spurious diffs from JSONB key reordering.
 * @param value Any JSON-serializable value.
 * @returns Canonical JSON string with sorted object keys at every level.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const sorted = Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
    )
    .join(",");
  return `{${sorted}}`;
}

/**
 * Structural equality via stableStringify — handles JSONB key-reordering round-trips.
 * @param left Left-hand value.
 * @param right Right-hand value.
 * @returns True when deep-equal.
 */
export function deepEqual(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

/**
 * Returns the higher-severity bump of current vs candidate.
 * @param current Accumulated bump so far.
 * @param candidate Proposed new bump.
 * @returns The higher-severity value.
 */
export function escalate(current: Bump, candidate: Bump): Bump {
  return SEVERITY[candidate] > SEVERITY[current] ? candidate : current;
}

/**
 * Diffs top-level scalar fields; mutates reasons, returns bump.
 * @param prev Previously persisted DTM.
 * @param next Incoming DTM.
 * @param reasons Accumulator for human-readable diff messages.
 * @returns Highest bump severity from top-level scalar fields.
 */
export function diffTopLevel(
  prev: DtmType,
  next: DtmType,
  reasons: string[],
): Bump {
  let bump: Bump = "none";
  if (prev.deployment_uuid !== next.deployment_uuid) {
    reasons.push(
      `deployment_uuid changed: ${prev.deployment_uuid} → ${next.deployment_uuid}`,
    );
    bump = escalate(bump, "major");
  }
  if (prev.ems_mode !== next.ems_mode) {
    reasons.push(`ems_mode changed: ${prev.ems_mode} → ${next.ems_mode}`);
    bump = escalate(bump, "patch");
  }
  if ((prev.sizing_ref ?? null) !== (next.sizing_ref ?? null)) {
    reasons.push(`sizing_ref changed`);
    bump = escalate(bump, "patch");
  }
  if (!deepEqual(prev.sizing_params, next.sizing_params)) {
    reasons.push(`sizing_params changed`);
    bump = escalate(bump, "patch");
  }
  return bump;
}

/**
 * Diffs extra_measurements for one device; mutates reasons, returns bump.
 * @param prevDevice Device from previous DTM.
 * @param nextDevice Device from incoming DTM.
 * @param deviceId Slug key identifying the device.
 * @param reasons Accumulator for human-readable diff messages.
 * @returns Highest bump severity from extra_measurements changes.
 */
export function diffExtraMeasurements(
  prevDevice: DeviceType,
  nextDevice: DeviceType,
  deviceId: string,
  reasons: string[],
): Bump {
  const prevExtra = prevDevice.extra_measurements ?? null;
  const nextExtra = nextDevice.extra_measurements ?? null;
  if (deepEqual(prevExtra, nextExtra)) return "none";
  let bump: Bump = "none";
  const prevKeys = new Set(Object.keys(prevExtra ?? {}));
  const nextKeys = new Set(Object.keys(nextExtra ?? {}));
  const removed = [...prevKeys].filter((key) => !nextKeys.has(key));
  const added = [...nextKeys].filter((key) => !prevKeys.has(key));
  if (removed.length > 0) {
    reasons.push(
      `device extra_measurements removed: ${deviceId} ${removed.join(",")}`,
    );
    bump = escalate(bump, "major");
  }
  if (added.length > 0) {
    reasons.push(
      `device extra_measurements added: ${deviceId} ${added.join(",")}`,
    );
    bump = escalate(bump, "minor");
  }
  return bump;
}

/**
 * Diffs all fields of a device present in both prev and next; mutates reasons, returns bump.
 * @param prevDevice Device from previous DTM.
 * @param nextDevice Device from incoming DTM.
 * @param deviceId Slug key identifying the device.
 * @param reasons Accumulator for human-readable diff messages.
 * @returns Highest bump severity from device field changes.
 */
export function diffDeviceFields(
  prevDevice: DeviceType,
  nextDevice: DeviceType,
  deviceId: string,
  reasons: string[],
): Bump {
  let bump: Bump = "none";
  if (prevDevice.template !== nextDevice.template) {
    reasons.push(
      `device template changed: ${deviceId}: ${prevDevice.template} → ${nextDevice.template}`,
    );
    bump = escalate(bump, "major");
  }
  if ((prevDevice.parent ?? null) !== (nextDevice.parent ?? null)) {
    reasons.push(
      `device parent changed: ${deviceId}: ${prevDevice.parent ?? "null"} → ${nextDevice.parent ?? "null"}`,
    );
    bump = escalate(bump, "minor");
  }
  if ((prevDevice.display_name ?? null) !== (nextDevice.display_name ?? null)) {
    reasons.push(`device display_name changed: ${deviceId}`);
    bump = escalate(bump, "patch");
  }
  if (
    !deepEqual(prevDevice.connection ?? null, nextDevice.connection ?? null)
  ) {
    reasons.push(`device connection changed: ${deviceId}`);
    bump = escalate(bump, "patch");
  }
  if (!deepEqual(prevDevice.blocking, nextDevice.blocking)) {
    reasons.push(`device blocking changed: ${deviceId}`);
    bump = escalate(bump, "patch");
  }
  return escalate(
    bump,
    diffExtraMeasurements(prevDevice, nextDevice, deviceId, reasons),
  );
}

/**
 * Diffs device add/remove/fields across the whole DTM; mutates reasons, returns bump.
 * @param prev Previously persisted DTM.
 * @param next Incoming DTM.
 * @param reasons Accumulator for human-readable diff messages.
 * @returns Highest bump severity from device-level changes.
 */
export function diffDevices(
  prev: DtmType,
  next: DtmType,
  reasons: string[],
): Bump {
  let bump: Bump = "none";
  const prevIds = new Set(Object.keys(prev.devices));
  const nextIds = new Set(Object.keys(next.devices));
  for (const deviceId of nextIds) {
    if (!prevIds.has(deviceId)) {
      reasons.push(`device added: ${deviceId}`);
      bump = escalate(bump, "minor");
    }
  }
  for (const deviceId of prevIds) {
    if (!nextIds.has(deviceId)) {
      reasons.push(`device removed: ${deviceId}`);
      bump = escalate(bump, "major");
    }
  }
  for (const deviceId of prevIds) {
    if (!nextIds.has(deviceId)) continue;
    // Reason: both ids confirmed present above — non-null asserts are safe
    const prevDevice = prev.devices[deviceId]!;
    const nextDevice = next.devices[deviceId]!;
    bump = escalate(
      bump,
      diffDeviceFields(prevDevice, nextDevice, deviceId, reasons),
    );
  }
  return bump;
}

/**
 * Diffs bus member sets for a single bus; mutates reasons, returns bump.
 * @param prevBus Bus from previous DTM.
 * @param nextBus Bus from incoming DTM.
 * @param busId Identifier for the bus being compared.
 * @param reasons Accumulator for human-readable diff messages.
 * @returns Highest bump severity from bus member changes.
 */
export function diffBusMembers(
  prevBus: BusType,
  nextBus: BusType,
  busId: string,
  reasons: string[],
): Bump {
  let bump: Bump = "none";
  // Reason: represent members as stable strings for set comparison
  const prevMembers = new Set(
    prevBus.members.map((member) => `${member.device_id}:${member.port ?? ""}`),
  );
  const nextMembers = new Set(
    nextBus.members.map((member) => `${member.device_id}:${member.port ?? ""}`),
  );
  for (const member of nextMembers) {
    if (!prevMembers.has(member)) {
      reasons.push(`bus member added: ${busId}/${member}`);
      bump = escalate(bump, "minor");
    }
  }
  for (const member of prevMembers) {
    if (!nextMembers.has(member)) {
      reasons.push(`bus member removed: ${busId}/${member}`);
      bump = escalate(bump, "major");
    }
  }
  return bump;
}

/**
 * Diffs bus add/remove/type/members across the whole DTM; mutates reasons, returns bump.
 * @param prev Previously persisted DTM.
 * @param next Incoming DTM.
 * @param reasons Accumulator for human-readable diff messages.
 * @returns Highest bump severity from bus-level changes.
 */
export function diffBuses(
  prev: DtmType,
  next: DtmType,
  reasons: string[],
): Bump {
  let bump: Bump = "none";
  const prevBuses = new Map(prev.buses.map((bus) => [bus.bus_id, bus]));
  const nextBuses = new Map(next.buses.map((bus) => [bus.bus_id, bus]));
  for (const busId of nextBuses.keys()) {
    if (!prevBuses.has(busId)) {
      reasons.push(`bus added: ${busId}`);
      bump = escalate(bump, "minor");
    }
  }
  for (const busId of prevBuses.keys()) {
    if (!nextBuses.has(busId)) {
      reasons.push(`bus removed: ${busId}`);
      bump = escalate(bump, "major");
    }
  }
  for (const [busId, prevBus] of prevBuses) {
    const nextBus = nextBuses.get(busId);
    if (nextBus === undefined) continue;
    if (prevBus.type !== nextBus.type) {
      reasons.push(
        `bus type changed: ${busId}: ${prevBus.type} → ${nextBus.type}`,
      );
      bump = escalate(bump, "major");
    }
    bump = escalate(bump, diffBusMembers(prevBus, nextBus, busId, reasons));
  }
  return bump;
}

/**
 * Diffs templates_used add/remove/body-change; mutates reasons, returns bump.
 * @param prev Previously persisted DTM.
 * @param next Incoming DTM.
 * @param reasons Accumulator for human-readable diff messages.
 * @returns Highest bump severity from templates_used changes.
 */
export function diffTemplates(
  prev: DtmType,
  next: DtmType,
  reasons: string[],
): Bump {
  let bump: Bump = "none";
  const prevSlugs = new Set(Object.keys(prev.templates_used));
  const nextSlugs = new Set(Object.keys(next.templates_used));
  for (const slug of nextSlugs) {
    if (!prevSlugs.has(slug)) {
      reasons.push(`template added: ${slug}`);
      bump = escalate(bump, "minor");
    }
  }
  for (const slug of prevSlugs) {
    if (!nextSlugs.has(slug)) {
      reasons.push(`template removed: ${slug}`);
      bump = escalate(bump, "major");
    }
  }
  for (const slug of prevSlugs) {
    if (!nextSlugs.has(slug)) continue;
    // Reason: both slugs confirmed present above — non-null asserts are safe
    if (!deepEqual(prev.templates_used[slug]!, next.templates_used[slug]!)) {
      reasons.push(`template body changed: ${slug}`);
      bump = escalate(bump, "major");
    }
  }
  return bump;
}
