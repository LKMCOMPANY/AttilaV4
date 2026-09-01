/**
 * The on-device screen-projection service (scrcpy 3.3.3), and how we tune it.
 *
 * `/var/lib/scd/scd.sh` on the box starts scrcpy with a fixed set of defaults
 * and then appends whatever is in the guest's `/data/local/scd.conf`:
 *
 *   ARGS="$DEFAULT_ARGS $(cat "$CONF_FILE")"
 *
 * Last value wins, so the conf can override a default rather than only add to
 * it — verified on box-5, where `log_level=info` in the conf beat the
 * `log_level=verbose` in the defaults.
 *
 * Two scripts deliver this file, and they must never disagree about what it
 * says, which is why it lives here:
 *   - `tune-scrcpy.mjs` writes it from inside a RUNNING container;
 *   - `tune-scrcpy-offline.mjs` writes it into a STOPPED container's data.img.
 */

/** Where the conf lives, as Android sees it. */
export const CONF_PATH = "/data/local/scd.conf";

/**
 * The same path relative to `data.img`, which IS the guest's `/data`, for the
 * offline writer working on the image with `debugfs`.
 */
export const CONF_IN_IMAGE = "local/scd.conf";

/** scd.sh runs scrcpy via `app_process`, so match on the class, not a binary. */
export const SCRCPY_MAIN_CLASS = "com.genymobile.scrcpy.Server";

/**
 * What the stock defaults leave on the table:
 *   - no `video_bit_rate` → the encoder picks its own, with no ceiling on a
 *     link that crosses a Cloudflare tunnel;
 *   - no `max_fps` → the encoder is free to exceed the panel's 30 Hz;
 *   - no key-frame interval → a long GOP, so a reconnect shows nothing until
 *     the next IDR. This is the one that hurts: the operator stares at a frozen
 *     last frame for seconds after every drop;
 *   - `log_level=verbose` → `/data/local/tmp/scd.log` grows without bound. On
 *     box-1 that log was part of what filled a 469 GB disk to 98%.
 *
 * `i-frame-interval=1` is the point of the exercise: one key frame per second
 * means a reconnect paints within a second. `video_bit_rate` caps what that
 * costs. `max_fps` matches the panel (1080x2340 @ 30) so the encoder never
 * spends bits on frames the device cannot produce.
 */
export const TUNED_ARGS = [
  "video_bit_rate=4000000",
  "max_fps=30",
  "video_codec_options=i-frame-interval=1",
  "log_level=info",
].join(" ");

/**
 * Restart the projection service the way Android restarts any of its own.
 *
 * `scd` is an init service — a oneshot that spawns the daemon — so `ctl.restart`
 * is the platform's own mechanism, not a workaround. Measured on box-5: a new
 * scrcpy process and a passing `/stream-ready` handshake two seconds later.
 *
 * Note this is NOT the Container API's `refreshScreenService`, which uploads a
 * replacement scd binary.
 */
export const RESTART_PROJECTION_CMD = "setprop ctl.restart scd";
