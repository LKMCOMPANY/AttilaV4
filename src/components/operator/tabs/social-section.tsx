"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Copy, Check, Pencil, X as XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { PLATFORM_LIST } from "@/lib/constants/avatar";
import { SocialIcon } from "@/components/icons/social-icons";
import {
  setAvatarPlatformEnabled,
  setAvatarPlatformCredential,
  CREDENTIAL_FIELDS,
  type CredentialField,
} from "@/app/actions/avatar-social";
import type {
  AvatarWithRelations,
  SocialCredentials,
  SocialPlatform,
} from "@/types";

const FIELD_LABELS: Record<CredentialField, { label: string; masked?: boolean }> = {
  handle: { label: "Handle" },
  email: { label: "Email" },
  password: { label: "Password", masked: true },
  phone: { label: "Phone" },
  user_id: { label: "User ID" },
};

interface SocialSectionProps {
  avatar: AvatarWithRelations;
  onUpdated: (avatar: AvatarWithRelations) => void;
}

export function SocialSection({ avatar, onUpdated }: SocialSectionProps) {
  const handleToggle = async (
    platform: SocialPlatform,
    enabledKey: `${SocialPlatform}_enabled`,
    value: boolean,
  ) => {
    const prev = avatar[enabledKey] as boolean;
    onUpdated({ ...avatar, [enabledKey]: value } as AvatarWithRelations);

    const { error } = await setAvatarPlatformEnabled(avatar.id, platform, value);
    if (error) {
      toast.error(error);
      onUpdated({ ...avatar, [enabledKey]: prev } as AvatarWithRelations);
    }
  };

  const handleCredentialSave = async (
    platform: SocialPlatform,
    credKey: `${SocialPlatform}_credentials`,
    field: CredentialField,
    value: string,
  ) => {
    const current = (avatar[credKey] ?? {}) as SocialCredentials;
    const trimmed = value.trim();
    if ((current[field] ?? "") === trimmed) return;

    const updated: SocialCredentials = { ...current };
    if (trimmed.length === 0) delete updated[field];
    else updated[field] = trimmed;

    onUpdated({ ...avatar, [credKey]: updated } as AvatarWithRelations);

    const { error } = await setAvatarPlatformCredential(
      avatar.id,
      platform,
      field,
      trimmed.length === 0 ? null : trimmed,
    );

    if (error) {
      toast.error(error);
      onUpdated({ ...avatar, [credKey]: current } as AvatarWithRelations);
    } else {
      toast.success("Credential updated");
    }
  };

  return (
    <Accordion>
      {PLATFORM_LIST.map((platform) => {
        const enabled = avatar[platform.enabledKey] as boolean;
        const creds = (avatar[platform.credKey] ?? {}) as SocialCredentials;

        return (
          <AccordionItem key={platform.id} value={platform.id}>
            <div className="flex items-center justify-between py-2">
              <AccordionTrigger className="flex-1 py-0 hover:no-underline">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold",
                      platform.bgColor,
                      platform.color,
                    )}
                  >
                    <SocialIcon platform={platform.id} className="h-3 w-3" />
                    {platform.label}
                  </span>
                </div>
              </AccordionTrigger>
              <Switch
                checked={enabled}
                onCheckedChange={(v) =>
                  handleToggle(platform.id, platform.enabledKey, v)
                }
                size="sm"
              />
            </div>
            <AccordionContent>
              <div className="space-y-1 pb-2">
                {CREDENTIAL_FIELDS.map((field) => (
                  <CredentialRow
                    key={field}
                    label={FIELD_LABELS[field].label}
                    value={creds[field]}
                    masked={FIELD_LABELS[field].masked}
                    onSave={(v) =>
                      handleCredentialSave(
                        platform.id,
                        platform.credKey,
                        field,
                        v,
                      )
                    }
                  />
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

// ---------------------------------------------------------------------------
// Single credential row — inline edit / copy
// ---------------------------------------------------------------------------

function CredentialRow({
  label,
  value,
  masked,
  onSave,
}: {
  label: string;
  value?: string;
  masked?: boolean;
  onSave: (value: string) => void;
}) {
  // `draft` is only allocated while editing — when not editing, the displayed
  // value comes straight from props, so external updates are reflected
  // immediately without any mirror-state effect.
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const editing = draft !== null;

  const handleSave = () => {
    if (draft !== null && draft !== (value ?? "")) {
      onSave(draft);
    }
    setDraft(null);
  };

  const handleCancel = () => setDraft(null);

  const handleCopy = async () => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 rounded-md bg-muted/30 px-2.5 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            {label}
          </p>
          <Input
            value={draft ?? ""}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") handleCancel();
            }}
            onBlur={handleSave}
            className="mt-0.5 h-6 border-0 bg-transparent px-0 text-[12px] shadow-none focus-visible:ring-0"
            autoFocus
            autoComplete="off"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={handleCancel} className="h-5 w-5 shrink-0 p-0">
          <XIcon className="h-3 w-3 text-muted-foreground" />
        </Button>
      </div>
    );
  }

  return (
    <div className="group/cred flex items-center justify-between gap-2 rounded-md bg-muted/30 px-2.5 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          {label}
        </p>
        <p className="mt-0.5 truncate font-mono text-[12px]">
          {value ? (masked ? "••••••••" : value) : "—"}
        </p>
      </div>
      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover/cred:opacity-100">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDraft(value ?? "")}
          className="h-5 w-5 p-0"
        >
          <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
        </Button>
        {value && (
          <Button variant="ghost" size="sm" onClick={handleCopy} className="h-5 w-5 p-0">
            {copied ? (
              <Check className="h-2.5 w-2.5 text-success" />
            ) : (
              <Copy className="h-2.5 w-2.5 text-muted-foreground" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
