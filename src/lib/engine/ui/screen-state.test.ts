import { describe, expect, it } from "vitest";

import { parseCompactTree } from "./compact-tree";
import { classifyScreen, findSafeAffordance, SAFE_REACTION } from "./screen-state";

/** Build a compact dump from `[class, attrs]` pairs; every node sits at depth 1. */
function tree(pkg: string, lines: string[], header = "Screen 1080x2340 rotation=0") {
  const body = lines.map(
    (l, i) => `  [${i}] ${l} package="${pkg}" enabled=true bounds=[0,${i * 10}][100,${i * 10 + 9}]`,
  );
  return parseCompactTree(
    [header, `[0] android.widget.FrameLayout resource-id="android:id/content" package="${pkg}" enabled=true bounds=[0,0][1080,2340]`, ...body].join("\n"),
  );
}

const TT = "com.zhiliaoapp.musically";
const X = "com.twitter.android";

describe("classifyScreen — TikTok", () => {
  it("recognises a logged-in feed by the like/comments descriptions", () => {
    const t = tree(TT, [
      'android.widget.TextView text="For You"',
      'android.widget.Button content-desc="Like video. 941 likes" clickable=true',
      'android.widget.Button content-desc="Read or add comments. 24 comments" clickable=true',
    ]);
    expect(classifyScreen(t, "tiktok")).toMatchObject({ state: "feed_ok", topPackage: TT });
  });

  it("recognises the comments panel by its title", () => {
    const t = tree(TT, ['android.widget.TextView text="13,816 comments"', 'android.widget.EditText text="Add comment..."']);
    expect(classifyScreen(t, "tiktok").state).toBe("comments_panel");
  });

  it("recognises a profile", () => {
    const t = tree(TT, [
      'android.widget.TextView text="9.6M Followers"',
      'android.widget.TextView text="62 Following"',
      'android.widget.TextView text="Follow" clickable=true',
    ]);
    expect(classifyScreen(t, "tiktok").state).toBe("profile");
  });

  it("recognises the logged-out account picker", () => {
    const t = tree(TT, ['android.widget.TextView text="Welcome back"', 'android.widget.Button text="Log in"', 'android.widget.TextView text="Add another account"']);
    const c = classifyScreen(t, "tiktok");
    expect(c.state).toBe("logged_out");
    expect(SAFE_REACTION[c.state]).toBe("stop");
  });

  it("puts a system permission dialog before everything else", () => {
    const t = parseCompactTree(
      [
        "Screen 1080x2340 rotation=0",
        '[0] android.widget.FrameLayout package="com.android.permissioncontroller" enabled=true bounds=[27,740][1053,1672]',
        '  [0] android.widget.TextView text="Allow TikTok to access your contacts?" package="com.android.permissioncontroller" enabled=true bounds=[0,0][10,10]',
        '  [1] android.widget.Button text="DON’T ALLOW" package="com.android.permissioncontroller" clickable=true enabled=true bounds=[0,0][10,10]',
        '  [2] android.widget.Button text="ALLOW" package="com.android.permissioncontroller" clickable=true enabled=true bounds=[0,0][10,10]',
      ].join("\n"),
    );
    const c = classifyScreen(t, "tiktok");
    expect(c.state).toBe("system_permission");
    expect(findSafeAffordance(c.state, t.nodes)?.text).toBe("DON’T ALLOW");
  });

  it("recognises the UK plan sheet and points at the free option", () => {
    const t = tree(TT, ['android.widget.TextView text="Pick your plan"', 'android.widget.TextView text="Standard (with ads)"', 'android.widget.TextView text="TikTok Ad-Free"', 'android.widget.Button text="Continue"']);
    const c = classifyScreen(t, "tiktok");
    expect(c.state).toBe("plan_consent");
    expect(findSafeAffordance(c.state, t.nodes)?.text).toBe("Standard (with ads)");
  });

  it("recognises the link-email dialog and its Not now", () => {
    const t = tree(TT, ['android.widget.TextView text="Link email"', 'android.widget.Button text="OK"', 'android.widget.Button text="Not now"']);
    const c = classifyScreen(t, "tiktok");
    expect(c.state).toBe("link_email_dialog");
    expect(findSafeAffordance(c.state, t.nodes)?.text).toBe("Not now");
  });

  it("recognises the viewer-history settings sheet", () => {
    const t = tree(TT, ['android.widget.TextView text="Viewer history turned on"', 'android.widget.Switch checked=true', 'android.widget.Button text="Save"']);
    expect(classifyScreen(t, "tiktok").state).toBe("settings_sheet");
  });

  // Family Pairing promo: a WebView sheet with no text, only an unresolved resource string.
  it("flags a collapsed tree with unresolved resource strings as an opaque overlay", () => {
    const t = tree(TT, ['android.view.View content-desc="@2131893880" clickable=true', 'android.widget.Button content-desc=" Learn more" clickable=true']);
    const c = classifyScreen(t, "tiktok");
    expect(c.state).toBe("opaque_overlay");
    expect(SAFE_REACTION[c.state]).toBe("back");
  });

  it("calls a tiny tree without markers loading, an empty one empty", () => {
    expect(classifyScreen(tree(TT, ['android.widget.FrameLayout resource-id="x"']), "tiktok").state).toBe("loading");
    expect(classifyScreen(parseCompactTree(""), "tiktok").state).toBe("empty_tree");
  });
});

describe("classifyScreen — X", () => {
  it("recognises the version wall", () => {
    const t = tree(X, ['android.widget.TextView text="This app is out of date."', 'android.widget.Button text="Update now"']);
    const c = classifyScreen(t, "twitter");
    expect(c.state).toBe("version_wall");
    expect(SAFE_REACTION[c.state]).toBe("stop");
  });

  it("recognises the 12.21 logged-out landing", () => {
    const t = tree(X, ['android.widget.TextView text="See what\'s happening"', 'android.widget.Button text="Continue with Phone"', 'android.widget.TextView text="Login with username"']);
    expect(classifyScreen(t, "twitter").state).toBe("logged_out");
  });

  it("recognises the content error before the feed", () => {
    const t = tree(X, ['android.widget.TextView text="For you"', 'android.widget.TextView text="Following"', 'android.widget.TextView text="Cannot retrieve posts at this time."']);
    expect(classifyScreen(t, "twitter").state).toBe("content_unavailable");
  });

  it("recognises the bouncer", () => {
    const t = tree(X, ['android.widget.TextView text="Performing security verification"']);
    expect(classifyScreen(t, "twitter").state).toBe("bouncer");
  });

  it("recognises a post detail by the reply field", () => {
    const t = tree(X, ['android.widget.EditText text="Postez votre réponse" resource-id="post-detail-reply-text-field"']);
    expect(classifyScreen(t, "twitter").state).toBe("post_detail");
  });

  it("recognises the home feed", () => {
    const t = tree(X, ['android.widget.TextView text="For you"', 'android.widget.TextView text="Following"']);
    expect(classifyScreen(t, "twitter").state).toBe("feed_ok");
  });
});
