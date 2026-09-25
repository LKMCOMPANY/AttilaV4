/**
 * The one reading of `boxes.maintenance_until`, shared by the server (slot
 * arbiter, presence writer, reaper) and the client vocabularies: a window is
 * open while `now < maintenance_until`. Pure and framework-free so a client
 * component can import it without dragging the box API in.
 */
export function isMaintenanceOpen(maintenanceUntil: string | null | undefined, now: Date = new Date()): boolean {
  return maintenanceUntil != null && new Date(maintenanceUntil).getTime() > now.getTime();
}
