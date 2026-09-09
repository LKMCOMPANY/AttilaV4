import { closeBlock } from "@/lib/account-state/blocks";
import { clickNode, typeIntoField } from "@/lib/engine/actor";
import { readTree, readTreeAfterGesture, sleep } from "@/lib/engine/reader";
import { editTexts, findByTextContains, type CompactTree, type TreeNode } from "@/lib/engine/ui/compact-tree";
import { classifyScreen } from "@/lib/engine/ui/screen-state";
import type { SocialPlatform } from "@/types";
import { openAttention, resolveAttentionForTarget } from "../attention";
import { recordAvatarAction } from "../ledger";
import { credentialsFor } from "../runner/device-session";
import { appFor, MAIN_STATES, settleApp } from "../runner/screens";
import { awaitVerificationCode } from "../verification-codes";
import type { RecipeContext, RecipeResult } from "./context";
import { runProbe, writeState } from "./probe";

/**
 * The deterministic re-login (phase 2), TikTok first. Measured on 45.2.3
 * (9 September 2026): the "Welcome back" screen names the account and offers
 * "Log in"; tapping it sends a code to the account's mailbox at once — no
 * password step. So the recipe is: confirm the account on screen is ours, tap
 * Log in, wait for the Email Worker to deliver the code, type it with
 * ADBKeyboard, and read the feed back. One attempt per account per cooldown;
 * every other outcome is a human's, with the screen as proof.
 */

/** "Log in" on the welcome screen, per locale. Never "Sign up", never "Add another account". */
const LOGIN_LABELS = ["log in", "login", "se connecter", "connexion", "iniciar sesión", "anmelden", "تسجيل الدخول"];
/** Markers of the code screen. */
const CODE_SCREEN_MARKERS = ["verify email", "enter the code", "code sent", "vérifier", "code envoyé", "verificar", "código", "bestätigungscode", "رمز"];

const CODE_WAIT_MS = 150_000;
const AFTER_CLICK_SETTLE_MS = 4_000;
const AFTER_CODE_SETTLE_MS = 5_000;

export async function runRelogin(ctx: RecipeContext): Promise<RecipeResult> {
  const platform = ctx.task.platform;
  const target = platform ? appFor(platform) : null;
  if (!platform || !target || platform !== "tiktok") {
    await ctx.journal.skip("relogin", "no relogin recipe for this platform yet");
    return { outcome: "unsupported_platform" };
  }

  const credentials = credentialsFor(ctx.session.avatar, platform);
  const mailbox = credentials?.email ?? null;
  if (!mailbox) {
    await ctx.journal.skip("relogin", "no e-mail in the platform credentials — the code cannot be received");
    await escalateMissingCredentials(ctx, platform);
    return { outcome: "credentials_missing" };
  }

  if (await inCooldown(ctx, platform)) {
    await ctx.journal.skip("relogin", "an attempt already ran within the cooldown");
    return { outcome: "cooldown" };
  }

  const probe = await runProbe(ctx);
  if (probe.outcome !== "logged_out") {
    return { outcome: `not_logged_out_${probe.outcome}`, result: probe.result };
  }

  const { dev } = ctx.session;
  const welcome = await readTree(dev);
  const handle = credentials?.handle?.replace(/^@/, "").toLowerCase();
  const shownHandle = accountOnWelcomeScreen(welcome.tree);
  if (handle && shownHandle && shownHandle.toLowerCase() !== handle) {
    await ctx.journal.step("check_account", async () => ({ detail: `screen shows ${shownHandle}, credentials say ${handle}`, proof: true }));
    await openAttention(ctx.supabase, {
      accountId: ctx.session.avatar.account_id,
      scope: "avatar_platform",
      avatarId: ctx.session.avatar.id,
      platform,
      reason: "handle_invalid",
      severity: "warning",
      title: `Le device propose le compte ${shownHandle}, pas ${handle}`,
      detail: "L'écran « Welcome back » nomme un autre compte que celui des identifiants. Vérifier le handle enregistré.",
      evidence: { observed: shownHandle, expected: handle, proof_path: ctx.journal.lastProofPath() },
      source: "maintainer",
    });
    return { outcome: "account_mismatch" };
  }

  const clickedAt = new Date(Date.now() - 30_000);
  const afterLogin = await ctx.journal.step("tap_log_in", async () => {
    const button = loginButton(welcome.tree);
    if (!button) throw new Error("no Log in button on the welcome screen");
    await clickNode(dev, button);
    await sleep(AFTER_CLICK_SETTLE_MS);
    const read = await readTreeAfterGesture(dev, { previousHash: welcome.tree.hash, expectChange: true });
    const kind = screenKind(read.tree);
    return { read, kind, screenState: kind, detail: shownHandle ? `account ${shownHandle}` : undefined, proof: kind !== "code_screen" };
  });

  if (afterLogin.kind !== "code_screen") {
    await escalateCode(ctx, platform, mailbox, `L'écran après « Log in » n'est pas la saisie du code (${afterLogin.kind}).`);
    return { outcome: `unexpected_${afterLogin.kind}` };
  }

  const code = await ctx.journal.step("await_code", async () => {
    const value = await awaitVerificationCode(ctx.supabase, {
      recipient: mailbox,
      platform,
      since: clickedAt,
      timeoutMs: CODE_WAIT_MS,
      taskId: ctx.task.id,
    });
    return { value, detail: value ? "code received" : `no code for ${mailbox} within ${CODE_WAIT_MS / 1000} s` };
  });
  if (!code.value) {
    await escalateCode(ctx, platform, mailbox, `TikTok a envoyé un code à ${mailbox} ; rien n'est arrivé en ${CODE_WAIT_MS / 1000} s (Email Worker ?).`);
    return { outcome: "code_not_received" };
  }

  const verdict = await ctx.journal.step("enter_code", async () => {
    const field = editTexts(afterLogin.read.tree.nodes)[0];
    if (!field) throw new Error("no code field on the verification screen");
    await typeIntoField(dev, field, code.value!);
    await sleep(AFTER_CODE_SETTLE_MS);
    const settled = await settleApp(dev, target.app);
    return { state: settled.classification.state, screenState: settled.classification.state, proof: true };
  });

  if (MAIN_STATES.includes(verdict.state)) {
    await writeState(ctx, platform, "logged_in", { state: verdict.state, evidence: "relogin", topPackage: target.packageName });
    await closeBlock(ctx.supabase, { avatarId: ctx.session.avatar.id, platform, resolvedBy: "maintainer" });
    await resolveAttentionForTarget(
      ctx.supabase,
      { accountId: ctx.session.avatar.account_id, scope: "avatar_platform", avatarId: ctx.session.avatar.id, platform },
      "reprobe",
      ["needs_login", "email_code"],
    );
    await recordAvatarAction(ctx.supabase, {
      accountId: ctx.session.avatar.account_id,
      avatarId: ctx.session.avatar.id,
      platform,
      action: "login",
      actor: "maintainer",
      timezone: ctx.session.device.timezone,
      refKind: "maintenance_task",
      refId: ctx.task.id,
    });
    return { outcome: "logged_in", result: { screen_state: verdict.state } };
  }

  await escalateCode(ctx, platform, mailbox, `Le code a été saisi mais l'écran est resté « ${verdict.state} ».`);
  return { outcome: `code_rejected_${verdict.state}` };
}

