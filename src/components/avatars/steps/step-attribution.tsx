"use client";

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, X, Users, Shield } from "lucide-react";
import { getAccountUsers, getAccountArmies } from "@/app/actions/avatars";
import type { UserProfile, Army } from "@/types";
import type { StepProps } from "../types";

interface StepAttributionProps extends StepProps {
  accountId: string;
}

export function StepAttribution({ data, onChange, accountId }: StepAttributionProps) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [armies, setArmies] = useState<Army[]>([]);
  const [loading, setLoading] = useState(true);
  const [newArmyInput, setNewArmyInput] = useState("");

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    Promise.all([getAccountUsers(accountId), getAccountArmies(accountId)])
      .then(([u, a]) => {
        setUsers(u);
        setArmies(a);
      })
      .catch(() => {
        setUsers([]);
        setArmies([]);
      })
      .finally(() => setLoading(false));
  }, [accountId]);

  const toggleOperator = (id: string) => {
    const current = data.operator_ids;
    onChange({
      operator_ids: current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id],
    });
  };

  const toggleArmy = (id: string) => {
    const current = data.army_ids;
    onChange({
      army_ids: current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id],
    });
  };

  const addNewArmy = () => {
    const name = newArmyInput.trim();
    if (!name) return;
    if (data.new_army_names.includes(name)) return;
    if (armies.some((a) => a.name.toLowerCase() === name.toLowerCase())) return;
    onChange({ new_army_names: [...data.new_army_names, name] });
    setNewArmyInput("");
  };

  const removeNewArmy = (name: string) => {
    onChange({ new_army_names: data.new_army_names.filter((n) => n !== name) });
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-1.5">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const selectedUserCount = data.operator_ids.length;
  const selectedArmyCount = data.army_ids.length + data.new_army_names.length;

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h3 className="text-heading-3">Attribution</h3>
        <p className="text-body-sm text-muted-foreground">
          Assign this avatar to users and armies. All fields are optional.
        </p>
      </div>

      {/* Users */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <Label className="text-label">Assign to Users</Label>
          </div>
          {selectedUserCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {selectedUserCount} selected
            </span>
          )}
        </div>
        {users.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No users in this account.
          </p>
        ) : (
          <div className="max-h-[180px] space-y-1 overflow-y-auto rounded-lg border p-1.5 scrollbar-thin">
            {users.map((user) => (
              <label
                key={user.id}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 transition-colors hover:bg-muted"
              >
                <Checkbox
                  checked={data.operator_ids.includes(user.id)}
                  onCheckedChange={() => toggleOperator(user.id)}
                />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium">
                    {user.display_name ?? user.email}
                  </p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {user.role}
                  </p>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Armies */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <Label className="text-label">Assign to Armies</Label>
          </div>
          {selectedArmyCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {selectedArmyCount} selected
            </span>
          )}
        </div>

        {armies.length > 0 && (
          <div className="max-h-[160px] space-y-1 overflow-y-auto rounded-lg border p-1.5 scrollbar-thin">
            {armies.map((army) => (
              <label
                key={army.id}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 transition-colors hover:bg-muted"
              >
                <Checkbox
                  checked={data.army_ids.includes(army.id)}
                  onCheckedChange={() => toggleArmy(army.id)}
                />
                <span className="text-sm">{army.name}</span>
              </label>
            ))}
          </div>
        )}

        {data.new_army_names.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {data.new_army_names.map((name) => (
              <Badge key={name} variant="secondary" className="gap-1 pr-1">
                {name}
                <button
                  type="button"
                  onClick={() => removeNewArmy(name)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                  aria-label={`Remove army ${name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        <div className="flex gap-1.5">
          <Input
            placeholder="Create new army..."
            value={newArmyInput}
            onChange={(e) => setNewArmyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addNewArmy();
              }
            }}
            className="h-8 text-sm"
            autoComplete="off"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addNewArmy}
            disabled={!newArmyInput.trim()}
            className="h-8 w-8 shrink-0 p-0"
            aria-label="Create army"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
