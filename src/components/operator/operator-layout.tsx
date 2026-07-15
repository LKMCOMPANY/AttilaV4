"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Group, Panel } from "react-resizable-panels";
import { ResizableHandle } from "@/components/ui/resizable";
import { useRealtimeAccount } from "@/hooks/use-realtime-account";
import {
  getAvatarAutomatorStatuses,
  getDeviceStates,
  refreshDeviceStates,
} from "@/app/actions/avatars";
import type { AvatarAutomatorInfo } from "@/app/actions/avatars";
import { getAvatarHealthSignals } from "@/app/actions/account-health";
import { getActiveBlocks } from "@/app/actions/avatar-blocks";
import { AvatarListPanel } from "./avatar-list-panel";
import { DevicePanel } from "./device-panel";
import { AvatarDetailPanel } from "./avatar-detail-panel";
import { avatarNeedsAttention, type AvatarHealthSignals } from "@/lib/constants/account-health";
import type {
  AvatarPlatformBlock,
  AvatarWithRelations,
  DeviceState,
  SocialPlatform,
} from "@/types";

const EMPTY_SIGNALS: AvatarHealthSignals = {};
const EMPTY_BLOCKS: AvatarPlatformBlock[] = [];

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
  canManage: boolean;
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
  canManage,
}: OperatorLayoutProps) {
  const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(
    avatars[0]?.id ?? null
  );
  const [sortField, setSortField] = useState<AvatarSortField>("last_used");
  const [filterArmyId, setFilterArmyId] = useState<string | null>(null);
  const [healthFilter, setHealthFilter] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [localAvatars, setLocalAvatars] = useState(avatars);
  const [automatorStatuses, setAutomatorStatuses] = useState<Record<string, AvatarAutomatorInfo>>({});
  const [deviceStates, setDeviceStates] = useState<Record<string, string>>({});
  const [healthSignals, setHealthSignals] = useState<Record<string, AvatarHealthSignals>>({});
  const [blocksByAvatar, setBlocksByAvatar] = useState<Record<string, AvatarPlatformBlock[]>>({});

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

  // On-device + shadow-ban health signals — refreshed with the same job ticks.
  useEffect(() => {
    getAvatarHealthSignals(accountId).then(setHealthSignals);
  }, [accountId, jobsVersion]);

  // Active guardrail blocks — the authoritative "not callable" state. The
  // executor, the health worker and the resolve action all broadcast on the
  // `jobs` channel, so blocks stay current without re-calling the avatar.
  useEffect(() => {
    getActiveBlocks(accountId).then(setBlocksByAvatar);
  }, [accountId, jobsVersion]);

  // Optimistic clear after "Mark resolved" — the realtime tick then converges
  // the map with the server truth.
  const handleBlockResolved = useCallback(
    (avatarId: string, platform: SocialPlatform) => {
      setBlocksByAvatar((prev) => {
        const remaining = (prev[avatarId] ?? []).filter((b) => b.platform !== platform);
        return { ...prev, [avatarId]: remaining };
      });
    },
    [],
  );

  // Optimistic add after a manual block — same convergence path.
  const handleBlockOpened = useCallback(
    (avatarId: string, block: AvatarPlatformBlock) => {
      setBlocksByAvatar((prev) => ({
        ...prev,
        [avatarId]: [block, ...(prev[avatarId] ?? [])],
      }));
    },
    [],
  );

  // Fast path: read last-known device states from the DB on mount + on realtime
  // events. Never blocks and is cheap.
  useEffect(() => {
    getDeviceStates(accountId).then(setDeviceStates);
  }, [accountId, devicesVersion]);

  // Slow path: reconcile against the live box state once after first paint. This
  // is the per-box list_names call that used to block the page render; running
  // it here keeps navigation instant while still converging to box truth.
  useEffect(() => {
    let cancelled = false;
    refreshDeviceStates(accountId)
      .then((states) => {
        if (!cancelled && Object.keys(states).length > 0) setDeviceStates(states);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [accountId]);

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

  // Archiving removes the avatar from the active list (it is soft-deleted).
  const handleAvatarArchived = useCallback((avatarId: string) => {
    setLocalAvatars((prev) => prev.filter((a) => a.id !== avatarId));
  }, []);

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

  // Count of avatars with an active block or an alarming account signal —
  // powers the "needs attention" filter toggle (hidden when the fleet is
  // healthy).
  const attentionCount = useMemo(
    () =>
      avatarsWithLiveState.filter((a) =>
        avatarNeedsAttention(a.platform_health, healthSignals[a.id], blocksByAvatar[a.id]),
      ).length,
    [avatarsWithLiveState, healthSignals, blocksByAvatar],
  );

  // Derived in render (React 19 idiom — no state-sync effect): a stale
  // filter can't strand the operator on an empty list once every flagged
  // account is fixed, since the toggle also hides at attentionCount === 0.
  const effectiveHealthFilter = healthFilter && attentionCount > 0;

  const filteredAvatars = useMemo(() => {
    let result = avatarsWithLiveState;
    if (filterArmyId) {
      result = result.filter((a) =>
        a.armies?.some((army) => army.id === filterArmyId)
      );
    }
    if (effectiveHealthFilter) {
      result = result.filter((a) =>
        avatarNeedsAttention(a.platform_health, healthSignals[a.id], blocksByAvatar[a.id]),
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
  }, [avatarsWithLiveState, filterArmyId, effectiveHealthFilter, healthSignals, blocksByAvatar, searchQuery]);

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
          healthFilter={effectiveHealthFilter}
          onHealthFilterChange={setHealthFilter}
          attentionCount={attentionCount}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          deviceCount={deviceCount}
          accountId={accountId}
          canManage={canManage}
          automatorStatuses={automatorStatuses}
          presenceMap={presenceMap}
          healthSignals={healthSignals}
          blocksByAvatar={blocksByAvatar}
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
          canManage={canManage}
          healthSignals={selectedAvatar ? healthSignals[selectedAvatar.id] ?? EMPTY_SIGNALS : EMPTY_SIGNALS}
          blocks={selectedAvatar ? blocksByAvatar[selectedAvatar.id] ?? EMPTY_BLOCKS : EMPTY_BLOCKS}
          onBlockResolved={handleBlockResolved}
          onBlockOpened={handleBlockOpened}
          onAvatarUpdated={handleAvatarUpdated}
          onAvatarArchived={handleAvatarArchived}
        />
      </Panel>
    </Group>
  );
}
