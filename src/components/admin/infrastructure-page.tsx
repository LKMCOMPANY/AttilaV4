"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { BoxContent } from "@/components/admin/box-content";
import { BoxCreateDialog } from "@/components/admin/box-create-dialog";
import { getBoxes } from "@/app/actions/boxes";
import { getDevicesByBox } from "@/app/actions/devices";
import { getAccounts } from "@/app/actions/accounts";
import { getDeviceAvatarMap } from "@/app/actions/avatars";
import type { DeviceAvatarAssignment } from "@/app/actions/avatars";
import { cn } from "@/lib/utils";
import { Search, Server, Smartphone, Clock } from "lucide-react";
import type { Account, BoxWithRelations, Device } from "@/types";

function formatUptime(seconds: number | null): string {
  if (!seconds) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

interface InfrastructurePageProps {
  initialBoxes: BoxWithRelations[];
}

export function InfrastructurePage({ initialBoxes }: InfrastructurePageProps) {
  const [boxes, setBoxes] = useState(initialBoxes);
  const [search, setSearch] = useState("");
  const [, startTransition] = useTransition();

  // Lazy-loaded data per box
  const [devicesByBox, setDevicesByBox] = useState<Record<string, Device[]>>({});
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [avatarMap, setAvatarMap] = useState<Record<string, DeviceAvatarAssignment>>({});
  const [loadedBoxIds, setLoadedBoxIds] = useState<Set<string>>(new Set());

  const filteredBoxes = useMemo(() => {
    if (!search.trim()) return boxes;
    const q = search.toLowerCase();
    return boxes.filter(
      (b) =>
        b.name?.toLowerCase().includes(q) ||
        b.tunnel_hostname.toLowerCase().includes(q)
    );
  }, [boxes, search]);

  const handleAccordionChange = useCallback(
    (value: readonly number[]) => {
      if (value.length === 0) return;

      const openIndex = value[0];
      const box = filteredBoxes[openIndex];
      if (!box || loadedBoxIds.has(box.id)) return;

      startTransition(async () => {
        const needsAccounts = accounts.length === 0;
        const [devs, accs, avMap] = await Promise.all([
          getDevicesByBox(box.id),
          needsAccounts ? getAccounts() : Promise.resolve(accounts),
          Object.keys(avatarMap).length === 0 ? getDeviceAvatarMap() : Promise.resolve(avatarMap),
        ]);
        setDevicesByBox((prev) => ({ ...prev, [box.id]: devs }));
        setAccounts(accs);
        setAvatarMap(avMap);
        setLoadedBoxIds((prev) => new Set(prev).add(box.id));
      });
    },
    [filteredBoxes, loadedBoxIds, accounts, avatarMap, startTransition]
  );

  const refreshAll = useCallback(() => {
    startTransition(async () => {
      const [freshBoxes, freshAccounts, freshAvatarMap] = await Promise.all([
        getBoxes(),
        getAccounts(),
        getDeviceAvatarMap(),
      ]);
      setBoxes(freshBoxes);
      setAccounts(freshAccounts);
      setAvatarMap(freshAvatarMap);

      const freshDevices: Record<string, Device[]> = {};
      await Promise.all(
        Array.from(loadedBoxIds).map(async (boxId) => {
          freshDevices[boxId] = await getDevicesByBox(boxId);
        })
      );
      setDevicesByBox((prev) => ({ ...prev, ...freshDevices }));
    });
  }, [loadedBoxIds, startTransition]);

  const handleCreated = useCallback(
    (id: string) => {
      startTransition(async () => {
        const fresh = await getBoxes();
        setBoxes(fresh);
        const devs = await getDevicesByBox(id);
        setDevicesByBox((prev) => ({ ...prev, [id]: devs }));
        setLoadedBoxIds((prev) => new Set(prev).add(id));
        if (accounts.length === 0) {
          setAccounts(await getAccounts());
        }
      });
    },
    [accounts.length, startTransition]
  );

  return (
    <div className="animate-in">
      {/* Page header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-heading-2">Infrastructure</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage boxes and their devices.
          </p>
        </div>
        <div className="w-full sm:w-auto">
          <BoxCreateDialog onCreated={handleCreated} />
        </div>
      </div>

      {/* Search */}
      {boxes.length > 0 && (
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search boxes..."
            className="pl-9"
          />
        </div>
      )}

      {/* Box accordion list */}
      {filteredBoxes.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <div className="rounded-xl bg-muted p-4">
            <Server className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">
              {boxes.length === 0 ? "No boxes registered" : "No matching boxes"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {boxes.length === 0
                ? "Add a box to start managing your infrastructure."
                : "Try a different search term."}
            </p>
          </div>
        </div>
      ) : (
        <Accordion onValueChange={handleAccordionChange} className="space-y-3">
          {filteredBoxes.map((box, index) => {
            const devices = devicesByBox[box.id] ?? [];
            const runningCount = devices.filter((d) => d.state === "running").length;
            const isLoaded = loadedBoxIds.has(box.id);

            return (
              <AccordionItem
                key={box.id}
                value={index}
                className="rounded-lg border bg-card shadow-sm not-last:border-b-0"
              >
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <div className="flex w-full items-center gap-3 pr-2">
                    {/* Status dot */}
                    <span
                      className={cn(
                        "h-2.5 w-2.5 shrink-0 rounded-full",
                        box.status === "online"
                          ? "bg-success"
                          : "bg-muted-foreground/40"
                      )}
                    />

                    {/* Name + hostname */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {box.name || box.tunnel_hostname}
                      </p>
                      <p className="truncate text-xs text-muted-foreground font-mono">
                        {box.tunnel_hostname}
                      </p>
                    </div>

                    {/* Metrics — hidden on very small screens */}
                    <div className="hidden items-center gap-3 sm:flex">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Smartphone className="h-3 w-3" />
                        <span>
                          {isLoaded ? (
                            <>
                              <span className="font-medium text-foreground">{runningCount}</span>
                              /{devices.length}
                            </>
                          ) : (
                            <span className="font-medium text-foreground">{box.device_count}</span>
                          )}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>{formatUptime(box.uptime_seconds)}</span>
                      </div>

                      {box.accounts.length > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          {box.accounts.length} account{box.accounts.length !== 1 ? "s" : ""}
                        </Badge>
                      )}
                    </div>
                  </div>
                </AccordionTrigger>

                <AccordionContent className="px-4 pb-4">
                  {isLoaded ? (
                    <BoxContent
                      box={box}
                      devices={devices}
                      allAccounts={accounts}
                      avatarMap={avatarMap}
                      onUpdated={refreshAll}
                    />
                  ) : (
                    <div className="flex items-center justify-center py-8">
                      <p className="text-sm text-muted-foreground">Loading devices...</p>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}
