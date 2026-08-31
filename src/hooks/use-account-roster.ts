"use client";

import { useEffect, useState } from "react";
import { getAccountUsers, getAccountArmies } from "@/app/actions/avatars";
import type { UserProfile, Army } from "@/types";

const NO_USERS: UserProfile[] = [];
const NO_ARMIES: Army[] = [];

export interface AccountRoster {
  users: UserProfile[];
  armies: Army[];
  loading: boolean;
  /**
   * Replace the army list in place — for when the caller has just created one
   * and already holds the fresh server list. A no-op if the account changed
   * underneath, so a late write can't resurrect another account's data.
   */
  setArmies: (armies: Army[]) => void;
}

/**
 * The users + armies of an account, as needed by every avatar assignment UI.
 *
 * Holds ONE state keyed by the account it was fetched for, so `loading` is a
 * derivation instead of a second state an effect has to keep in sync (the
 * React 19 `set-state-in-effect` rule, and `AGENTS.md` frontend rule 3). The
 * same key makes a response that lands after `accountId` moved on inert
 * rather than letting it overwrite the current account's roster.
 */
export function useAccountRoster(accountId: string): AccountRoster {
  const [loaded, setLoaded] = useState<{
    accountId: string;
    users: UserProfile[];
    armies: Army[];
  } | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    Promise.all([getAccountUsers(accountId), getAccountArmies(accountId)])
      .then(([users, armies]) => {
        if (!cancelled) setLoaded({ accountId, users, armies });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ accountId, users: [], armies: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const isCurrent = loaded?.accountId === accountId;

  return {
    users: isCurrent ? loaded.users : NO_USERS,
    armies: isCurrent ? loaded.armies : NO_ARMIES,
    loading: !isCurrent,
    setArmies: (armies) =>
      setLoaded((prev) => (prev?.accountId === accountId ? { ...prev, armies } : prev)),
  };
}
