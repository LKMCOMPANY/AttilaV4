"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { DeviceItem } from "@/components/admin/device-item";
import {
  RefreshCw,
  Loader2,
  Search,
  Smartphone,
  Building2,
  X,
  Plus,
} from "lucide-react";
import {
  syncBox,
  assignBoxToAccount,
  unassignBoxFromAccount,
} from "@/app/actions/boxes";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Account, BoxWithRelations, Device, DeviceState } from "@/types";

type StateFilter = "all" | DeviceState;

const STATE_FILTERS: { value: StateFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "stopped", label: "Stopped" },
  { value: "removed", label: "Removed" },
];

interface BoxContentProps {
  box: BoxWithRelations;
  devices: Device[];
  allAccounts: Account[];
  onUpdated: () => void;
}

export function BoxContent({
  box,
  devices,
  allAccounts,
  onUpdated,
}: BoxContentProps) {
  const [isSyncing, startSyncTransition] = useTransition();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [addingAccount, setAddingAccount] = useState(false);

  const filteredDevices = useMemo(() => {
    let result = devices;
    if (stateFilter !== "all") {
      result = result.filter((d) => d.state === stateFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (d) =>
          d.user_name?.toLowerCase().includes(q) ||
          d.db_id.toLowerCase().includes(q) ||
          d.country?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [devices, search, stateFilter]);

  const activeAccounts = useMemo(
    () => allAccounts.filter((a) => a.status === "active"),
    [allAccounts]
  );

  const unassignedAccounts = useMemo(
    () =>
      allAccounts.filter(
        (a) =>
          a.status === "active" &&
          !box.accounts.some((ba) => ba.id === a.id)
      ),
    [allAccounts, box.accounts]
  );

  const handleSync = useCallback(() => {
    startSyncTransition(async () => {
      const result = await syncBox(box.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Box synced");
        onUpdated();
      }
    });
  }, [box.id, onUpdated]);

  const handleAddAccount = useCallback(
    (accountId: string | null) => {
      if (!accountId) return;
      setAddingAccount(false);
      startTransition(async () => {
        const result = await assignBoxToAccount({
          boxId: box.id,
          accountId,
        });
        if (result.error) {
          toast.error(result.error);
        } else {
          onUpdated();
        }
      });
    },
    [box.id, onUpdated, startTransition]
  );

  const handleRemoveAccount = useCallback(
    (accountId: string) => {
      startTransition(async () => {
        const result = await unassignBoxFromAccount({
          boxId: box.id,
          accountId,
        });
        if (result.error) {
          toast.error(result.error);
        } else {
          onUpdated();
        }
      });
    },
    [box.id, onUpdated, startTransition]
  );

  return (
    <div className="space-y-4 pt-2">
      {/* Sync + Meta row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          {box.lan_ip && <span>LAN {box.lan_ip}</span>}
          {box.last_heartbeat && (
            <span>
              Last sync{" "}
              {new Date(box.last_heartbeat).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
          <span className="font-mono text-[10px] opacity-60">
            {box.id.slice(0, 8)}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={isSyncing}
          className="shrink-0"
        >
          {isSyncing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {isSyncing ? "Syncing..." : "Sync"}
        </Button>
      </div>

      {/* Assigned Accounts */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Assigned Accounts
            </span>
            <Badge variant="secondary" className="text-xs">
              {box.accounts.length}
            </Badge>
          </div>
          {unassignedAccounts.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => setAddingAccount(!addingAccount)}
            >
              <Plus className="h-3 w-3" />
              Add
            </Button>
          )}
        </div>

        {addingAccount && (
          <div className="mb-2">
            <Select onValueChange={handleAddAccount}>
              <SelectTrigger size="sm">
                <SelectValue placeholder="Select account..." />
              </SelectTrigger>
              <SelectContent>
                {unassignedAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {box.accounts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No accounts assigned yet.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {box.accounts.map((account) => (
              <Badge
                key={account.id}
                variant="outline"
                className="gap-1 pr-1"
              >
                {account.name}
                <button
                  onClick={() => handleRemoveAccount(account.id)}
                  className="ml-0.5 rounded-sm p-0.5 hover:bg-destructive/10 hover:text-destructive transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      <Separator />

      {/* Device section header + filters */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Smartphone className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Devices
          </span>
          <Badge variant="secondary" className="text-xs">
            {devices.length}
          </Badge>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search devices..."
              className="h-8 pl-8"
            />
          </div>
          <div className="flex gap-1">
            {STATE_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setStateFilter(f.value)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  stateFilter === f.value
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Device list */}
      {filteredDevices.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm text-muted-foreground">
            {devices.length === 0
              ? "No devices found. Try syncing."
              : "No matching devices"}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {filteredDevices.map((device) => (
            <DeviceItem
              key={device.id}
              device={device}
              accounts={activeAccounts}
              onUpdated={onUpdated}
            />
          ))}
        </div>
      )}
    </div>
  );
}
