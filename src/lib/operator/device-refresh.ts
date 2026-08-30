import type { RequestSession } from "@/lib/auth/session";
import { fetchContainerList } from "@/lib/box-api";
import { accountDeviceScopeFilter } from "@/lib/devices/access";

/**
 * Reconcile the account's device states against the live box state and return
 * the fresh `deviceId -> state` map. Unlike a pure DB read, this calls each
 * box's `list_names` through the tunnel, so it is intentionally kept out of
 * page-render paths: clients invoke it once after first paint to converge to
 * box truth without blocking navigation. A box that is unreachable simply
 * leaves its devices on their last-known DB state.
 *
 * Single implementation behind the Server Action
 * (`src/app/actions/avatars.ts` → `refreshDeviceStates`) and the native REST
 * route (`/api/devices/refresh`).
 */
export async function refreshDeviceStatesCore(
  ctx: RequestSession,
  accountId: string,
): Promise<Record<string, string>> {
  const isAdmin = ctx.session.profile.role === "admin";
  if (!isAdmin && accountId !== ctx.session.profile.account_id) return {};

  const filter = await accountDeviceScopeFilter(ctx.supabase, accountId);
  const { data: devices } = await ctx.supabase
    .from("devices")
    .select("id, db_id, box_id, state, boxes(tunnel_hostname)")
    .or(filter);
  if (!devices || devices.length === 0) return {};

  // One live container list per box (not per device).
  const hostByBox = new Map<string, string>();
  for (const d of devices) {
    const box = d.boxes as unknown as { tunnel_hostname: string } | null;
    if (d.box_id && box?.tunnel_hostname) hostByBox.set(d.box_id, box.tunnel_hostname);
  }

  const liveStateByDbId = new Map<string, string>();
  await Promise.all(
    [...hostByBox.values()].map(async (host) => {
      try {
        const data = await fetchContainerList(host);
        for (const c of data.list) liveStateByDbId.set(c.db_id, c.state);
      } catch {
        // Box unreachable -- keep DB state for its devices.
      }
    }),
  );

  const now = new Date().toISOString();
  const result: Record<string, string> = {};
  const updates: PromiseLike<unknown>[] = [];

  for (const d of devices) {
    const live = liveStateByDbId.get(d.db_id as string);
    const state = live ?? (d.state as string);
    result[d.id as string] = state;
    if (live && live !== d.state) {
      updates.push(
        ctx.supabase
          .from("devices")
          .update({ state: live, last_seen: now })
          .eq("id", d.id),
      );
    }
  }

  if (updates.length > 0) await Promise.all(updates);
  return result;
}
