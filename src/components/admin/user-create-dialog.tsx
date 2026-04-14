"use client";

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Loader2, RefreshCw } from "lucide-react";
import { createUser } from "@/app/actions/users";
import { toast } from "sonner";
import type { UserRole } from "@/types";

interface UserCreateDialogProps {
  accountId: string;
  onCreated: () => void;
}

function generatePassword(length = 16): string {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*";
  return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map((b) => chars[b % chars.length])
    .join("");
}

export function UserCreateDialog({
  accountId,
  onCreated,
}: UserCreateDialogProps) {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(() => generatePassword());
  const [role, setRole] = useState<Exclude<UserRole, "admin">>("manager");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim() || !email.trim() || !password) return;

    startTransition(async () => {
      const result = await createUser({
        display_name: displayName.trim(),
        email: email.trim().toLowerCase(),
        password,
        role,
        account_id: accountId,
      });

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success("User created");
      setOpen(false);
      resetForm();
      onCreated();
    });
  }

  function resetForm() {
    setDisplayName("");
    setEmail("");
    setPassword(generatePassword());
    setRole("manager");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) resetForm();
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Plus data-icon="inline-start" className="h-3.5 w-3.5" />
            Add User
          </Button>
        }
      />
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
            <DialogDescription>
              Create a new user for this account.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="user-name">Display Name</Label>
              <Input
                id="user-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="John Doe"
                required
                maxLength={100}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="john@example.com"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-password">Password</Label>
              <div className="flex gap-2">
                <Input
                  id="user-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="flex-1 font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setPassword(generatePassword())}
                  title="Generate password"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => { if (v) setRole(v as Exclude<UserRole, "admin">); }}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="operator">Operator</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button
              type="submit"
              disabled={
                isPending || !displayName.trim() || !email.trim() || !password
              }
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create User
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
