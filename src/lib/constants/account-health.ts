import type {
  AccountHealthStatus,
  AvatarBlockReason,
  AvatarBlockSource,
  AvatarPlatformBlock,
  AvatarPlatformHealth,
  SocialPlatform,
} from "@/types";

// ---------------------------------------------------------------------------
// Account health — the presentation model shown to operators.
//
// The raw DB signal (`avatar_platform_health.status`, from TikHub) is only ONE
// input. What operators actually need is a single verdict per (avatar,
// platform) that also says HOW SURE we are, by folding in two more signals we
// already have:
//   - on-device evidence (a job failed on the login / block / captcha screen —
//     we SAW it, so it's certain),
//   - the off-device cross-check (posts left the device but TikHub can't find
//     them = a likely shadow-ban).
//
// Framework-free on purpose (pure strings + logic) so it can be imported by
// any component without pulling in JSX. Icons/colours live in the badge.
// ---------------------------------------------------------------------------

/** On-device, account-level failure the automation actually observed. */
export type DeviceAccountIssue = "logged_out" | "blocked" | "captcha";

export interface AccountHealthSignals {
  /** Public profile status from TikHub (`avatar_platform_health.status`). */
  tikhub?: AccountHealthStatus | null;
  /** Latest on-device account-level failure, when the most recent attempt hit one. */
  deviceIssue?: DeviceAccountIssue | null;
  /** Posts reported sent on-device but not confirmed live by TikHub. */
  shadowBan?: boolean;
  /**
   * At least one post was independently confirmed live recently — proof the
   * account works, regardless of what the profile lookup says. Turns a
   * `notfound` into a mere "wrong @handle" note instead of a dead-account alarm.
   */
  confirmed?: boolean;
}

export type AccountHealthKind =
  // Certain — hard evidence, operator must act
  | "logged_out"
  | "blocked"
  | "captcha"
  | "suspended"
  // Probable — soft signal, worth a look
  | "unresolved"
  | "handle_mismatch"
  | "shadow_ban"
  // Fine / not yet known
  | "live"
  | "unchecked";

export type AccountHealthTone = "critical" | "watch" | "ok" | "muted";

interface KindMeta {
  label: string;
  tone: AccountHealthTone;
  /** Base tooltip; callers may append context (followers, last-checked). */
  hint: string;
  /** Ranking for "worst across platforms" — higher wins. */
  severity: number;
}

export const ACCOUNT_HEALTH_META: Record<AccountHealthKind, KindMeta> = {
  logged_out: {
    label: "Logged out",
    tone: "critical",
    hint: "The device hit the login screen — the session expired. Reconnect the account to resume.",
    severity: 70,
  },
  suspended: {
    label: "Suspended",
    tone: "critical",
    hint: "The platform suspended this account — nothing it posts goes live. Replace or appeal the account.",
    severity: 65,
  },
  blocked: {
    label: "Blocked",
    tone: "critical",
    hint: "The platform restricted this account on the device. An operator needs to clear it before it can post.",
    severity: 60,
  },
  captcha: {
    label: "Captcha",
    tone: "critical",
    hint: "The account hit a captcha / verification challenge on the device. Solve it to resume.",
    severity: 55,
  },
  unresolved: {
    label: "Unresolved handle",
    tone: "watch",
    hint: "The saved @handle matches no findable account. It may be deleted, renamed, or banned — or the @handle stored in Attila is wrong. Verify it.",
    severity: 40,
  },
  handle_mismatch: {
    label: "Handle to fix",
    tone: "watch",
    hint: "This account has confirmed posts (it works), but the saved @handle doesn't resolve — the credential stored in Attila is likely wrong. Fix the @handle for accurate tracking; no action needed on the account itself.",
    severity: 20,
  },
  shadow_ban: {
    label: "Likely shadow-ban",
    tone: "watch",
    hint: "Posts leave the device but the independent TikHub check can't find them on the platform — a likely shadow-ban or silent drop. Monitor this account.",
    severity: 30,
  },
  live: {
    label: "Live",
    tone: "ok",
    hint: "Account is live on the platform.",
    severity: 10,
  },
  unchecked: {
    label: "Unchecked",
    tone: "muted",
    hint: "Account health hasn't been checked yet.",
    severity: 0,
  },
};

