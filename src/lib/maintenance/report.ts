import type { SupabaseClient } from "@supabase/supabase-js";
import type { AvatarActionKind, MaintenanceTaskStatus, OnDeviceStatus, SocialPlatform } from "@/types";

/**
 * The weekly report of the maintainer (phase 3), per avatar and for the
 * account: what ran, what it did, what it escalated — and the self-audit that
 * a bot detector would run on us: are the sessions too regular to be human?
 * Pure aggregation over rows the caller is allowed to read (RLS applies).
 */

export interface AvatarReportRow {
  avatar_id: string;
  name: string;
  platform: SocialPlatform | null;
  on_device_status: OnDeviceStatus | null;
  sessions: number;
  likes: number;
  follows: number;
  logins: number;
  tasks: Partial<Record<MaintenanceTaskStatus, number>>;
  attention_opened: number;
  stale_reads: number;
  /** 0 = metronome, 1 = human-like spread of session start minutes across the day. */
  regularity_spread: number | null;
  candidates: { total: number; followed: number };
}

export interface MaintenanceReport {
  from: string;
  to: string;
  avatars: AvatarReportRow[];
  totals: { sessions: number; likes: number; follows: number; logins: number; attention_opened: number; failed_tasks: number };
  /** Avatars whose sessions start at the same minutes every day — worth a look. */
  too_regular: string[];
}

interface ActionRow {
  avatar_id: string;
  action: AvatarActionKind;
  occurred_at: string;
}

interface TaskRow {
  avatar_id: string;
  status: MaintenanceTaskStatus;
  result: Record<string, unknown> | null;
}

/**
 * Spread of session start times as minutes-of-day: the mean pairwise distance
 * normalised by the maximum possible (720 min). One session, or none, gives
 * no verdict. Under 0.05 on three sessions or more reads like a cron job.
 */
export function regularitySpread(startMinutes: number[]): number | null {
  if (startMinutes.length < 2) return null;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < startMinutes.length; i++) {
    for (let j = i + 1; j < startMinutes.length; j++) {
      const raw = Math.abs(startMinutes[i] - startMinutes[j]);
      total += Math.min(raw, 1440 - raw);
      pairs++;
    }
  }
  return Math.round((total / pairs / 720) * 1000) / 1000;
}

export const TOO_REGULAR_THRESHOLD = 0.05;

export async function buildMaintenanceReport(
  supabase: SupabaseClient,
  accountId: string,
  days: number,
  now = new Date(),
): Promise<MaintenanceReport> {
  const to = now.toISOString();
  const from = new Date(now.getTime() - days * 86_400_000).toISOString();

  const [{ data: avatars }, { data: actions }, { data: tasks }, { data: items }, { data: states }, { data: candidates }] =
    await Promise.all([
      supabase
        .from("avatars")
        .select("id, first_name, last_name, tiktok_enabled, twitter_enabled")
        .eq("account_id", accountId)
        .eq("maintenance_enabled", true)
        .is("archived_at", null),
      supabase.from("avatar_actions").select("avatar_id, action, occurred_at").eq("account_id", accountId).eq("actor", "maintainer").gte("occurred_at", from),
      supabase.from("maintenance_tasks").select("avatar_id, status, result").eq("account_id", accountId).gte("created_at", from),
      supabase.from("attention_items").select("avatar_id").eq("account_id", accountId).gte("opened_at", from),
      supabase.from("avatar_platform_state").select("avatar_id, platform, on_device_status"),
      supabase.from("cluster_candidates").select("avatar_id, status").eq("account_id", accountId),
    ]);

  const rows: AvatarReportRow[] = [];
  const totals = { sessions: 0, likes: 0, follows: 0, logins: 0, attention_opened: 0, failed_tasks: 0 };
  const tooRegular: string[] = [];

  for (const avatar of avatars ?? []) {
    const mine = ((actions ?? []) as ActionRow[]).filter((a) => a.avatar_id === avatar.id);
    const count = (kind: AvatarActionKind) => mine.filter((a) => a.action === kind).length;
    const myTasks = ((tasks ?? []) as TaskRow[]).filter((t) => t.avatar_id === avatar.id);
    const taskCounts: Partial<Record<MaintenanceTaskStatus, number>> = {};
    let stale = 0;
    for (const task of myTasks) {
      taskCounts[task.status] = (taskCounts[task.status] ?? 0) + 1;
      stale += Number(task.result?.stale_reads ?? 0);
    }
    const platform: SocialPlatform | null = avatar.tiktok_enabled ? "tiktok" : avatar.twitter_enabled ? "twitter" : null;
    const state = (states ?? []).find((s) => s.avatar_id === avatar.id && s.platform === platform);
    const myCandidates = (candidates ?? []).filter((c) => c.avatar_id === avatar.id);
    const spread = regularitySpread(
      mine.filter((a) => a.action === "session").map((a) => {
        const d = new Date(a.occurred_at);
        return d.getUTCHours() * 60 + d.getUTCMinutes();
      }),
    );
    const name = `${avatar.first_name} ${avatar.last_name}`.trim();
    if (spread !== null && spread < TOO_REGULAR_THRESHOLD && count("session") >= 3) tooRegular.push(name);

    const row: AvatarReportRow = {
      avatar_id: avatar.id,
      name,
      platform,
      on_device_status: (state?.on_device_status as OnDeviceStatus | undefined) ?? null,
      sessions: count("session"),
      likes: count("like"),
      follows: count("follow"),
      logins: count("login"),
      tasks: taskCounts,
      attention_opened: (items ?? []).filter((i) => i.avatar_id === avatar.id).length,
      stale_reads: stale,
      regularity_spread: spread,
      candidates: { total: myCandidates.length, followed: myCandidates.filter((c) => c.status === "followed").length },
    };
    rows.push(row);
    totals.sessions += row.sessions;
    totals.likes += row.likes;
    totals.follows += row.follows;
    totals.logins += row.logins;
    totals.attention_opened += row.attention_opened;
    totals.failed_tasks += taskCounts.failed ?? 0;
  }

  rows.sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
  return { from, to, avatars: rows, totals, too_regular: tooRegular };
}
