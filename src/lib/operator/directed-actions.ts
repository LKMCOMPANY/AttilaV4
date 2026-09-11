import { z } from "zod";
import type { RequestSession } from "@/lib/auth/session";
import { audit } from "@/lib/maintenance/audit";
import {
  DEFAULT_SPREAD_HOURS,
  DIRECTED_ACTIONS,
  MAX_SPREAD_HOURS,
  parseTarget,
  planDirectedSchedule,
  type ScheduleCandidate,
} from "@/lib/maintenance/directed";
import { PRIORITY } from "@/lib/maintenance/scheduler";
import { loadMaintenanceSettings } from "@/lib/maintenance/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { broadcastAccountEvent } from "@/lib/supabase/realtime";
import type { MaintenanceTask, SocialPlatform } from "@/types";

/**
 * A human's order — like, follow or comment on one target — carried by one
 * avatar now, or fanned out over an army in time. The cores only queue and
 * read: the Maintain loop executes (`recipes/directed-action.ts`) with the
 * engine's guard-rails, and the cockpit follows the tasks like any other.
 */

type Result<T> = T | { error: string };

export const directedRequestSchema = z
  .object({
    platform: z.enum(["tiktok", "twitter"]),
    action: z.enum(DIRECTED_ACTIONS),
    target_url: z.string().url(),
    text: z.string().min(1).max(500).optional(),
    avatar_id: z.string().uuid().optional(),
    army_id: z.string().uuid().optional(),
    spread_hours: z.number().min(0).max(MAX_SPREAD_HOURS).optional(),
  })
  .refine((r) => Boolean(r.avatar_id) !== Boolean(r.army_id), { message: "pass exactly one of avatar_id or army_id", path: ["avatar_id"] })
  .refine((r) => r.action !== "comment" || Boolean(r.text?.trim()), { message: "a comment needs `text`", path: ["text"] });

export type DirectedRequestInput = z.infer<typeof directedRequestSchema>;

export interface QueuedOrder {
  task_id: string;
  avatar_id: string;
  avatar_name: string;
  device_id: string;
  scheduled_for: string;
  adjusted: boolean;
}

export interface SkippedAvatar {
  avatar_id: string;
  avatar_name: string;
  reason: "no_device" | "platform_disabled" | "no_handle" | "blocked";
}

export interface DirectedRequestResult {
  request_id: string;
  action: string;
  platform: SocialPlatform;
  target_url: string;
  queued: QueuedOrder[];
  skipped: SkippedAvatar[];
}

interface CandidateRow {
  id: string;
  account_id: string;
  first_name: string;
  last_name: string;
  device_id: string | null;
  tiktok_enabled: boolean;
  twitter_enabled: boolean;
  tiktok_credentials: { handle?: string | null } | null;
  twitter_credentials: { handle?: string | null } | null;
  device: { id: string; box_id: string; timezone: string | null } | null;
}

const CANDIDATE_SELECT =
  "id, account_id, first_name, last_name, device_id, tiktok_enabled, twitter_enabled, tiktok_credentials, twitter_credentials, device:devices(id, box_id, timezone)";

/** The avatars the order addresses, as the caller may see them (RLS). */
async function candidates(ctx: RequestSession, input: DirectedRequestInput): Promise<CandidateRow[]> {
  if (input.avatar_id) {
    const { data } = await ctx.supabase.from("avatars").select(CANDIDATE_SELECT).eq("id", input.avatar_id).is("archived_at", null).maybeSingle();
    return data ? [data as unknown as CandidateRow] : [];
  }
  const { data: links } = await ctx.supabase.from("avatar_armies").select("avatar_id").eq("army_id", input.army_id!);
  const ids = (links ?? []).map((l) => l.avatar_id as string);
  if (ids.length === 0) return [];
  const { data } = await ctx.supabase.from("avatars").select(CANDIDATE_SELECT).in("id", ids).is("archived_at", null).eq("status", "active");
  return (data ?? []) as unknown as CandidateRow[];
}

