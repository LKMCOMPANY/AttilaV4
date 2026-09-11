/**
 * Screen-state classifier: what is on the device right now, decided from the
 * accessibility tree alone, top window first.
 *
 * The taxonomy is the one measured on the fleet on 9 September 2026
 * (MAINTENANCE-AGENT.md §2.4 and the phase 0-A sessions). Every state carries a
 * single safe reaction (`SAFE_REACTION`) so recipes never improvise on a screen
 * they did not expect: interface obstacles are dismissed or classified further
 * by vision, security obstacles stop the session and go to a human.
 *
 * Pure function of the parsed tree — no device I/O.
 */

import {
  editTexts,
  findByDescContains,
  findByTextContains,
  packagesOf,
  visibleText,
  type CompactTree,
  type TreeNode,
} from "./compact-tree";

export type SocialApp = "tiktok" | "twitter";

export type ScreenState =
  | "feed_ok"
  | "post_detail"
  | "comments_panel"
  | "profile"
  | "search"
  | "logged_out"
  | "consent_dialog"
  | "plan_consent"
  | "link_email_dialog"
  | "permission_dialog"
  | "system_permission"
  | "settings_sheet"
  | "opaque_overlay"
  | "off_path"
  | "version_wall"
  | "playstore_sheet"
  | "payment_error"
  | "content_unavailable"
  | "network_error"
  | "bouncer"
  | "loading"
  | "empty_tree"
  | "unknown";

/**
 * How a recipe may react to a state without a human. `stop` states are the
 * account-security obstacles: never retried, always escalated with a proof.
 */
export type SafeReaction =
  | "proceed"
  | "back"
  | "dismiss_not_now"
  | "deny_permission"
  | "choose_free_option"
  | "reread"
  | "vision"
  | "stop";

export const SAFE_REACTION: Record<ScreenState, SafeReaction> = {
  feed_ok: "proceed",
  post_detail: "proceed",
  comments_panel: "proceed",
  profile: "proceed",
  search: "proceed",
  logged_out: "stop",
  consent_dialog: "choose_free_option",
  plan_consent: "choose_free_option",
  link_email_dialog: "dismiss_not_now",
  permission_dialog: "dismiss_not_now",
  system_permission: "deny_permission",
  settings_sheet: "back",
  opaque_overlay: "back",
  off_path: "back",
  version_wall: "stop",
  playstore_sheet: "back",
  payment_error: "back",
  content_unavailable: "stop",
  network_error: "stop",
  bouncer: "stop",
  loading: "reread",
  empty_tree: "reread",
  unknown: "vision",
};

export interface Classification {
  state: ScreenState;
  /** The marker that decided, for the step journal and for tests. */
  evidence: string;
  topPackage: string | null;
}

const SYSTEM_PERMISSION_PACKAGES = [
  "com.android.permissioncontroller",
  "com.google.android.permissioncontroller",
];
const PLAY_STORE_PACKAGE = "com.android.vending";
/**
 * Windows that float over the app without being the screen: a heads-up
 * notification, the status bar, a volume panel. Measured 10 September 2026 on
 * box-1 (US43): an X notification ("REPLY REPOST LIKE") over the TikTok splash
 * lifted a 6-node loading tree above the loading threshold and a probe called
 * the feed `unknown`. Ignored whenever the app itself has nodes in the tree.
 */
const TRANSIENT_OVERLAY_PACKAGES = ["com.android.systemui"];

