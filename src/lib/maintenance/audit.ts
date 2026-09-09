/**
 * `audit_log` — who did what. Cores call `audit()` after a state change;
 * the row is best-effort (a failed audit write is logged, never thrown).
 */

import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export type AuditActorType = "user" | "maintainer" | "automator" | "system";

export interface AuditEntry {
  actorType: AuditActorType;
  /** `profiles.id` for users, a task id for the maintainer, null for system. */
  actorId?: string | null;
  accountId?: string | null;
  /** Dotted verb, e.g. `attention.acknowledge`, `maintenance.enable`. */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  detail?: Record<string, unknown>;
}

export async function audit(supabase: AdminClient, entry: AuditEntry): Promise<void> {
  const { error } = await supabase.from("audit_log").insert({
    actor_type: entry.actorType,
    actor_id: entry.actorId ?? null,
    account_id: entry.accountId ?? null,
    action: entry.action,
    target_type: entry.targetType ?? null,
    target_id: entry.targetId ?? null,
    detail: entry.detail ?? {},
  });
  if (error) console.error(`[Audit] ${entry.action} not recorded: ${error.message}`);
}