export async function requestDirectedActionCore(ctx: RequestSession, rawInput: unknown): Promise<Result<DirectedRequestResult>> {
  const parsed = directedRequestSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: `Invalid order: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  }
  const input = parsed.data;
  const target = parseTarget(input.target_url);
  if (!target || target.platform !== input.platform) return { error: "The target URL does not belong to that platform" };
  if (input.action !== "comment" && input.platform !== "tiktok") return { error: "Only comments are carried on X for now; likes and follows are TikTok only" };

  const rows = await candidates(ctx, input);
  if (rows.length === 0) return { error: input.avatar_id ? "Avatar not found" : "No active avatar in that army" };
  const accountIds = new Set(rows.map((r) => r.account_id));
  if (accountIds.size !== 1) return { error: "The army spans several accounts" };
  const accountId = rows[0].account_id;

  const admin = createAdminClient();
  const { data: blockRows } = await admin
    .from("avatar_platform_blocks")
    .select("avatar_id")
    .in("avatar_id", rows.map((r) => r.id))
    .eq("platform", input.platform)
    .is("resolved_at", null);
  const blocked = new Set((blockRows ?? []).map((b) => b.avatar_id as string));

  const skipped: SkippedAvatar[] = [];
  const eligible: (CandidateRow & { device: NonNullable<CandidateRow["device"]> })[] = [];
  for (const row of rows) {
    const name = `${row.first_name} ${row.last_name}`.trim();
    const enabled = input.platform === "tiktok" ? row.tiktok_enabled : row.twitter_enabled;
    const handle = input.platform === "tiktok" ? row.tiktok_credentials?.handle : row.twitter_credentials?.handle;
    if (!row.device_id || !row.device) skipped.push({ avatar_id: row.id, avatar_name: name, reason: "no_device" });
    else if (!enabled) skipped.push({ avatar_id: row.id, avatar_name: name, reason: "platform_disabled" });
    else if (!handle) skipped.push({ avatar_id: row.id, avatar_name: name, reason: "no_handle" });
    else if (blocked.has(row.id)) skipped.push({ avatar_id: row.id, avatar_name: name, reason: "blocked" });
    else eligible.push(row as CandidateRow & { device: NonNullable<CandidateRow["device"]> });
  }
  if (eligible.length === 0) return { error: `No avatar can carry the order (${skipped.map((s) => s.reason).join(", ")})` };

  const settings = await loadMaintenanceSettings(admin);
  const scheduleCandidates: ScheduleCandidate[] = eligible.map((r) => ({ avatarId: r.id, boxId: r.device.box_id, timezone: r.device.timezone }));
  const schedule = planDirectedSchedule(scheduleCandidates, {
    spreadHours: input.spread_hours ?? DEFAULT_SPREAD_HOURS,
    activeHours: settings.activeHours,
    now: new Date(),
  });
  const requestId = crypto.randomUUID();
  const rowsToInsert = schedule.map((order) => {
    const row = eligible.find((r) => r.id === order.avatarId)!;
    return {
      account_id: accountId,
      avatar_id: row.id,
      device_id: row.device.id,
      platform: input.platform,
      kind: "directed_action",
      priority: PRIORITY.directed_action,
      scheduled_for: order.scheduledFor.toISOString(),
      params: {
        action: input.action,
        target_url: input.target_url,
        ...(input.text ? { text: input.text } : {}),
        request_id: requestId,
        requested_by: ctx.session.profile.id,
      },
      created_by: "operator",
    };
  });
  const { data: inserted, error } = await admin.from("maintenance_tasks").insert(rowsToInsert).select("id, avatar_id, device_id, scheduled_for");
  if (error || !inserted) return { error: error?.message ?? "Insertion impossible" };

  const queued: QueuedOrder[] = inserted.map((t) => {
    const row = eligible.find((r) => r.id === t.avatar_id)!;
    return {
      task_id: t.id as string,
      avatar_id: t.avatar_id as string,
      avatar_name: `${row.first_name} ${row.last_name}`.trim(),
      device_id: t.device_id as string,
      scheduled_for: t.scheduled_for as string,
      adjusted: schedule.find((s) => s.avatarId === t.avatar_id)?.adjusted ?? false,
    };
  });

  await audit(admin, {
    actorType: "user",
    actorId: ctx.session.profile.id,
    accountId,
    action: "directed_action.request",
    targetType: input.army_id ? "army" : "avatar",
    targetId: input.army_id ?? input.avatar_id ?? null,
    detail: { request_id: requestId, action: input.action, platform: input.platform, target_url: input.target_url, queued: queued.length, skipped: skipped.length },
  });
  broadcastAccountEvent(accountId, "jobs", { action: "maintenance_task", status: "scheduled", id: requestId });

  return { request_id: requestId, action: input.action, platform: input.platform, target_url: input.target_url, queued, skipped };
}

export interface DirectedRequestStatus {
  request_id: string;
  total: number;
  by_status: Record<string, number>;
  tasks: Pick<MaintenanceTask, "id" | "avatar_id" | "device_id" | "status" | "scheduled_for" | "started_at" | "finished_at" | "outcome" | "error_message" | "result" | "steps">[];
}

/** The tasks of one order, as the caller may see them (RLS). */
export async function getDirectedRequestCore(ctx: RequestSession, requestId: string): Promise<Result<DirectedRequestStatus>> {
  if (!z.string().uuid().safeParse(requestId).success) return { error: "Invalid request id" };
  const { data, error } = await ctx.supabase
    .from("maintenance_tasks")
    .select("id, avatar_id, device_id, status, scheduled_for, started_at, finished_at, outcome, error_message, result, steps")
    .eq("kind", "directed_action")
    .eq("params->>request_id", requestId)
    .order("scheduled_for", { ascending: true });
  if (error) return { error: error.message };
  const tasks = (data ?? []) as DirectedRequestStatus["tasks"];
  if (tasks.length === 0) return { error: "Order not found" };
  const byStatus: Record<string, number> = {};
  for (const task of tasks) byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
  return { request_id: requestId, total: tasks.length, by_status: byStatus, tasks };
}
