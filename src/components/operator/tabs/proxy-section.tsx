"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Shield,
  Globe,
  Lock,
  User,
  Hash,
  Plug,
  Pencil,
  Check,
  X,
  Loader2,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { Section, InfoRow } from "./device-info";
import {
  testDeviceProxy,
  updateDeviceProxy,
  type DeviceProxyFields,
  type TestProxyResult,
} from "@/app/actions/device-proxy";
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
    password: device.proxy_password ?? "",
  };
}

export function ProxySection({ device, onProxyUpdated }: ProxySectionProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFromDevice(device));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestProxyResult | null>(null);

  const hasProxy = device.proxy_enabled || !!device.proxy_host;

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      const result = await testDeviceProxy(device.id);
      setTest(result);
      if (result.error) toast.error(result.error);
      else if (result.egress?.reachable) toast.success("Proxy reachable");
    } catch {
      toast.error("Proxy test failed");
    } finally {
      setTesting(false);
    }
  };

  const startEdit = () => {
    setDraft(draftFromDevice(device));
    setEditing(true);
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
      setTest(null);
      toast.success("Proxy saved — applied on next device restart");
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
            <Input id="proxy-password" type="password" value={draft.password} onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))} placeholder="••••••••" className="h-7 text-[11px]" autoComplete="off" />
          </Field>
          <p className="text-[10px] leading-snug text-muted-foreground/70">
            Saved to the box immediately. The device picks up the new proxy on its next restart.
          </p>
        </div>
      </Section>
    );
  }

  // -------------------------------------------------------------------------
  // Read-only view + test
  // -------------------------------------------------------------------------
  return (
    <Section
      title="Proxy"
      icon={Shield}
      action={
        <>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[10px]" onClick={runTest} disabled={testing}>
            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />} Test
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[10px]" onClick={startEdit}>
            <Pencil className="h-3 w-3" /> Edit
          </Button>
        </>
      }
    >
      {hasProxy ? (
        <>
          <InfoRow icon={Shield} label="Type" value={device.proxy_type} />
          <InfoRow icon={Globe} label="Host" value={device.proxy_host} />
          <InfoRow icon={Hash} label="Port" value={device.proxy_port} />
          <InfoRow icon={User} label="Account" value={device.proxy_account} />
          <InfoRow icon={Lock} label="Password" value={device.proxy_password ? "••••••••" : null} />
        </>
      ) : (
        <p className="py-1.5 text-[11px] text-muted-foreground/70">No proxy configured</p>
      )}

      {test && <TestResult test={test} />}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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

function TestResult({ test }: { test: TestProxyResult }) {
  const ok = test.egress?.reachable === true;
  const e = test.egress;
  const message = test.error ?? e?.detail ?? "";
  const dot = ok ? "bg-success" : e && !e.engineRunning ? "bg-destructive" : "bg-warning";

  return (
    <div className="mt-2 rounded-md border bg-background/60 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
        <span className="text-[11px] font-medium">
          {ok ? "Reachable" : "Not reachable"}
        </span>
        {ok && e?.exitIp && (
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">{e.exitIp}</span>
        )}
      </div>
      {ok && e ? (
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <MapPin className="h-3 w-3 opacity-60" />
          <span>
            {[e.city, e.country].filter(Boolean).join(", ")}
            {e.isp ? ` · ${e.isp}` : ""}
          </span>
        </div>
      ) : (
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{message}</p>
      )}
    </div>
  );
}
