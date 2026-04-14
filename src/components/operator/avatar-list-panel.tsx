"use client";

import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { UserPlus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { AvatarListItem } from "./avatar-list-item";
import { CreateAvatarDialog } from "@/components/avatars/create-avatar-dialog";
import type { AvatarWithRelations, Army } from "@/types";
import type { AvatarSortField } from "./operator-layout";

const SORT_OPTIONS: { value: AvatarSortField; label: string; short: string }[] = [
  { value: "last_used", label: "Last Used", short: "Recent" },
  { value: "alphabetical", label: "A → Z", short: "A-Z" },
  { value: "usage", label: "Usage", short: "Use" },
  { value: "created", label: "Created", short: "New" },
  { value: "status", label: "Status", short: "Stat" },
];

interface AvatarListPanelProps {
  avatars: AvatarWithRelations[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  sortField: AvatarSortField;
  onSortChange: (field: AvatarSortField) => void;
  armies: Pick<Army, "id" | "name">[];
  filterArmyId: string | null;
  onFilterArmyChange: (armyId: string | null) => void;
  deviceCount: number;
  accountId: string;
}

export function AvatarListPanel({
  avatars,
  selectedId,
  onSelect,
  sortField,
  onSortChange,
  armies,
  filterArmyId,
  onFilterArmyChange,
  deviceCount,
  accountId,
}: AvatarListPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="@container/list flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground">
          Avatars
          <span className="ml-1.5 text-foreground/50">
            {avatars.length}
          </span>
          <span className="mx-1 text-border">/</span>
          <span className="text-foreground/50">
            {deviceCount}
          </span>
          <span className="ml-0.5 hidden @[240px]/list:inline text-[9px] font-normal normal-case tracking-normal">
            devices
          </span>
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDialogOpen(true)}
          className="h-7 w-7 p-0 @[220px]/list:w-auto @[220px]/list:gap-1.5 @[220px]/list:px-2"
        >
          <UserPlus className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden @[220px]/list:inline text-xs">New</span>
        </Button>
      </div>

      {/* Sort toolbar */}
      <div
        role="toolbar"
        aria-label="Sort avatars"
        className="flex shrink-0 gap-0.5 overflow-x-auto border-b px-1.5 py-1.5 scrollbar-hide"
      >
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onSortChange(opt.value)}
            aria-pressed={sortField === opt.value}
            className={cn(
              "shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              sortField === opt.value
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <span className="hidden @[260px]/list:inline">{opt.label}</span>
            <span className="@[260px]/list:hidden">{opt.short}</span>
          </button>
        ))}
      </div>

      {/* Army filter */}
      {armies.length > 0 && (
        <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b px-1.5 py-1.5 scrollbar-hide">
          <button
            onClick={() => onFilterArmyChange(null)}
            className={cn(
              "shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
              filterArmyId === null
                ? "bg-secondary text-secondary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            All
          </button>
          {armies.map((army) => (
            <button
              key={army.id}
              onClick={() =>
                onFilterArmyChange(filterArmyId === army.id ? null : army.id)
              }
              className={cn(
                "shrink-0 truncate rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                filterArmyId === army.id
                  ? "bg-secondary text-secondary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {army.name}
            </button>
          ))}
        </div>
      )}

      {/* List */}
      <ScrollArea className="flex-1">
        <div role="listbox" aria-label="Avatars" className="p-1.5">
          {avatars.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <div className="rounded-full bg-muted p-3">
                <Search className="h-5 w-5 text-muted-foreground/50" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  No avatars yet
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground/60">
                  Create your first avatar to get started
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDialogOpen(true)}
                className="mt-1 gap-1.5"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Create Avatar
              </Button>
            </div>
          ) : (
            <div className="space-y-px">
              {avatars.map((avatar) => (
                <AvatarListItem
                  key={avatar.id}
                  avatar={avatar}
                  isSelected={avatar.id === selectedId}
                  onSelect={() => onSelect(avatar.id)}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      <CreateAvatarDialog
        accountId={accountId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