// Marker lists are lower-case substrings; EN / FR / ES / DE as met on the fleet.
const M = {
  versionWall: ["this app is out of date", "app is out of date", "está desactualizada", "ist veraltet", "n'est plus à jour"],
  bouncer: ["performing security verification", "vérification de sécurité", "verificación de seguridad"],
  paymentError: ["failed to load payment state"],
  contentUnavailable: [
    "cannot retrieve posts",
    "impossible de récupérer les posts",
    "no se pueden recuperar las publicaciones",
    "this post is unavailable",
    "this tweet is unavailable",
    "cette publication n'est pas disponible",
    "ce post n'est pas disponible",
    "hmm...this page doesn't exist",
    "cette page n'existe pas",
    "account suspended",
    "compte a été suspendu",
    "vidéo non disponible",
    "video unavailable",
    "couldn't find this account",
  ],
  networkPhrase: ["something went wrong", "un problème est survenu", "algo salió mal", "etwas ist schiefgelaufen", "no network connection", "no internet connection"],
  networkRetry: ["try reloading", "try again", "retry", "réessayer", "reintentar", "erneut versuchen", "tap to retry"],
  xLoggedOut: ["see what's happening", "continue with phone", "login with username", "sign in to x", "log in to x", "create account", "connecte-toi", "crée un compte", "inicia sesión", "sign in to twitter"],
  xFeed: ["for you", "pour vous", "para ti", "für dich"],
  xFeedSecondary: ["following", "abonnements", "siguiendo", "home", "accueil", "inicio", "startseite"],
  xPostDetail: ["post your reply", "postez votre réponse", "publica tu respuesta", "antwort posten"],
  // A post's action bar: "Repost" reads the same in EN, FR (Reposter), ES (Repostear) and DE (Reposten).
  xPostActions: ["repost"],
  ttLoggedOut: ["welcome back", "log in to tiktok", "connecte-toi à tiktok", "inicia sesión en tiktok", "sign up for tiktok"],
  ttLoggedOutSecondary: ["log in", "add another account", "sign up", "se connecter", "iniciar sesión"],
  ttFeedDesc: ["like video", "read or add comments", "lire ou ajouter des commentaires", "leer o añadir comentarios"],
  ttFeedTabs: ["for you", "pour toi", "para ti", "für dich"],
  consent: [
    "choisir comment afficher les publicités",
    "choose your ads experience",
    "ads experience",
    "pubs personnalisées",
    "personalised ads",
    "personalized ads",
    // TikTok Shop personalisation sheet, DE (measured 11/09/2026 on DE3, mid-feed).
    "mehr auf dich zuschneiden",
    "personalisierter tiktok shop",
  ],
  planConsent: ["pick your plan", "standard (with ads)", "ad-free", "choose your plan"],
  linkEmail: ["link email", "lier un e-mail", "vincular correo"],
  inAppPermission: ["give tiktok access to your facebook", "access your contacts", "find your friends", "sync your contacts"],
  settingsSheet: ["viewer history", "turned on", "activé", "activado"],
  // X's photo action sheet (a press that landed on an image). Measured es-ES 11/09/2026.
  photoSheet: ["copiar foto", "guardar foto", "postear foto", "copy photo", "save photo", "copier la photo", "enregistrer la photo"],
  profile: ["followers", "abonnés", "seguidores", "follower"],
  profileSecondary: ["following", "abonnements", "siguiendo", "likes", "j'aime", "me gusta"],
  search: ["search", "rechercher", "buscar", "suchen"],
} as const;

const OPAQUE_MAX_BYTES = 6_000;
const OPAQUE_UNRESOLVED_DESC = /^@\d{8,}$/;
const LOADING_MAX_NODES = 12;

// X hides its "For you / Following" header once the timeline scrolls; the
// post rows are then the proof of the feed. Measured 11 September 2026 on
// box-1: 11.96 (View ids) and 12.24 (Compose test tags used as resource ids).
// A tall video post pushes its row's root off screen (FR8, scroll 13 of 25):
// the action bar under it is then the only post signature left.
const X_HOME_IDS = ["scaffold_home_tabbed", "com.twitter.android:id/timeline_container"];
/** X's full-screen video viewer (Compose test tag). */
const X_VIDEO_VIEWER_ID = "VideoTab";
const X_POST_ROW_IDS = [
  "timeline_post",
  "com.twitter.android:id/outer_layout_row_view_tweet",
  "com.twitter.android:id/tweet_inline_actions",
];

// The comments sheet title carries the count before the word ("24 comments",
// 45.0.3 EN) or after it ("Comentarios 9", 44.9.3 ES); sometimes bare.
const COUNT_PART = "(?:[\\d.,\\s]*(?:mil|[km])?)?";
const COMMENTS_TITLE_RE = new RegExp(
  `^\\s*${COUNT_PART}\\s*(comments?|comentarios?|commentaires?|kommentare?)\\s*${COUNT_PART}\\s*$`,
  "i",
);
// The composer hint, the other proof that the sheet is up.
const COMMENT_FIELD_HINTS = ["add comment", "añadir comentario", "ajouter un commentaire", "kommentar hinzufügen"];

/** The comments sheet title node, when the sheet is open. */
export function commentsTitleNode(nodes: readonly TreeNode[]): TreeNode | null {
  return nodes.find((n) => COMMENTS_TITLE_RE.test(n.text)) ?? null;
}

function hasCommentComposer(nodes: readonly TreeNode[]): boolean {
  return editTexts(nodes).some((n) => {
    const hint = n.text.trim().toLowerCase();
    return COMMENT_FIELD_HINTS.some((h) => hint.startsWith(h));
  });
}

function has(hay: string, markers: readonly string[]): string | null {
  for (const m of markers) if (hay.includes(m)) return m;
  return null;
}

function decided(state: ScreenState, evidence: string, topPackage: string | null): Classification {
  return { state, evidence, topPackage };
}

/** The tree minus System UI windows — unless System UI is all there is. */
function withoutTransientOverlays(nodes: readonly TreeNode[]): readonly TreeNode[] {
  const kept = nodes.filter((n) => !TRANSIENT_OVERLAY_PACKAGES.includes(n.packageName));
  return kept.length > 0 ? kept : nodes;
}