// ---------------------------------------------------------------------------
// Screen reading
// ---------------------------------------------------------------------------

/** The account named on the welcome screen (the text right under "Welcome back"). */
export function accountOnWelcomeScreen(tree: CompactTree): string | null {
  const nodes = tree.nodes;
  const title = nodes.findIndex((n) => /welcome back|bon retour|bienvenido de nuevo|willkommen zurück/i.test(n.text));
  if (title < 0) return null;
  const next = nodes.slice(title + 1, title + 4).find((n) => n.text.trim().length > 0 && !n.clickable);
  return next?.text.trim() ?? null;
}

export function loginButton(tree: CompactTree): TreeNode | null {
  return (
    tree.nodes.find((n) => n.clickable && LOGIN_LABELS.includes(n.text.trim().toLowerCase())) ??
    tree.nodes.find((n) => n.clickable && LOGIN_LABELS.some((l) => n.contentDesc.toLowerCase() === l)) ??
    null
  );
}

export type ReloginScreen = "code_screen" | "password_screen" | "main" | "logged_out" | "other";

export function screenKind(tree: CompactTree): ReloginScreen {
  const fields = editTexts(tree.nodes);
  const words = tree.nodes.map((n) => `${n.text} ${n.contentDesc}`.toLowerCase()).join(" ");
  if (CODE_SCREEN_MARKERS.some((m) => words.includes(m)) && fields.length > 0) return "code_screen";
  if (/password|mot de passe|contraseña|passwort|كلمة المرور/.test(words) && fields.length > 0) return "password_screen";
  const classification = classifyScreen(tree, "tiktok");
  if (MAIN_STATES.includes(classification.state)) return "main";
  if (classification.state === "logged_out") return "logged_out";
  if (findByTextContains(tree.nodes, "code").length > 0 && fields.length > 0) return "code_screen";
  return "other";
}

// ---------------------------------------------------------------------------
// Bookkeeping
// ---------------------------------------------------------------------------

async function inCooldown(ctx: RecipeContext, platform: SocialPlatform): Promise<boolean> {
  const hours = ctx.settings.reloginCooldownHours;
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const { count } = await ctx.supabase
    .from("maintenance_tasks")
    .select("*", { count: "exact", head: true })
    .eq("avatar_id", ctx.session.avatar.id)
    .eq("platform", platform)
    .eq("kind", "relogin")
    .neq("id", ctx.task.id)
    .in("status", ["done", "failed"])
    .gte("finished_at", since);
  return (count ?? 0) > 0;
}

async function escalateCode(ctx: RecipeContext, platform: SocialPlatform, mailbox: string, detail: string) {
  await openAttention(ctx.supabase, {
    accountId: ctx.session.avatar.account_id,
    scope: "avatar_platform",
    avatarId: ctx.session.avatar.id,
    platform,
    reason: "email_code",
    severity: "critical",
    title: "Reconnexion : code e-mail attendu",
    detail: `${detail} Boîte : ${mailbox}.`,
    evidence: { proof_path: ctx.journal.lastProofPath(), expected: mailbox },
    source: "maintainer",
  });
}

async function escalateMissingCredentials(ctx: RecipeContext, platform: SocialPlatform) {
  await openAttention(ctx.supabase, {
    accountId: ctx.session.avatar.account_id,
    scope: "avatar_platform",
    avatarId: ctx.session.avatar.id,
    platform,
    reason: "credentials_missing",
    severity: "warning",
    title: "Reconnexion impossible : e-mail du compte inconnu",
    detail: "Renseigner l'e-mail du compte dans les identifiants de la plateforme ; le code de connexion y est envoyé.",
    source: "maintainer",
  });
}
