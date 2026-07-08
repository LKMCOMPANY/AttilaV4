import type { AccountHealthStatus, AvatarPlatformHealth } from "@/types";

// ---------------------------------------------------------------------------
// Account health — shared, framework-free helpers (usable in any component).
// The visual config (icons/colors) lives in the badge component; this module
// stays pure so it can be imported anywhere without pulling in JSX.
// ---------------------------------------------------------------------------

// Higher = more severe. Drives "worst status across an avatar's platforms".
const SEVERITY: Record<AccountHealthStatus, number> = {
  notfound: 3,
  suspended: 2,
  unknown: 1,
  active: 0,
};

/** A status the operator must act on — the account genuinely can't publish. */
export function isAccountHealthAlarming(status: AccountHealthStatus): boolean {
  return status === "suspended" || status === "notfound";
}

/**
 * The most severe health row across an avatar's probed platforms (null when
 * nothing has been probed). Used for the at-a-glance dot in the avatar list.
 */
export function worstAccountHealth(
  health: AvatarPlatformHealth[] | undefined | null,
): AvatarPlatformHealth | null {
  if (!health || health.length === 0) return null;
  return health.reduce((worst, row) =>
    SEVERITY[row.status] > SEVERITY[worst.status] ? row : worst,
  );
}
