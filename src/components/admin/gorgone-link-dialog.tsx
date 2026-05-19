"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Plus, Loader2 } from "lucide-react";
import {
  getGorgoneAccountsAction,
  linkGorgoneAccount,
} from "@/app/actions/gorgone";
import { toast } from "sonner";
import type { GorgoneAccount } from "@/lib/gorgone";

interface GorgoneLinkDialogProps {
  accountId: string;
  existingAccountIds: string[];
  onLinked: () => void;
}

export function GorgoneLinkDialog({
  accountId,
  existingAccountIds,
  onLinked,
}: GorgoneLinkDialogProps) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<GorgoneAccount[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  const loadAccounts = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getGorgoneAccountsAction();
      setAccounts(data.filter((a) => !existingAccountIds.includes(a.id)));
    } catch {
      toast.error("Failed to load Gorgone accounts");
    } finally {
      setIsLoading(false);
    }
  }, [existingAccountIds]);

  useEffect(() => {
    if (open) {
      setSelectedId("");
      loadAccounts();
    }
  }, [open, loadAccounts]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;

    const account = accounts.find((a) => a.id === selectedId);
    if (!account) return;

    startTransition(async () => {
      const result = await linkGorgoneAccount({
        accountId,
        gorgoneAccountId: account.id,
        gorgoneAccountName: account.name,
      });

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(`Linked to ${account.name}`);
      setOpen(false);
      onLinked();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Plus data-icon="inline-start" className="h-3.5 w-3.5" />
            Link Gorgone Account
          </Button>
        }
      />
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Link Gorgone Account</DialogTitle>
            <DialogDescription>
              Select a Gorgone V4 account to sync monitoring data from its zones.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label>Gorgone Account</Label>
              {isLoading ? (
                <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading accounts...
                </div>
              ) : accounts.length === 0 ? (
                <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                  No available accounts to link.
                </div>
              ) : (
                <Select value={selectedId} onValueChange={(v) => { if (v) setSelectedId(v); }}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select an account..." />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button
              type="submit"
              disabled={isPending || !selectedId || isLoading}
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Link Account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
