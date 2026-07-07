"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Shield,
  Globe,
  Lock,
  User,
  Hash,
  RefreshCw,
  Pencil,
  Check,
  X,
  Loader2,
  Trash2,
  ClipboardPaste,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";
import { Section, InfoRow } from "./device-info";
import {
  verifyDeviceProxy,
  updateDeviceProxy,
  clearDeviceProxy,
  type DeviceProxyFields,
  type AppliedProxy,
  type ProxyReachability,
} from "@/app/actions/device-proxy";
import { parseProxyString } from "@/lib/proxy/parse-proxy";
import type { Device } from "@/types";

interface ProxySectionProps {
  device: Device;
  onProxyUpdated: (proxy: DeviceProxyFields) => void;
}

interface Draft {
  proxyType: "socks5" | "http";
  host: string;
  port: string;
  account: string;
  password: string;
}

function draftFromDevice(device: Device): Draft {
  return {
    proxyType: device.proxy_type === "http" ? "http" : "socks5",
    host: device.proxy_host ?? "",
    port: device.proxy_port != null ? String(device.proxy_port) : "",
    account: device.proxy_account ?? "",
    // The real password is never sent to the client. Left blank on edit; the
    // server keeps the stored password when this is empty and the host/account
    // are unchanged, so editing another field never wipes auth.
    password: "",
  };
}

