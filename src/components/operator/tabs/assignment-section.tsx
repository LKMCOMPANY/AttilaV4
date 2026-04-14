"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, X, Users, UserCog } from "lucide-react";
import { toast } from "sonner";
import {
  getAccountUsers,
  getAccountArmies,
  setAvatarArmies,
  setAvatarOperators,
} from "@/app/actions/avatars";
import type { AvatarWithRelations, UserProfile, Army } from "@/types";

interface AssignmentSectionProps {
  avatar: AvatarWithRelations;
  accountId: string;
  onUpdated: (avatar: AvatarWithRelations) => void;
}

export function AssignmentSection({
  avatar,
  accountId,
  onUpdated,
}: AssignmentSectionProps) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [armies, setArmies] = useState<Army[]>([]);
  const [loading, setLoading] = useState(true);
  const [newArmyInput, setNewArmyInput] = useState("");

  useEffect(() => {
    setLoading(true);
    Promise.all([getAccountUsers(accountId), getAccountArmies(accountId)])
      .then(([u, a]) => { setUsers(u); setArmies(a); })
      .catch(() => { setUsers([]); setArmies([]); })
      .finally(() => setLoading(false));
  }, [accountId]);

  const selectedArmyIds = (avatar.armies ?? []).map((a) => a.id);
  const selectedOperatorIds = (avatar.operators ?? []).map((o) => o.id);

  const toggleArmy = async (armyId: string) => {
    const next = selectedArmyIds.includes(armyId)
      ? selectedArmyIds.filter((id) => id !== armyId)
      : [...selectedArmyIds, armyId];

    const nextArmies = armies.filter((a) => next.includes(a.id));
    onUpdated({ ...avatar, armies: nextArmies });

    const { error } = await setAvatarArmies(avatar.id, next);
    if (error) {
      toast.error(error);
      onUpdated(avatar);
    }
  };

  const addNewArmy = async () => {
    const name = newArmyInput.trim();
    if (!name) return;
    if (armies.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
      toast.error("Army already exists");
      return;
    }

    const { error } = await setAvatarArmies(avatar.id, selectedArmyIds, [name]);
    if (error) {
      toast.error(error);
    } else {
      toast.success(`Army "${name}" created`);
      setNewArmyInput("");
      const fresh = await getAccountArmies(accountId);
      setArmies(fresh);
      const freshIds = [...selectedArmyIds, ...fresh.filter((a) => a.name === name).map((a) => a.id)];
      onUpdated({ ...avatar, armies: fresh.filter((a) => freshIds.includes(a.id)) });
    }
  };

  const toggleOperator = async (profileId: string) => {
    const next = selectedOperatorIds.includes(profileId)
      ? selectedOperatorIds.filter((id) => id !== profileId)
      : [...selectedOperatorIds, profileId];

    const nextOps = users.filter((u) => next.includes(u.id));
    onUpdated({ ...avatar, operators: nextOps });

    const { error } = await setAvatarOperators(avatar.id, next);
    if (error) {
      toast.error(error);
      onUpdated(avatar);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Army */}
      <div>
        <div className="mb-2.5 flex items-center gap-2">
          <Users className="h-3.5 w-3.5 text-muted-foreground/60" />
          <h3 className="text-[13px] font-semibold">Army</h3>
        </div>

        {armies.length > 0 && (
          <div className="max-h-[120px] space-y-0.5 overflow-y-auto rounded-lg border p-1 scrollbar-thin">
            {armies.map((army) => (
              <label
                key={army.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-muted"
              >
                <Checkbox
                  checked={selectedArmyIds.includes(army.id)}
                  onCheckedChange={() => toggleArmy(army.id)}
                />
                <span className="text-[12px]">{army.name}</span>
              </label>
            ))}
          </div>
        )}

        {selectedArmyIds.length === 0 && armies.length === 0 && (
          <p className="rounded-lg border border-dashed bg-muted/20 px-3 py-2.5 text-[12px] text-muted-foreground/70">
            No armies available
          </p>
        )}

        <div className="mt-2 flex gap-1.5">
          <Input
            placeholder="Create new army..."
            value={newArmyInput}
            onChange={(e) => setNewArmyInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNewArmy(); } }}
            className="h-7 text-[11px]"
            autoComplete="off"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={addNewArmy}
            disabled={!newArmyInput.trim()}
            className="h-7 w-7 shrink-0 p-0"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Operators */}
      <div>
        <div className="mb-2.5 flex items-center gap-2">
          <UserCog className="h-3.5 w-3.5 text-muted-foreground/60" />
          <h3 className="text-[13px] font-semibold">Operator</h3>
        </div>

        {users.length > 0 ? (
          <div className="max-h-[120px] space-y-0.5 overflow-y-auto rounded-lg border p-1 scrollbar-thin">
            {users.map((user) => (
              <label
                key={user.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-muted"
              >
                <Checkbox
                  checked={selectedOperatorIds.includes(user.id)}
                  onCheckedChange={() => toggleOperator(user.id)}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium">
                    {user.display_name ?? user.email}
                  </p>
                  <p className="text-[10px] text-muted-foreground capitalize">{user.role}</p>
                </div>
              </label>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed bg-muted/20 px-3 py-2.5 text-[12px] text-muted-foreground/70">
            No users in this account
          </p>
        )}
      </div>
    </div>
  );
}