/**
 * Classify the top window. Order matters: system windows and security states
 * are decided before any content marker, because a dialog hides the feed
 * underneath it (the tree then contains only the dialog).
 */
export function classifyScreen(tree: CompactTree, app: SocialApp): Classification {
  const nodes = withoutTransientOverlays(tree.nodes);
  const packages = packagesOf(nodes);
  const top = packages[0] ?? null;
  if (nodes.length === 0) return decided("empty_tree", "no nodes", top);

  const hay = visibleText(nodes);

  if (packages.some((p) => SYSTEM_PERMISSION_PACKAGES.includes(p))) {
    return decided("system_permission", "permissioncontroller window", top);
  }
  // Any Play Store window over the app is a detour BACK returns from — the
  // update sheet as much as the data-safety sheet an ad's "Install" opens
  // (US47, 11/09/2026).
  if (packages.includes(PLAY_STORE_PACKAGE)) {
    return decided("playstore_sheet", "com.android.vending window", top);
  }

  const security = classifySecurity(hay, app);
  if (security) return decided(security.state, security.evidence, top);

  const dialog = classifyDialog(hay, nodes);
  if (dialog) return decided(dialog.state, dialog.evidence, top);

  const content = app === "tiktok" ? classifyTikTok(hay, nodes) : classifyTwitter(hay, nodes);
  if (content) return decided(content.state, content.evidence, top);

  if (isOpaqueOverlay(tree)) return decided("opaque_overlay", "collapsed tree with unresolved resource strings", top);
  if (nodes.length <= LOADING_MAX_NODES) return decided("loading", `${nodes.length} nodes, no markers`, top);
  return decided("unknown", unknownEvidence(nodes), top);
}

const UNKNOWN_EVIDENCE_MAX = 240;

/**
 * What an unrecognised tree looked like — its ids and first strings — so the
 * step journal and the attention item explain themselves without a replay
 * (11/09/2026: two "no marker matched" stops needed a device to diagnose).
 */
