"use client";

import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AccountStatus, AccountWithUsers } from "@/types";

const STATUS_CONFIG: Record<
  AccountStatus,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  active: { label: "Active", variant: "default" },
  standby: { label: "Standby", variant: "outline" },
  archived: { label: "Archived", variant: "destructive" },
};

interface AccountListItemProps {
  account: AccountWithUsers;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

export function AccountListItem({
  account,
  isSelected,
  onSelect,
}: AccountListItemProps) {
  const status = STATUS_CONFIG[account.status];

  return (
    <button
      onClick={() => onSelect(account.id)}
      className={cn(
        "w-full rounded-lg border p-3 text-left transition-all focus-tactical",
        "hover:border-[var(--card-hover-border)]",
        isSelected
          ? "border-primary/30 bg-primary/5 shadow-sm"
          : "border-transparent bg-card"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{account.name}</p>
          {account.description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {account.description}
            </p>
          )}
        </div>
        <Badge variant={status.variant} className="shrink-0">
          {status.label}
        </Badge>
      </div>
      <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
        <Users className="h-3 w-3" />
        <span>
          {account.user_count} user{account.user_count !== 1 ? "s" : ""}
        </span>
      </div>
    </button>
  );
}