/**
 * Fold the raw signals into a single verdict, most-certain first. On-device
 * evidence outranks TikHub (we literally saw the screen), and a hard state
 * (logged out / suspended) outranks a soft one (unresolved handle / shadow-ban).
 *
 * The post signal is treated as ground truth over the profile lookup: a handle
 * that doesn't resolve on an account we've CONFIRMED posting is a wrong stored
 * @handle (`handle_mismatch`), not a dead account.
 */
export function deriveAccountHealth(signals: AccountHealthSignals): AccountHealthKind {
  const { tikhub, deviceIssue, shadowBan, confirmed } = signals;
  if (deviceIssue === "logged_out") return "logged_out";
  if (deviceIssue === "blocked") return "blocked";
  if (deviceIssue === "captcha") return "captcha";
  if (tikhub === "suspended") return "suspended";
  if (tikhub === "notfound") return confirmed ? "handle_mismatch" : "unresolved";
  if (shadowBan) return "shadow_ban";
  if (tikhub === "active" || confirmed) return "live";
  return "unchecked";
}

/**
 * Whether the account needs a look in the list / attention filter. Critical and
 * watch qualify — EXCEPT `handle_mismatch`: that account demonstrably works
 * (confirmed posts), only its stored @handle is wrong, so it's a data fix, not
 * an operational alert. It still shows in the per-platform overview badge.
 */
export function isAlarmingKind(kind: AccountHealthKind): boolean {
  if (kind === "handle_mismatch") return false;
  const tone = ACCOUNT_HEALTH_META[kind].tone;
  return tone === "critical" || tone === "watch";
}

// ---------------------------------------------------------------------------
// Account state — the gating set + kind <-> block-reason bridges.
//
// A `kind` is what the operator SEES; a block `reason` is what we PERSIST in
// `avatar_platform_blocks`. `isBlockingKind` is the single definition of
// "this state makes the avatar non-callable" — the guardrail policy validated
// with the product: every alarming kind EXCEPT `handle_mismatch` (a working
// account whose stored @handle is just wrong). It happens to equal
// `isAlarmingKind` today, but is kept separate so the visual and the gating
// policies can diverge without a silent behaviour change.
// ---------------------------------------------------------------------------

/** True when a verdict should stop the Automator from calling the avatar. */
export function isBlockingKind(kind: AccountHealthKind): boolean {
  switch (kind) {
    case "logged_out":
    case "blocked":
    case "captcha":
    case "suspended":
    case "unresolved":
    case "shadow_ban":
      return true;
    default:
      return false;
  }
}

/** Presentation kind for a persisted block reason (for badges / labels). */
export function blockReasonToKind(reason: AvatarBlockReason): AccountHealthKind {
  switch (reason) {
    case "logged_out":
      return "logged_out";
    case "captcha":
      return "captcha";
    case "suspended":
      return "suspended";
    case "notfound":
      return "unresolved";
    case "shadow_ban":
      return "shadow_ban";
    case "blocked":
    case "manual":
      return "blocked";
  }
}

/**
 * The persisted block descriptor a derived verdict maps to, or `null` when the
 * kind is not blocking. Used by the health worker's reconcile pass to turn a
 * TikHub / shadow-ban verdict into an `avatar_platform_blocks` row — on-device
 * failures are written directly by the executor, so they never reach here.
 */
