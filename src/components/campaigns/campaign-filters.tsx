"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { XIcon, TikTokIcon } from "@/components/icons/social-icons";
import { Users, Globe } from "lucide-react";
import type { CampaignFilters, CampaignPlatform } from "@/types";

interface CampaignFiltersProps {
  platforms: CampaignPlatform[];
  filters: CampaignFilters;
  onChange: (filters: CampaignFilters) => void;
}

export function CampaignFiltersSection({
  platforms,
  filters,
  onChange,
}: CampaignFiltersProps) {
  const update = (patch: Partial<CampaignFilters>) => {
    onChange({ ...filters, ...patch });
  };

  const hasTwitter = platforms.includes("twitter");
  const hasTiktok = platforms.includes("tiktok");

  const togglePostType = (type: "post" | "reply" | "retweet") => {
    const current = filters.post_types ?? [];
    const updated = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type];
    update({ post_types: updated.length > 0 ? updated : undefined });
  };

  return (
    <div className="space-y-5">
      {/* ----------------------------------------------------------------- */}
      {/* Common filters                                                    */}
      {/* ----------------------------------------------------------------- */}
      <FilterGroup
        icon={<Users className="h-3.5 w-3.5" />}
        label="Common Filters"
        description="Applied to all selected platforms"
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <NumericField
            id="min-followers"
            label="Min author followers"
            placeholder="e.g. 100"
            value={filters.min_author_followers}
            onChange={(v) => update({ min_author_followers: v })}
          />
          <NumericField
            id="min-engagement"
            label="Min engagement"
            placeholder="e.g. 50"
            value={filters.min_engagement}
            onChange={(v) => update({ min_engagement: v })}
          />
        </div>

        <SwitchRow
          label="Verified authors only"
          checked={filters.verified_only ?? false}
          onChange={(v) => update({ verified_only: v })}
        />

        <div className="space-y-1">
          <Label htmlFor="languages" className="text-xs">
            <Globe className="mr-1 inline h-3 w-3" />
            Languages (comma-separated)
          </Label>
          <Input
            id="languages"
            placeholder="e.g. en, fr"
            value={filters.languages?.join(", ") ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              const langs = val
                ? val.split(",").map((l) => l.trim()).filter(Boolean)
                : undefined;
              update({ languages: langs });
            }}
          />
        </div>
      </FilterGroup>

      {/* ----------------------------------------------------------------- */}
      {/* X (Twitter) filters                                               */}
      {/* ----------------------------------------------------------------- */}
      {hasTwitter && (
        <FilterGroup
          icon={<XIcon className="h-3.5 w-3.5" />}
          label="X (Twitter) Filters"
        >
          {/* Post types */}
          <div className="space-y-1.5">
            <Label className="text-xs">Post Types</Label>
            <div className="flex flex-wrap gap-1.5">
              {(["post", "reply", "retweet"] as const).map((type) => {
                const isSelected = filters.post_types?.includes(type);
                const labels = { post: "Original", reply: "Reply", retweet: "Retweet" };
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => togglePostType(type)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                      isSelected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {labels[type]}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground/60">
              No selection = all types included
            </p>
          </div>

          {/* Engagement thresholds */}
          <div className="grid gap-2 sm:grid-cols-2">
            <NumericField
              id="tw-min-likes"
              label="Min likes"
              placeholder="like_count"
              value={filters.min_like_count}
              onChange={(v) => update({ min_like_count: v })}
            />
            <NumericField
              id="tw-min-views"
              label="Min views"
              placeholder="view_count"
              value={filters.min_view_count}
              onChange={(v) => update({ min_view_count: v })}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <NumericField
              id="tw-min-replies"
              label="Min replies"
              placeholder="reply_count"
              value={filters.min_reply_count}
              onChange={(v) => update({ min_reply_count: v })}
            />
            <NumericField
              id="tw-min-quotes"
              label="Min quotes"
              placeholder="quote_count"
              value={filters.min_quote_count}
              onChange={(v) => update({ min_quote_count: v })}
            />
            <NumericField
              id="tw-min-retweets"
              label="Min retweets"
              placeholder="retweet_count"
              value={filters.min_retweet_count}
              onChange={(v) => update({ min_retweet_count: v })}
            />
          </div>
        </FilterGroup>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* TikTok filters                                                    */}
      {/* ----------------------------------------------------------------- */}
      {hasTiktok && (
        <FilterGroup
          icon={<TikTokIcon className="h-3.5 w-3.5" />}
          label="TikTok Filters"
        >
          {/* Exclusions */}
          <SwitchRow
            label="Exclude ads"
            description="Skip promoted content"
            checked={filters.exclude_ads ?? false}
            onChange={(v) => update({ exclude_ads: v })}
          />
          <SwitchRow
            label="Exclude private accounts"
            description="Can't comment on private profiles"
            checked={filters.exclude_private ?? false}
            onChange={(v) => update({ exclude_private: v })}
          />

          {/* Engagement thresholds */}
          <div className="grid gap-2 sm:grid-cols-2">
            <NumericField
              id="tt-min-plays"
              label="Min plays"
              placeholder="play_count"
              value={filters.min_play_count}
              onChange={(v) => update({ min_play_count: v })}
            />
            <NumericField
              id="tt-min-comments"
              label="Min comments"
              placeholder="comment_count"
              value={filters.min_comment_count}
              onChange={(v) => update({ min_comment_count: v })}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <NumericField
              id="tt-min-diggs"
              label="Min likes"
              placeholder="digg_count"
              value={filters.min_digg_count}
              onChange={(v) => update({ min_digg_count: v })}
            />
            <NumericField
              id="tt-min-shares"
              label="Min shares"
              placeholder="share_count"
              value={filters.min_share_count}
              onChange={(v) => update({ min_share_count: v })}
            />
            <NumericField
              id="tt-min-collects"
              label="Min saves"
              placeholder="collect_count"
              value={filters.min_collect_count}
              onChange={(v) => update({ min_collect_count: v })}
            />
          </div>
        </FilterGroup>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reusable sub-components (file-private)
// ---------------------------------------------------------------------------

function FilterGroup({
  icon,
  label,
  description,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <div>
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-muted">
            {icon}
          </div>
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground">
            {label}
          </p>
        </div>
        {description && (
          <p className="mt-0.5 pl-8 text-[10px] text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

function NumericField({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder?: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[11px]">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={0}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? parseInt(e.target.value) : undefined)}
        className="h-8 text-xs"
      />
    </div>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-2">
      <div>
        <span className="text-sm">{label}</span>
        {description && (
          <p className="text-[10px] text-muted-foreground">{description}</p>
        )}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