function unknownEvidence(nodes: readonly TreeNode[]): string {
  const ids = [...new Set(nodes.map((n) => n.resourceId).filter(Boolean))].map((id) => id.replace(/^.*:id\//, "")).slice(0, 8);
  const strings = nodes.map((n) => n.text || n.contentDesc).filter(Boolean).slice(0, 6).map((s) => `"${s.slice(0, 24)}"`);
  return `no marker matched — ${nodes.length} nodes; ids ${ids.join(",") || "none"}; text ${strings.join(" ") || "none"}`.slice(0, UNKNOWN_EVIDENCE_MAX);
}

type Partial = { state: ScreenState; evidence: string } | null;

function classifySecurity(hay: string, app: SocialApp): Partial {
  const wall = has(hay, M.versionWall);
  if (wall) return { state: "version_wall", evidence: wall };
  const bouncer = has(hay, M.bouncer);
  if (bouncer) return { state: "bouncer", evidence: bouncer };
  const unavailable = has(hay, M.contentUnavailable);
  if (unavailable) return { state: "content_unavailable", evidence: unavailable };
  const phrase = has(hay, M.networkPhrase);
  const retry = has(hay, M.networkRetry);
  if (phrase && retry) return { state: "network_error", evidence: `${phrase} + ${retry}` };
  const payment = has(hay, M.paymentError);
  if (payment) return { state: "payment_error", evidence: payment };

  if (app === "twitter") {
    const out = has(hay, M.xLoggedOut);
    if (out) return { state: "logged_out", evidence: out };
  } else {
    const primary = has(hay, M.ttLoggedOut);
    if (primary && has(hay, M.ttLoggedOutSecondary)) return { state: "logged_out", evidence: primary };
  }
  return null;
}

function classifyDialog(hay: string, nodes: readonly TreeNode[]): Partial {
  const plan = has(hay, M.planConsent);
  if (plan) return { state: "plan_consent", evidence: plan };
  const consent = has(hay, M.consent);
  if (consent) return { state: "consent_dialog", evidence: consent };
  const link = has(hay, M.linkEmail);
  if (link) return { state: "link_email_dialog", evidence: link };
  const perm = has(hay, M.inAppPermission);
  if (perm) return { state: "permission_dialog", evidence: perm };
  const hasSwitch = nodes.some((n) => n.className.endsWith(".Switch") || n.className.endsWith("SwitchCompat"));
  const sheet = has(hay, M.settingsSheet);
  if (hasSwitch && sheet) return { state: "settings_sheet", evidence: sheet };
  // Off the main path, one BACK away: X's immersive video viewer (a press
  // that landed on a video — FR19, ES2, GB4, 11/09/2026) or its photo sheet.
  if (nodes.some((n) => n.resourceId === X_VIDEO_VIEWER_ID)) return { state: "off_path", evidence: X_VIDEO_VIEWER_ID };
  const photo = has(hay, M.photoSheet);
  if (photo) return { state: "off_path", evidence: photo };
  return null;
}

function classifyTikTok(hay: string, nodes: readonly TreeNode[]): Partial {
  const title = commentsTitleNode(nodes);
  if (title) return { state: "comments_panel", evidence: title.text };
  if (hasCommentComposer(nodes)) return { state: "comments_panel", evidence: "comment composer hint" };
  const feed = has(hay, M.ttFeedDesc);
  if (feed) return { state: "feed_ok", evidence: feed };
  const followers = has(hay, M.profile);
  if (followers && has(hay, M.profileSecondary) && (findByTextContains(nodes, "follow").length > 0 || findByTextContains(nodes, "message").length > 0)) {
    return { state: "profile", evidence: followers };
  }
  if (editTexts(nodes).length > 0 && has(hay, M.search) && findByDescContains(nodes, "search").length > 0) {
    return { state: "search", evidence: "search field" };
  }
  const tab = has(hay, M.ttFeedTabs);
  if (tab && has(hay, M.ttLoggedOutSecondary) === null) return { state: "feed_ok", evidence: tab };
  return null;
}

function classifyTwitter(hay: string, nodes: readonly TreeNode[]): Partial {
  const reply = has(hay, M.xPostDetail);
  if (reply || nodes.some((n) => n.resourceId === "post-detail-reply-text-field")) {
    return { state: "post_detail", evidence: reply ?? "post-detail-reply-text-field" };
  }
  const tab = has(hay, M.xFeed);
  if (tab && has(hay, M.xFeedSecondary)) return { state: "feed_ok", evidence: tab };
  if (editTexts(nodes).length > 0 && has(hay, M.search)) return { state: "search", evidence: "search field" };
  if (hasResourceId(nodes, X_HOME_IDS)) {
    if (hasResourceId(nodes, X_POST_ROW_IDS) || has(hay, M.xPostActions)) return { state: "feed_ok", evidence: "timeline posts" };
    // A video card filling the viewport leaves the home scaffold and a handful
    // of nodes (FR8 scroll 24/25; US43 and US44 sessions, 11/09/2026): still
    // the feed, the next scroll shows the next post. More nodes than that with
    // no marker is something over the feed, left to the settle.
    if (nodes.length <= LOADING_MAX_NODES) return { state: "feed_ok", evidence: "home scaffold, media card" };
  }
  return null;
}

function hasResourceId(nodes: readonly TreeNode[], ids: readonly string[]): boolean {
  return nodes.some((n) => ids.includes(n.resourceId));
}

/**
 * A rendered sheet with no accessibility text: a handful of nodes, no content
 * markers, and content descriptions that are unresolved resource references
 * (`@2131893880`). Measured on TikTok's Family Pairing promo (WebView).
 */
function isOpaqueOverlay(tree: CompactTree): boolean {
  if (tree.byteLength > OPAQUE_MAX_BYTES) return false;
  return tree.nodes.some((n) => OPAQUE_UNRESOLVED_DESC.test(n.contentDesc.trim()));
}

// ---------------------------------------------------------------------------
// Safe affordances — the node a recipe may click for a dismissable state
// ---------------------------------------------------------------------------

const NOT_NOW = ["not now", "plus tard", "ahora no", "später", "not interested", "maybe later", "skip", "passer", "ignorer"];
const DENY = ["don't allow", "don’t allow", "deny", "refuser", "no permitir", "nicht erlauben", "no thanks"];
const FREE_OPTION = ["standard (with ads)", "pubs génériques", "generic ads", "less personalised", "less personalized", "anuncios genéricos"];

function firstLabelled(nodes: readonly TreeNode[], labels: readonly string[]): TreeNode | null {
  for (const n of nodes) {
    const label = `${n.text} ${n.contentDesc}`.toLowerCase();
    if (labels.some((l) => label.includes(l))) return n;
  }
  return null;
}

/**
 * The node to click for a dismissable state, or null when the state has no
 * safe click (BACK is then the only move). Never returns OK / Allow / Link /
 * Log in / Update — those labels are not in any list here by design.
 */
export function findSafeAffordance(state: ScreenState, nodes: readonly TreeNode[]): TreeNode | null {
  switch (SAFE_REACTION[state]) {
    case "dismiss_not_now":
      return firstLabelled(nodes, NOT_NOW);
    case "deny_permission":
      return firstLabelled(nodes, DENY);
    case "choose_free_option":
      return firstLabelled(nodes, FREE_OPTION);
    default:
      return null;
  }
}