export function blockDescriptorFromKind(
  kind: AccountHealthKind,
): { reason: AvatarBlockReason; source: AvatarBlockSource } | null {
  switch (kind) {
    case "suspended":
      return { reason: "suspended", source: "tikhub" };
    case "unresolved":
      return { reason: "notfound", source: "tikhub" };
    case "shadow_ban":
      return { reason: "shadow_ban", source: "verification" };
    case "logged_out":
      return { reason: "logged_out", source: "on_device" };
    case "blocked":
      return { reason: "blocked", source: "on_device" };
    case "captcha":
      return { reason: "captcha", source: "on_device" };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Per-avatar aggregation (operator list dot + "needs attention" filter)
// ---------------------------------------------------------------------------

/** Per-platform on-device / verification signals for one avatar. */
export type AvatarHealthSignals = Partial<Record<SocialPlatform, {
  deviceIssue?: DeviceAccountIssue | null;
  shadowBan?: boolean;
  confirmed?: boolean;
}>>;

export interface PlatformHealthVerdict {
  platform: SocialPlatform;
  kind: AccountHealthKind;
  /** The TikHub row (for followers / last-checked in the tooltip), if any. */
  health: AvatarPlatformHealth | null;
}

/** Platforms with account-health probing + guardrail gating today. */
export const HEALTH_PLATFORMS: SocialPlatform[] = ["twitter", "tiktok"];

/**
 * Compute the health verdict for each platform the avatar could be checked on,
 * merging its TikHub rows with the on-device / shadow-ban signals. Only returns
 * platforms that carry at least one real signal (keeps a fresh fleet quiet).
 *
 * When the avatar's active guardrail blocks are provided, a blocked platform's
 * verdict comes from the BLOCK (the authoritative "not callable" state, which
 * persists until resolved) instead of the time-windowed derived signals — this
 * is what keeps the list dot honest without re-calling the avatar.
 */
export function avatarPlatformVerdicts(
  platformHealth: AvatarPlatformHealth[] | undefined | null,
  signals: AvatarHealthSignals | undefined,
  blocks?: AvatarPlatformBlock[] | null,
): PlatformHealthVerdict[] {
  const byPlatform = new Map<SocialPlatform, AvatarPlatformHealth>();
  for (const row of platformHealth ?? []) byPlatform.set(row.platform, row);

  const blockByPlatform = new Map<SocialPlatform, AvatarPlatformBlock>();
  for (const block of blocks ?? []) blockByPlatform.set(block.platform, block);

  // Manual blocks can exist on platforms outside the probed set — include them.
  const platforms = new Set<SocialPlatform>([...HEALTH_PLATFORMS, ...blockByPlatform.keys()]);

  const verdicts: PlatformHealthVerdict[] = [];
  for (const platform of platforms) {
    const health = byPlatform.get(platform) ?? null;
    const sig = signals?.[platform];
    const block = blockByPlatform.get(platform) ?? null;
    if (!health && !sig && !block) continue;
    const kind = block
      ? blockReasonToKind(block.reason)
      : deriveAccountHealth({
          tikhub: health?.status,
          deviceIssue: sig?.deviceIssue,
          shadowBan: sig?.shadowBan,
          confirmed: sig?.confirmed,
        });
    verdicts.push({ platform, kind, health });
  }
  return verdicts;
}

/** The most severe verdict across an avatar's platforms (null when none). */
export function worstAvatarVerdict(
  platformHealth: AvatarPlatformHealth[] | undefined | null,
  signals: AvatarHealthSignals | undefined,
  blocks?: AvatarPlatformBlock[] | null,
): PlatformHealthVerdict | null {
  const verdicts = avatarPlatformVerdicts(platformHealth, signals, blocks);
  if (verdicts.length === 0) return null;
  return verdicts.reduce((worst, v) =>
    ACCOUNT_HEALTH_META[v.kind].severity > ACCOUNT_HEALTH_META[worst.kind].severity
      ? v
      : worst,
  );
}

/** True when at least one platform needs a look (critical or watch). */
export function avatarNeedsAttention(
  platformHealth: AvatarPlatformHealth[] | undefined | null,
  signals: AvatarHealthSignals | undefined,
  blocks?: AvatarPlatformBlock[] | null,
): boolean {
  const worst = worstAvatarVerdict(platformHealth, signals, blocks);
  return worst !== null && isAlarmingKind(worst.kind);
}
