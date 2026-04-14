"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { AvatarListPanel } from "./avatar-list-panel";
import { DevicePanel } from "./device-panel";
import { AvatarDetailPanel } from "./avatar-detail-panel";
import type { AvatarWithRelations } from "@/types";

export type AvatarSortField =
  | "last_used"
  | "alphabetical"
  | "usage"
  | "created"
  | "status";

interface OperatorLayoutProps {
  accountId: string;
  avatars: AvatarWithRelations[];
}

function stableSort(
  list: AvatarWithRelations[],
  compareFn: (a: AvatarWithRelations, b: AvatarWithRelations) => number
) {
  return [...list].sort(
    (a, b) => compareFn(a, b) || a.id.localeCompare(b.id)
  );
}

const panelStyle = { overflow: "hidden" as const, height: "100%" as const };

const defaultLayout = { avatars: 33, device: 34, details: 33 };

export function OperatorLayout({ accountId, avatars }: OperatorLayoutProps) {
  const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(
    avatars[0]?.id ?? null
  );
  const [sortField, setSortField] = useState<AvatarSortField>("last_used");

  const [localAvatars, setLocalAvatars] = useState(avatars);

  useEffect(() => {
    setLocalAvatars(avatars);
  }, [avatars]);

  useEffect(() => {
    if (localAvatars.length === 0) {
      setSelectedAvatarId(null);
      return;
    }
    const stillExists = localAvatars.some((a) => a.id === selectedAvatarId);
    if (!stillExists) {
      setSelectedAvatarId(localAvatars[0].id);
    }
  }, [localAvatars, selectedAvatarId]);

  const handleAvatarUpdated = useCallback(
    (updated: AvatarWithRelations) => {
      setLocalAvatars((prev) =>
        prev.map((a) => (a.id === updated.id ? updated : a))
      );
    },
    []
  );

  const selectedAvatar = useMemo(
    () => localAvatars.find((a) => a.id === selectedAvatarId) ?? null,
    [localAvatars, selectedAvatarId]
  );

  const sortedAvatars = useMemo(() => {
    switch (sortField) {
      case "alphabetical":
        return stableSort(localAvatars, (a, b) =>
          `${a.first_name} ${a.last_name}`.localeCompare(
            `${b.first_name} ${b.last_name}`
          )
        );
      case "created":
        return stableSort(
          localAvatars,
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime()
        );
      case "status":
        return stableSort(localAvatars, (a, b) =>
          a.status.localeCompare(b.status)
        );
      case "usage":
      case "last_used":
      default:
        return stableSort(
          localAvatars,
          (a, b) =>
            new Date(b.updated_at).getTime() -
            new Date(a.updated_at).getTime()
        );
    }
  }, [localAvatars, sortField]);

  const handleSelectAvatar = useCallback((id: string) => {
    setSelectedAvatarId(id);
  }, []);

  return (
    <Group orientation="horizontal" defaultLayout={defaultLayout}>
      <Panel id="avatars" minSize="15%" maxSize="50%" style={panelStyle}>
        <AvatarListPanel
          avatars={sortedAvatars}
          selectedId={selectedAvatarId}
          onSelect={handleSelectAvatar}
          sortField={sortField}
          onSortChange={setSortField}
          accountId={accountId}
        />
      </Panel>

      <Separator className="group/handle relative flex w-px items-center justify-center bg-border transition-colors hover:bg-primary/40 active:bg-primary/60">
        <div className="z-10 h-8 w-[3px] rounded-full bg-border transition-colors group-hover/handle:bg-primary/50 group-active/handle:bg-primary" />
      </Separator>

      <Panel id="device" minSize="15%" maxSize="50%" style={panelStyle}>
        <DevicePanel avatar={selectedAvatar} />
      </Panel>

      <Separator className="group/handle relative flex w-px items-center justify-center bg-border transition-colors hover:bg-primary/40 active:bg-primary/60">
        <div className="z-10 h-8 w-[3px] rounded-full bg-border transition-colors group-hover/handle:bg-primary/50 group-active/handle:bg-primary" />
      </Separator>

      <Panel id="details" minSize="20%" style={panelStyle}>
        <AvatarDetailPanel
          avatar={selectedAvatar}
          accountId={accountId}
          onAvatarUpdated={handleAvatarUpdated}
        />
      </Panel>
    </Group>
  );
}
