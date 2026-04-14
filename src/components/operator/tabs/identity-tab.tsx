"use client";

import { useState } from "react";
import {
  Avatar as UiAvatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { countryCodeToFlag } from "@/lib/utils";
import { COUNTRIES } from "@/lib/data/countries";
import { getLanguagesForSelect, getLanguageName } from "@/lib/data/languages";
import { updateAvatar } from "@/app/actions/avatars";
import { toast } from "sonner";
import type { AvatarWithRelations } from "@/types";
import type { EditableTabProps } from "../avatar-detail-panel";
import {
  Pencil,
  Mail,
  Phone,
  Globe,
  Languages,
  Calendar,
  Tag,
  Plus,
  X,
} from "lucide-react";

export function IdentityTab({ avatar, onUpdated }: EditableTabProps) {
  const fullName = `${avatar.first_name} ${avatar.last_name}`;
  const flag = countryCodeToFlag(avatar.country_code);
  const country = COUNTRIES.find((c) => c.code === avatar.country_code);

  const saveField = async (field: string, value: unknown) => {
    const prev = avatar[field as keyof AvatarWithRelations];
    onUpdated({ ...avatar, [field]: value } as AvatarWithRelations);

    const { error } = await updateAvatar(avatar.id, { [field]: value });
    if (error) {
      toast.error(error);
      onUpdated({ ...avatar, [field]: prev } as AvatarWithRelations);
    }
  };

  return (
    <div className="space-y-5">
      {/* Profile header */}
      <div className="flex items-center gap-3">
        <UiAvatar className="h-14 w-14 rounded-xl">
          {avatar.profile_image_url && (
            <AvatarImage src={avatar.profile_image_url} alt={fullName} />
          )}
          <AvatarFallback className="rounded-xl text-base font-semibold">
            {avatar.first_name[0]}
            {avatar.last_name[0]}
          </AvatarFallback>
        </UiAvatar>
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">{fullName}</h3>
          <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            {flag && <span>{flag}</span>}
            <span>{country?.name ?? avatar.country_code}</span>
          </div>
        </div>
      </div>

      {/* Editable fields */}
      <div className="rounded-lg border bg-card/50">
        <EditableRow
          label="First Name"
          icon={Pencil}
          value={avatar.first_name}
          onSave={(v) => saveField("first_name", v)}
          first
        />
        <EditableRow
          label="Last Name"
          icon={Pencil}
          value={avatar.last_name}
          onSave={(v) => saveField("last_name", v)}
        />
        <EditableRow
          label="Email"
          icon={Mail}
          value={avatar.email ?? ""}
          onSave={(v) => saveField("email", v || null)}
        />
        <EditableRow
          label="Phone"
          icon={Phone}
          value={avatar.phone ?? ""}
          onSave={(v) => saveField("phone", v || null)}
        />
        <EditableRow
          label="Image URL"
          icon={Pencil}
          value={avatar.profile_image_url ?? ""}
          onSave={(v) => saveField("profile_image_url", v || null)}
        />

        {/* Country select */}
        <div className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2.5">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Globe className="h-3.5 w-3.5 shrink-0 opacity-50" />
            <span>Country</span>
          </div>
          <Select
            value={avatar.country_code}
            onValueChange={(v) => { if (v) saveField("country_code", v); }}
          >
            <SelectTrigger className="h-6 w-auto gap-1 border-0 bg-transparent px-1.5 text-[12px] font-medium shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-[200px]">
              {COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {countryCodeToFlag(c.code)} {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Language select */}
        <div className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2.5">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Languages className="h-3.5 w-3.5 shrink-0 opacity-50" />
            <span>Language</span>
          </div>
          <Select
            value={avatar.language_code}
            onValueChange={(v) => { if (v) saveField("language_code", v); }}
          >
            <SelectTrigger className="h-6 w-auto gap-1 border-0 bg-transparent px-1.5 text-[12px] font-medium shadow-none">
              <SelectValue>{getLanguageName(avatar.language_code)}</SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-[200px]">
              {getLanguagesForSelect().map((l) => (
                <SelectItem key={l.code} value={l.code}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Read-only dates */}
        <div className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2.5">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Calendar className="h-3.5 w-3.5 shrink-0 opacity-50" />
            <span>Created</span>
          </div>
          <span className="text-[12px] font-medium">
            {new Date(avatar.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-b-lg px-3 py-2.5">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Calendar className="h-3.5 w-3.5 shrink-0 opacity-50" />
            <span>Updated</span>
          </div>
          <span className="text-[12px] font-medium">
            {new Date(avatar.updated_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
          </span>
        </div>
      </div>

      {/* Tags */}
      <TagEditor
        tags={avatar.tags}
        onSave={(tags) => saveField("tags", tags)}
      />
    </div>
  );
}

function EditableRow({
  label,
  icon: Icon,
  value,
  onSave,
  first,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  onSave: (value: string) => void;
  first?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const handleSave = () => {
    if (draft !== value) onSave(draft);
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(value);
    setEditing(false);
  };

  return (
    <div
      className={`group/row flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2.5 ${first ? "rounded-t-lg" : ""}`}
    >
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0 opacity-50" />
        <span>{label}</span>
      </div>
      {editing ? (
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") handleCancel();
          }}
          onBlur={handleSave}
          className="h-6 max-w-[180px] border-0 bg-transparent px-1 text-right text-[12px] font-medium shadow-none focus-visible:ring-1"
          autoFocus
          autoComplete="off"
        />
      ) : (
        <button
          onClick={() => { setDraft(value); setEditing(true); }}
          className="group/edit flex items-center gap-1 text-[12px] font-medium"
        >
          <span className="truncate">{value || "—"}</span>
          <Pencil className="h-2.5 w-2.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100" />
        </button>
      )}
    </div>
  );
}

function TagEditor({
  tags,
  onSave,
}: {
  tags: string[];
  onSave: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");

  const addTag = () => {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed || tags.includes(trimmed)) return;
    onSave([...tags, trimmed]);
    setInput("");
  };

  const removeTag = (tag: string) => {
    onSave(tags.filter((t) => t !== tag));
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Tag className="h-3.5 w-3.5 text-muted-foreground/60" />
        <h4 className="text-[13px] font-semibold">Tags</h4>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <Badge key={tag} variant="outline" className="gap-1 pr-1 text-[11px]">
            {tag}
            <button onClick={() => removeTag(tag)} className="rounded-full p-0.5 hover:bg-muted-foreground/20">
              <X className="h-2.5 w-2.5" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5">
        <Input
          placeholder="Add tag..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
          className="h-7 text-[11px]"
          autoComplete="off"
        />
        <Button variant="outline" size="sm" onClick={addTag} disabled={!input.trim()} className="h-7 w-7 shrink-0 p-0">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
