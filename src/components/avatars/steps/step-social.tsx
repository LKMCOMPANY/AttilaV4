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
import { PLATFORM_LIST } from "@/lib/constants/avatar";
import { SocialIcon } from "@/components/icons/social-icons";
import type { SocialCredentials } from "@/types";
import type { StepProps } from "../types";

export function StepSocial({ data, onChange }: StepProps) {
  const togglePlatform = (key: string, value: boolean) => {
    onChange({ [key]: value });
  };

  const updateCredentials = (
    key: string,
    field: keyof SocialCredentials,
    value: string
  ) => {
    const current = (data[key as keyof typeof data] ?? {}) as Record<string, unknown>;
    onChange({ [key]: { ...current, [field]: value || undefined } });
  };

  const enabledCount = PLATFORM_LIST.filter((p) => data[p.enabledKey]).length;

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
        {PLATFORM_LIST.map((platform) => {
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
                    <div className={`flex h-8 w-8 items-center justify-center rounded-md ${platform.bgColor} ${platform.color}`}>
                      <SocialIcon platform={platform.id} className="h-4 w-4" />
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
