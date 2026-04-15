"use client";

import { useCallback, useState, useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AutoSaveField } from "@/components/admin/auto-save-field";
import { UserRow } from "@/components/admin/user-row";
import { UserCreateDialog } from "@/components/admin/user-create-dialog";
import { GorgoneSection } from "@/components/admin/gorgone-section";
import Link from "next/link";
import { ExternalLink, Users } from "lucide-react";
import { updateAccount, updateAccountStatus } from "@/app/actions/accounts";
import { toast } from "sonner";
import type { AccountStatus, AccountWithUsers } from "@/types";

const STATUS_OPTIONS: { value: AccountStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "standby", label: "Standby" },
  { value: "archived", label: "Archived" },
];

interface AccountDetailProps {
  account: AccountWithUsers;
  onUpdated: () => void;
}

export function AccountDetail({ account, onUpdated }: AccountDetailProps) {
  const [currentStatus, setCurrentStatus] = useState(account.status);
  const [pendingStatus, setPendingStatus] = useState<AccountStatus | null>(null);
  const [, startTransition] = useTransition();

  const handleSaveName = useCallback(
    async (value: string) => {
      const result = await updateAccount({ id: account.id, name: value });
      if (!result.error) onUpdated();
      return result;
    },
    [account.id, onUpdated]
  );

  const handleSaveDescription = useCallback(
    async (value: string) => {
      const result = await updateAccount({
        id: account.id,
        description: value || null,
      });
      if (!result.error) onUpdated();
      return result;
    },
    [account.id, onUpdated]
  );

  function handleStatusIntent(newStatus: string | null) {
    if (!newStatus) return;
    const status = newStatus as AccountStatus;
    if (status === currentStatus) return;

    if (status === "archived" || status === "standby") {
      setPendingStatus(status);
    } else {
      applyStatus(status);
    }
  }

  function applyStatus(status: AccountStatus) {
    setCurrentStatus(status);
    setPendingStatus(null);

    startTransition(async () => {
      const result = await updateAccountStatus({ id: account.id, status });
      if (result.error) {
        toast.error(result.error);
        setCurrentStatus(account.status);
      } else {
        onUpdated();
      }
    });
  }

  const usersExcludingAdmin = account.profiles.filter(
    (p) => p.role !== "admin"
  );

  return (
    <div className="animate-in space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-3">
          <AutoSaveField
            value={account.name}
            onSave={handleSaveName}
            placeholder="Account name"
            className="text-heading-3"
          />
          <AutoSaveField
            value={account.description ?? ""}
            onSave={handleSaveDescription}
            placeholder="Add a description..."
            variant="textarea"
            className="text-sm text-muted-foreground"
            maxLength={500}
          />
        </div>
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Status
          </span>
          <Select value={currentStatus} onValueChange={handleStatusIntent}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto">
          <Link
            href={`/dashboard/operator?account=${account.id}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ExternalLink data-icon="inline-start" className="h-3.5 w-3.5" />
            View Dashboard
          </Link>
        </div>
      </div>

      {/* Meta info */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>
          Created{" "}
          {new Date(account.created_at).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </span>
        <span className="font-mono text-[10px] opacity-60">
          {account.id.slice(0, 8)}
        </span>
      </div>

      <Separator />

      {/* Users section */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Users</h3>
            <Badge variant="secondary" className="text-xs">
              {usersExcludingAdmin.length}
            </Badge>
          </div>
          <UserCreateDialog accountId={account.id} onCreated={onUpdated} />
        </div>

        {usersExcludingAdmin.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No users yet. Add a user to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {usersExcludingAdmin.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                onDeleted={onUpdated}
                onUpdated={onUpdated}
              />
            ))}
          </div>
        )}
      </div>

      <Separator />

      {/* Gorgone integration */}
      <GorgoneSection accountId={account.id} />

      {/* Status change confirmation */}
      <AlertDialog
        open={pendingStatus !== null}
        onOpenChange={(open) => {
          if (!open) setPendingStatus(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingStatus === "archived"
                ? "Archive Account"
                : "Standby Account"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingStatus === "archived"
                ? "Archiving will revoke access for all users in this account. The account data will be preserved but hidden from the list."
                : "Putting this account on standby will temporarily revoke access for all users. You can reactivate it at any time."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={
                pendingStatus === "archived" ? "destructive" : "default"
              }
              onClick={() => pendingStatus && applyStatus(pendingStatus)}
            >
              {pendingStatus === "archived" ? "Archive" : "Set Standby"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