export function ProxySection({ device, onProxyUpdated }: ProxySectionProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFromDevice(device));
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [paste, setPaste] = useState("");
  const [applied, setApplied] = useState<AppliedProxy | null>(null);
  const [reachable, setReachable] = useState<ProxyReachability | null>(null);

  const hasProxy = device.proxy_enabled || !!device.proxy_host;

  // Parse a pasted proxy string (Oxylabs host:port:user:pass, socks5:// URL,
  // user:pass@host:port …) into the form fields so operators don't hand-split.
  const applyPaste = (value: string) => {
    setPaste(value);
    const parsed = parseProxyString(value);
    if (parsed) {
      setDraft({
        proxyType: parsed.proxyType,
        host: parsed.host,
        port: String(parsed.port),
        account: parsed.account,
        password: parsed.password,
      });
    }
  };

  const runVerify = async () => {
    setVerifying(true);
    setApplied(null);
    setReachable(null);
    try {
      const result = await verifyDeviceProxy(device.id);
      if (result.error || !result.applied) {
        toast.error(result.error ?? "Could not read proxy");
        return;
      }
      setApplied(result.applied);
      setReachable(result.reachable);
      onProxyUpdated({
        proxy_enabled: result.applied.enabled,
        proxy_type: result.applied.type,
        proxy_host: result.applied.host,
        proxy_port: result.applied.port,
        proxy_account: result.applied.account,
        proxy_password: device.proxy_password,
      });
      if (result.reachable?.ok) {
        toast.success(`Proxy routes (${result.reachable.delayMs ?? "?"} ms)`);
      } else if (result.reachable) {
        toast.error(result.reachable.reason ?? "Proxy does not route");
      } else {
        toast.success("Proxy read from device");
      }
    } catch {
      toast.error("Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const startEdit = () => {
    setDraft(draftFromDevice(device));
    setPaste("");
    setEditing(true);
  };

  const clear = async () => {
    setClearing(true);
    try {
      const result = await clearDeviceProxy(device.id);
      if (result.error || !result.proxy) {
        toast.error(result.error ?? "Failed to clear proxy");
        return;
      }
      onProxyUpdated(result.proxy);
      setApplied(null);
      setReachable(null);
      toast.success("Proxy removed from the device");
    } catch {
      toast.error("Failed to clear proxy");
    } finally {
      setClearing(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await updateDeviceProxy({
        deviceId: device.id,
        proxyType: draft.proxyType,
        host: draft.host,
        port: draft.port,
        account: draft.account,
        password: draft.password,
      });
      if (result.error || !result.proxy) {
        toast.error(result.error ?? "Failed to update proxy");
        return;
      }
      onProxyUpdated(result.proxy);
      setEditing(false);
      setApplied(null);
      setPaste("");
      toast.success("Proxy applied to the device");
    } catch {
      toast.error("Failed to update proxy");
    } finally {
      setSaving(false);
    }
  };

  // -------------------------------------------------------------------------
  // Edit form
  // -------------------------------------------------------------------------
  if (editing) {
    return (
      <Section
        title="Proxy"
        icon={Shield}
        action={
          <>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[10px]" onClick={() => setEditing(false)} disabled={saving}>
              <X className="h-3 w-3" /> Cancel
            </Button>
            <Button size="sm" className="h-7 gap-1 px-2 text-[10px]" onClick={save} disabled={saving || !draft.host.trim() || !draft.port.trim()}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
            </Button>
          </>
        }
      >
        <div className="space-y-2.5 pt-1">
          <Field htmlFor="proxy-paste" label="Paste">
            <div className="relative">
              <ClipboardPaste className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="proxy-paste"
                value={paste}
                onChange={(e) => applyPaste(e.target.value)}
                placeholder="host:port:user:pass"
                className="h-7 pl-7 text-[11px]"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </Field>
          <p className="-mt-1 text-[10px] leading-snug text-muted-foreground/70">
            Paste any format (Oxylabs <code>host:port:user:pass</code>, <code>socks5://user:pass@host:port</code>) — the fields below auto-fill.
          </p>
          <Field htmlFor="proxy-type" label="Type">
            <NativeSelect
              id="proxy-type"
              size="sm"
              className="w-full"
              value={draft.proxyType}
              onChange={(e) => setDraft((d) => ({ ...d, proxyType: e.target.value as Draft["proxyType"] }))}
            >
              <NativeSelectOption value="socks5">SOCKS5</NativeSelectOption>
              <NativeSelectOption value="http">HTTP</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field htmlFor="proxy-host" label="Host">
            <Input id="proxy-host" value={draft.host} onChange={(e) => setDraft((d) => ({ ...d, host: e.target.value }))} placeholder="gate.example.com" className="h-7 text-[11px]" autoComplete="off" spellCheck={false} />
          </Field>
          <Field htmlFor="proxy-port" label="Port">
            <Input id="proxy-port" value={draft.port} onChange={(e) => setDraft((d) => ({ ...d, port: e.target.value.replace(/[^0-9]/g, "") }))} placeholder="1080" inputMode="numeric" className="h-7 text-[11px]" autoComplete="off" />
          </Field>
          <Field htmlFor="proxy-account" label="Account">
            <Input id="proxy-account" value={draft.account} onChange={(e) => setDraft((d) => ({ ...d, account: e.target.value }))} placeholder="username" className="h-7 text-[11px]" autoComplete="off" spellCheck={false} />
          </Field>
          <Field htmlFor="proxy-password" label="Password">
            <Input id="proxy-password" type="password" value={draft.password} onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))} placeholder={hasProxy ? "leave blank to keep current" : "password"} className="h-7 text-[11px]" autoComplete="off" />
          </Field>
          <p className="text-[10px] leading-snug text-muted-foreground/70">
            Applied to the device immediately. The device must be running.
          </p>
        </div>
      </Section>
    );
  }

  // -------------------------------------------------------------------------
  // Read-only view + verify
  // -------------------------------------------------------------------------
  return (
    <Section
      title="Proxy"
      icon={Shield}
      action={
        <>
          <ProxyHelpTooltip />
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[10px]" onClick={runVerify} disabled={verifying || clearing}>
            {verifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Verify
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[10px]" onClick={startEdit} disabled={clearing}>
            <Pencil className="h-3 w-3" /> Edit
          </Button>
          {hasProxy && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[10px] text-destructive hover:text-destructive"
              onClick={clear}
              disabled={clearing || verifying}
            >
              {clearing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Disable
            </Button>
          )}
        </>
      }
    >
      {hasProxy ? (
        <>
          <InfoRow icon={Shield} label="Type" value={device.proxy_type} />
          <InfoRow icon={Globe} label="Host" value={device.proxy_host} />
          <InfoRow icon={Hash} label="Port" value={device.proxy_port} />
          <InfoRow icon={User} label="Account" value={device.proxy_account} />
          {/* The real password is never sent to the browser; show a masked
              marker when the proxy has an account (auth proxy). */}
          <InfoRow icon={Lock} label="Password" value={device.proxy_account ? "••••••••" : null} />
        </>
      ) : (
        <p className="py-1.5 text-[11px] text-muted-foreground/70">No proxy configured</p>
      )}

      {applied && <AppliedResult applied={applied} reachable={reachable} />}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Explains when a proxy change works, and what Verify / Disable do. */
function ProxyHelpTooltip() {
  return (
    <InfoTip side="bottom">
      <span className="font-medium">Editing the proxy requires the device to be running.</span>
      <br />
      Save applies it live (no restart). Verify runs a real connectivity test through the proxy.
      Disable removes it (direct connection).
    </InfoTip>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={htmlFor} className="w-16 shrink-0 text-[10px] text-muted-foreground">
        {label}
      </Label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function AppliedResult({
  applied,
  reachable,
}: {
  applied: AppliedProxy;
  reachable: ProxyReachability | null;
}) {
  const label = applied.host
    ? `${applied.type ?? "proxy"} · ${applied.host}:${applied.port ?? "?"}`
    : "No proxy applied";
  // Reachability is the REAL routing verdict (mihomo delay), distinct from
  // whether a proxy is merely configured/enabled.
  const routes = reachable?.ok === true;
  const reachLabel = reachable
    ? routes
      ? `Routes · ${reachable.delayMs ?? "?"} ms`
      : reachable.reason ?? "Does not route"
    : "Reachability not tested";
  return (
    <div className="mt-2 rounded-md border bg-background/60 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className={cn("h-1.5 w-1.5 rounded-full", applied.enabled ? "bg-success" : "bg-muted-foreground")} />
        <span className="text-[11px] font-medium">Applied on device</span>
      </div>
      <p className="mt-1 truncate text-[10px] text-muted-foreground">{label}</p>
      <div className="mt-1.5 flex items-center gap-2 border-t pt-1.5">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            reachable ? (routes ? "bg-success" : "bg-destructive") : "bg-muted-foreground",
          )}
        />
        <span className="truncate text-[10px] text-muted-foreground">{reachLabel}</span>
      </div>
    </div>
  );
}
