"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Group, Panel } from "react-resizable-panels";
import { ResizableHandle } from "@/components/ui/resizable";
import { useRealtimeAccount } from "@/hooks/use-realtime-account";
import { getAvatarAutomatorStatuses, getDeviceStates } from "@/app/actions/avatars";
import type { AvatarAutomatorInfo } from "@/app/actions/avatars";
import { AvatarListPanel } from "./avatar-list-panel";
import { DevicePanel } from "./device-panel";
import { AvatarDetailPanel } from "./avatar-detail-panel";
import type { AvatarWithRelations, DeviceState } from "@/types";

export type AvatarSortField =
  | "last_used"
  | "alphabetical"
  | "usage"
  | "created"
  | "status";

interface OperatorLayoutProps {
  accountId: string;
  avatars: AvatarWithRelations[];
  deviceCount: number;
  displayName: string;
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

export function OperatorLayout({
  accountId,
  avatars,
  deviceCount,
  displayName,
}: OperatorLayoutProps) {
  const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(
    avatars[0]?.id ?? null
  );
  const [sortField, setSortField] = useState<AvatarSortField>("last_used");
  const [filterArmyId, setFilterArmyId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [localAvatars, setLocalAvatars] = useState(avatars);
  const [automatorStatuses, setAutomatorStatuses] = useState<Record<string, AvatarAutomatorInfo>>({});
  const [deviceStates, setDeviceStates] = useState<Record<string, string>>({});

  const presenceState = useMemo(
    () =>
      selectedAvatarId
        ? { avatarId: selectedAvatarId, displayName }
        : null,
    [selectedAvatarId, displayName],
  );

  const { jobsVersion, devicesVersion, presenceMap } = useRealtimeAccount({
    accountId,
    presence: presenceState,
  });

  useEffect(() => {
    setLocalAvatars(avatars);
  }, [avatars]);

  // Fetch automator statuses on mount + on realtime events
  useEffect(() => {
    getAvatarAutomatorStatuses(accountId).then(setAutomatorStatuses);
  }, [accountId, jobsVersion]);

  // Fetch device states on mount + on realtime events
  useEffect(() => {
    getDeviceStates(accountId).then(setDeviceStates);
  }, [accountId, devicesVersion]);

  // Merge live device states into local avatars
  const avatarsWithLiveState = useMemo(() => {
    if (Object.keys(deviceStates).length === 0) return localAvatars;
    return localAvatars.map((a) => {
      if (!a.device?.id || !deviceStates[a.device.id]) return a;
      const liveState = deviceStates[a.device.id] as DeviceState;
      if (liveState === a.device.state) return a;
      return { ...a, device: { ...a.device, state: liveState } };
    });
  }, [localAvatars, deviceStates]);

  useEffect(() => {
    if (avatarsWithLiveState.length === 0) {
      setSelectedAvatarId(null);
      return;
    }
    const stillExists = avatarsWithLiveState.some((a) => a.id === selectedAvatarId);
    if (!stillExists) {
      setSelectedAvatarId(avatarsWithLiveState[0].id);
    }
  }, [avatarsWithLiveState, selectedAvatarId]);

  const handleAvatarUpdated = useCallback(
    (updated: AvatarWithRelations) => {
      setLocalAvatars((prev) =>
        prev.map((a) => (a.id === updated.id ? updated : a))
      );
    },
    []
  );

  const selectedAvatar = useMemo(
    () => avatarsWithLiveState.find((a) => a.id === selectedAvatarId) ?? null,
    [avatarsWithLiveState, selectedAvatarId]
  );

  const armies = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of avatarsWithLiveState) {
      for (const army of a.armies ?? []) {
        map.set(army.id, army.name);
      }
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [avatarsWithLiveState]);

  const filteredAvatars = useMemo(() => {
    let result = avatarsWithLiveState;
    if (filterArmyId) {
      result = result.filter((a) =>
        a.armies?.some((army) => army.id === filterArmyId)
      );
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((a) => {
        const fullName = `${a.first_name} ${a.last_name}`.toLowerCase();
        if (fullName.includes(q)) return true;
        if (a.tags.some((t) => t.toLowerCase().includes(q))) return true;
        return false;
      });
    }
    return result;
  }, [avatarsWithLiveState, filterArmyId, searchQuery]);

  const sortedAvatars = useMemo(() => {
    switch (sortField) {
      case "alphabetical":
        return stableSort(filteredAvatars, (a, b) =>
          `${a.first_name} ${a.last_name}`.localeCompare(
            `${b.first_name} ${b.last_name}`
          )
        );
      case "created":
        return stableSort(
          filteredAvatars,
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime()
        );
      case "status":
        return stableSort(filteredAvatars, (a, b) =>
          a.status.localeCompare(b.status)
        );
      case "usage":
      case "last_used":
      default:
        return stableSort(
          filteredAvatars,
          (a, b) =>
            new Date(b.updated_at).getTime() -
            new Date(a.updated_at).getTime()
        );
    }
  }, [filteredAvatars, sortField]);

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
          armies={armies}
          filterArmyId={filterArmyId}
          onFilterArmyChange={setFilterArmyId}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          deviceCount={deviceCount}
          accountId={accountId}
          automatorStatuses={automatorStatuses}
          presenceMap={presenceMap}
        />
      </Panel>

      <ResizableHandle withHandle />

      <Panel id="device" minSize="15%" maxSize="50%" style={panelStyle}>
        <DevicePanel avatar={selectedAvatar} />
      </Panel>

      <ResizableHandle withHandle />

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
