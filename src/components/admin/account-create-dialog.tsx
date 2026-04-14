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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Plus, Loader2 } from "lucide-react";
import { createAccount } from "@/app/actions/accounts";
import { toast } from "sonner";

interface AccountCreateDialogProps {
  onCreated: (id: string) => void;
}

export function AccountCreateDialog({ onCreated }: AccountCreateDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    startTransition(async () => {
      const result = await createAccount({
        name: name.trim(),
        description: description.trim() || undefined,
      });

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success("Account created");
      setOpen(false);
      setName("");
      setDescription("");
      if (result.data) onCreated(result.data.id);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" className="w-full">
            <Plus data-icon="inline-start" className="h-4 w-4" />
            New Account
          </Button>
        }
      />
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Account</DialogTitle>
            <DialogDescription>
              Add a new client organization.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="account-name">Organization Name</Label>
              <Input
                id="account-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Corp"
                required
                maxLength={100}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-desc">Description</Label>
              <Textarea
                id="account-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short description (optional)"
                rows={2}
                maxLength={500}
              />
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
