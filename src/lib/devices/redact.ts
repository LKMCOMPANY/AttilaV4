import type { Device } from "@/types";

/**
 * Strip device secrets before a device row is sent to the browser.
 *
 * `proxy_password` is stored so the box can (re)apply the proxy, but it must
 * never reach the client — the operator UI only needs to know a password IS set
 * (shown masked). Editing a proxy is done by pasting the full credentials again,
 * so the real value never has to round-trip to the browser.
 */
export function redactDeviceSecrets<T extends Pick<Device, "proxy_password"> | null | undefined>(
  device: T,
): T {
  if (!device) return device;
  return { ...device, proxy_password: null };
}
