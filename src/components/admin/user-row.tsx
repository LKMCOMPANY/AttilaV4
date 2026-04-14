"use client";

import { useCallback, useState, useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { AutoSaveField } from "@/components/admin/auto-save-field";
import { Trash2, Loader2, Mail } from "lucide-react";
import { updateUser, deleteUser } from "@/app/actions/users";
import { toast } from "sonner";
import type { UserProfile, UserRole } from "@/types";

interface UserRowProps {
  user: UserProfile;
  onDeleted: () => void;
  onUpdated: () => void;
}

export function UserRow({ user, onDeleted, onUpdated }: UserRowProps) {
  const [isDeleting, startDeleteTransition] = useTransition();
  const [, startRoleTransition] = useTransition();
  const [currentRole, setCurrentRole] = useState(user.role);

  const handleSaveName = useCallback(
    async (value: string) => {
      const result = await updateUser({ id: user.id, display_name: value });
      if (!result.error) onUpdated();
      return result;
    },
    [user.id, onUpdated]
  );

  function handleRoleChange(newRole: string | null) {
    if (!newRole) return;
    const typedRole = newRole as Exclude<UserRole, "admin">;
    setCurrentRole(typedRole);

    startRoleTransition(async () => {
      const result = await updateUser({ id: user.id, role: typedRole });
      if (result.error) {
        toast.error(result.error);
        setCurrentRole(user.role);
      } else {
        onUpdated();
      }
    });
  }

  function handleDelete() {
    startDeleteTransition(async () => {
      const result = await deleteUser(user.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("User deleted");
      onDeleted();
    });
  }

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-transparent p-2.5 transition-colors hover:border-border hover:bg-card">
      <div className="min-w-0 flex-1 space-y-1">
        <AutoSaveField
          value={user.display_name ?? ""}
          onSave={handleSaveName}
          placeholder="Display name"
          className="h-7 text-sm font-medium"
        />
        <div className="flex items-center gap-1.5 px-2.5 text-xs text-muted-foreground">
          <Mail className="h-3 w-3 shrink-0" />
          <span className="truncate">{user.email}</span>
        </div>
      </div>

      <Select value={currentRole} onValueChange={handleRoleChange}>
        <SelectTrigger size="sm" className="w-[110px] shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="manager">Manager</SelectItem>
          <SelectItem value="operator">Operator</SelectItem>
        </SelectContent>
      </Select>

      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-destructive opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
            />
          }
        >
          {isDeleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </AlertDialogTrigger>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove{" "}
              <strong>{user.display_name || user.email}</strong> and revoke
              their access. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
