"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import type { SocialCredentials, SocialPlatform } from "@/types";
import type { StepProps } from "../types";

type EnabledKey = "twitter_enabled" | "tiktok_enabled" | "reddit_enabled" | "instagram_enabled";
type CredKey = "twitter_credentials" | "tiktok_credentials" | "reddit_credentials" | "instagram_credentials";

interface PlatformDef {
  id: SocialPlatform;
  label: string;
  enabledKey: EnabledKey;
  credKey: CredKey;
  color: string;
  abbr: string;
}

const PLATFORMS: PlatformDef[] = [
  { id: "twitter", label: "Twitter / X", enabledKey: "twitter_enabled", credKey: "twitter_credentials", color: "bg-sky-500/10 text-sky-600 dark:text-sky-400", abbr: "X" },
  { id: "tiktok", label: "TikTok", enabledKey: "tiktok_enabled", credKey: "tiktok_credentials", color: "bg-pink-500/10 text-pink-600 dark:text-pink-400", abbr: "Tk" },
  { id: "reddit", label: "Reddit", enabledKey: "reddit_enabled", credKey: "reddit_credentials", color: "bg-orange-500/10 text-orange-600 dark:text-orange-400", abbr: "Re" },
  { id: "instagram", label: "Instagram", enabledKey: "instagram_enabled", credKey: "instagram_credentials", color: "bg-purple-500/10 text-purple-600 dark:text-purple-400", abbr: "Ig" },
];

export function StepSocial({ data, onChange }: StepProps) {
  const togglePlatform = (key: EnabledKey, value: boolean) => {
    onChange({ [key]: value });
  };

  const updateCredentials = (
    key: CredKey,
    field: keyof SocialCredentials,
    value: string
  ) => {
    const current = data[key] ?? {};
    onChange({ [key]: { ...current, [field]: value || undefined } });
  };

  const enabledCount = PLATFORMS.filter((p) => data[p.enabledKey]).length;

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <h3 className="text-heading-3">Social Media</h3>
        <p className="text-body-sm text-muted-foreground">
          Select which platforms this avatar will be active on.
          {enabledCount > 0 && (
            <span className="ml-1 font-medium text-foreground">
              {enabledCount} selected
            </span>
          )}
        </p>
      </div>

      <div className="space-y-2.5">
        {PLATFORMS.map((platform) => {
          const enabled = data[platform.enabledKey];
          const creds = data[platform.credKey] ?? {};

          return (
            <Collapsible key={platform.id}>
              <div
                className={`rounded-lg border transition-all ${
                  enabled ? "border-primary/20 bg-primary/[0.03]" : ""
                }`}
              >
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-md text-xs font-bold ${platform.color}`}>
                      {platform.abbr}
                    </div>
                    <span className="text-sm font-medium">{platform.label}</span>
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(v) => togglePlatform(platform.enabledKey, v)}
                    aria-label={`Enable ${platform.label}`}
                  />
                </div>

                {enabled && (
                  <>
                    <CollapsibleTrigger className="flex w-full items-center gap-2 border-t px-4 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground">
                      <ChevronDown className="h-3 w-3 transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                      Credentials
                      <span className="text-muted-foreground/60">(optional)</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
                        <CredField
                          id={`${platform.id}-handle`}
                          label="Handle / Username"
                          value={creds.handle}
                          onChange={(v) => updateCredentials(platform.credKey, "handle", v)}
                        />
                        <CredField
                          id={`${platform.id}-email`}
                          label="Email"
                          type="email"
                          value={creds.email}
                          onChange={(v) => updateCredentials(platform.credKey, "email", v)}
                        />
                        <CredField
                          id={`${platform.id}-password`}
                          label="Password"
                          type="password"
                          value={creds.password}
                          onChange={(v) => updateCredentials(platform.credKey, "password", v)}
                        />
                        <CredField
                          id={`${platform.id}-phone`}
                          label="Phone"
                          type="tel"
                          value={creds.phone}
                          onChange={(v) => updateCredentials(platform.credKey, "phone", v)}
                        />
                      </div>
                    </CollapsibleContent>
                  </>
                )}
              </div>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}

function CredField({
  id,
  label,
  value,
  type = "text",
  onChange,
}: {
  id: string;
  label: string;
  value?: string;
  type?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-sm"
        autoComplete="off"
      />
    </div>
  );
}
