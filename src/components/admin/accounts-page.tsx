"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { AccountListItem } from "@/components/admin/account-list-item";
import { AccountDetail } from "@/components/admin/account-detail";
import { AccountCreateDialog } from "@/components/admin/account-create-dialog";
import { getAccounts } from "@/app/actions/accounts";
import { Search, Building2 } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import type { AccountStatus, AccountWithUsers } from "@/types";

type StatusFilter = "all" | AccountStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "standby", label: "Standby" },
  { value: "archived", label: "Archived" },
];

interface AccountsPageProps {
  initialAccounts: AccountWithUsers[];
}

export function AccountsPage({ initialAccounts }: AccountsPageProps) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] =
    useState<AccountWithUsers | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [, startTransition] = useTransition();
  const isMobile = useIsMobile();

  const filteredAccounts = useMemo(() => {
    let result = accounts;
    if (statusFilter !== "all") {
      result = result.filter((a) => a.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.description?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [accounts, search, statusFilter]);

  const refreshAccounts = useCallback(() => {
    startTransition(async () => {
      const fresh = await getAccounts();
      setAccounts(fresh);

      if (selectedId) {
        const updated = fresh.find((a) => a.id === selectedId) ?? null;
        setSelectedAccount(updated);
      }
    });
  }, [selectedId, startTransition]);

  const selectAccount = useCallback(
    (id: string) => {
      setSelectedId(id);
      const found = accounts.find((a) => a.id === id) ?? null;
      setSelectedAccount(found);
    },
    [accounts]
  );

  const handleCreated = useCallback(
    (id: string) => {
      startTransition(async () => {
        const fresh = await getAccounts();
        setAccounts(fresh);
        setSelectedId(id);
        setSelectedAccount(fresh.find((a) => a.id === id) ?? null);
      });
    },
    [startTransition]
  );

  const listPanel = (
    <div className="flex h-full flex-col">
      <div className="space-y-3 p-4">
        <AccountCreateDialog onCreated={handleCreated} />
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search accounts..."
            className="h-8 pl-8"
          />
        </div>
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={cn(
                "rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
                statusFilter === f.value
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1 px-2 pb-2">
        {filteredAccounts.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              {accounts.length === 0
                ? "No accounts yet"
                : "No matching accounts"}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredAccounts.map((account) => (
              <AccountListItem
                key={account.id}
                account={account}
                isSelected={selectedId === account.id}
                onSelect={selectAccount}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );

  const detailPanel = selectedAccount ? (
    <div className="h-full overflow-y-auto p-4 lg:p-6">
      <AccountDetail
        key={selectedAccount.id}
        account={selectedAccount}
        onUpdated={refreshAccounts}
      />
    </div>
  ) : (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="rounded-xl bg-muted p-4">
        <Building2 className="h-8 w-8 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium">Select an account</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose an account from the list to view details and manage users.
        </p>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <div className="animate-in">
        <div className="mb-4">
          <h1 className="text-heading-2">Accounts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage client organizations and their users.
          </p>
        </div>

        {listPanel}

        <Sheet
          open={selectedAccount !== null}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedId(null);
              setSelectedAccount(null);
            }
          }}
        >
          {/*
           * Mobile sheet — the base sheet uses `data-[side=bottom]:h-auto`, so
           * we re-apply the variant to lock height to the dynamic viewport
           * (`dvh` accounts for iOS Safari chrome) and delegate scrolling to an
           * inner `flex-1 overflow-y-auto` container. This is the canonical
           * pattern that survives long content and tall children.
           */}
          <SheetContent
            side="bottom"
            className="flex flex-col rounded-t-xl p-0 data-[side=bottom]:h-[90dvh] data-[side=bottom]:max-h-[90dvh]"
          >
            {selectedAccount && (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pt-6 scrollbar-thin">
                <AccountDetail
                  key={selectedAccount.id}
                  account={selectedAccount}
                  onUpdated={refreshAccounts}
                />
              </div>
            )}
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  return (
    <div className="animate-in flex h-full flex-col">
      <div className="mb-6 shrink-0">
        <h1 className="text-heading-2">Accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage client organizations and their users.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 gap-6">
        {/* Left panel */}
        <div className="w-[320px] shrink-0 overflow-hidden rounded-lg border bg-card">
          {listPanel}
        </div>

        {/* Right panel */}
        <div className="min-w-0 flex-1 overflow-hidden rounded-lg border bg-card">
          {detailPanel}
        </div>
      </div>
    </div>
  );
}
