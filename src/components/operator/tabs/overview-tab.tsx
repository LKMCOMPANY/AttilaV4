"use client";

import { Shield, CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STATUS_CONFIG } from "@/lib/constants/avatar";
import { AVATAR_STATUSES, type AvatarWithRelations, type AvatarStatus } from "@/types";
import { updateAvatar } from "@/app/actions/avatars";
import { SocialSection } from "./social-section";
import { AssignmentSection } from "./assignment-section";
import type { EditableTabProps } from "../avatar-detail-panel";

export function OverviewTab({ avatar, accountId, onUpdated }: EditableTabProps) {
  const handleStatusChange = async (value: string | null) => {
    if (!value) return;
    const prev = avatar.status;
    onUpdated({ ...avatar, status: value as AvatarStatus });

    const { error } = await updateAvatar(avatar.id, { status: value });
    if (error) {
      toast.error(error);
      onUpdated({ ...avatar, status: prev });
    }
  };

  return (
    <div className="space-y-5">
      <Section title="Accounts & Credentials" icon={Shield}>
        <SocialSection avatar={avatar} onUpdated={onUpdated} />
      </Section>

      <AssignmentSection
        avatar={avatar}
        accountId={accountId}
        onUpdated={onUpdated}
      />

      <Section title="Status" icon={CircleDot}>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              STATUS_CONFIG[avatar.status].dot
            )}
          />
          <Select value={avatar.status} onValueChange={handleStatusChange}>
            <SelectTrigger className="h-7 w-auto gap-1.5 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AVATAR_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  <span className="capitalize">{STATUS_CONFIG[s].label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2.5 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
        <h3 className="text-[13px] font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}
