"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { SocialIcon } from "@/components/icons/social-icons";
import {
  buildAuthorSuggestions,
  type AuthorSuggestion,
  type PlatformFilter,
} from "./post-filters";
import type { CampaignPlatform, CampaignPost } from "@/types";

// ---------------------------------------------------------------------------
// Platform filter — segmented buttons
// ---------------------------------------------------------------------------

const PLATFORM_LABELS: Record<CampaignPlatform, string> = {
  twitter: "X",
  tiktok: "TikTok",
};

interface PlatformOption {
  value: PlatformFilter;
  label: string;
  platform?: CampaignPlatform;
}

function buildPlatformOptions(
  available: readonly CampaignPlatform[],
): PlatformOption[] {
  if (available.length <= 1) return [];
  return [
    { value: "all", label: "All" },
    ...available.map<PlatformOption>((p) => ({
      value: p,
      label: PLATFORM_LABELS[p] ?? p,
      platform: p,
    })),
  ];
}

// ---------------------------------------------------------------------------
// PipelineToolbar — public component
// ---------------------------------------------------------------------------

interface PipelineToolbarProps {
  posts: CampaignPost[];
  searchQuery: string;
  onSearchChange: (value: string) => void;
  platformFilter: PlatformFilter;
  onPlatformFilterChange: (value: PlatformFilter) => void;
  availablePlatforms: readonly CampaignPlatform[];
}

export function PipelineToolbar({
  posts,
  searchQuery,
  onSearchChange,
  platformFilter,
  onPlatformFilterChange,
  availablePlatforms,
}: PipelineToolbarProps) {
  const platformOptions = useMemo(
    () => buildPlatformOptions(availablePlatforms),
    [availablePlatforms],
  );

  const suggestions = useMemo(
    () => buildAuthorSuggestions(posts, searchQuery, platformFilter),
    [posts, searchQuery, platformFilter],
  );

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
      {platformOptions.length > 0 && (
        <div
          role="toolbar"
          aria-label="Filter by platform"
          className="flex shrink-0 gap-0.5"
        >
          {platformOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onPlatformFilterChange(opt.value)}
              aria-pressed={platformFilter === opt.value}
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                platformFilter === opt.value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {opt.platform && (
                <SocialIcon platform={opt.platform} className="h-2.5 w-2.5" />
              )}
              {opt.label}
            </button>
          ))}
        </div>
      )}

      <SearchAutocomplete
        value={searchQuery}
        onChange={onSearchChange}
        suggestions={suggestions}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SearchAutocomplete — input + suggestions dropdown
// ---------------------------------------------------------------------------

interface SearchAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: AuthorSuggestion[];
}

function SearchAutocomplete({
  value,
  onChange,
  suggestions,
}: SearchAutocompleteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();

  const hasValue = value.length > 0;
  const showDropdown = focused && hasValue && suggestions.length > 0;

  // React 19 idiom — reset the highlighted suggestion when the list itself
  // changes, by tracking the previous reference in state instead of an effect.
  const [trackedSuggestions, setTrackedSuggestions] = useState(suggestions);
  if (trackedSuggestions !== suggestions) {
    setTrackedSuggestions(suggestions);
    setActiveIndex(-1);
  }

  // Outside-click closes the dropdown without losing the value (covers
  // pointer interactions; keyboard tab-out is handled by `onBlur` below).
  useEffect(() => {
    if (!focused) return;
    const handler = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [focused]);

  /**
   * Closes the dropdown when focus leaves the input via keyboard (Tab) or
   * programmatic blur. Ignored when focus moves to an element inside our
   * own container (e.g., a suggestion button being clicked) so we don't
   * close before the click handler fires.
   */
  const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && containerRef.current?.contains(next)) return;
    setFocused(false);
  };

  const commit = (suggestion: AuthorSuggestion) => {
    onChange(`@${suggestion.author}`);
    setFocused(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (hasValue) {
        event.preventDefault();
        onChange("");
        return;
      }
      setFocused(false);
      return;
    }
    if (!showDropdown) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => (prev + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) =>
        prev <= 0 ? suggestions.length - 1 : prev - 1,
      );
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      commit(suggestions[activeIndex]);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative ml-auto flex min-w-0 flex-1 items-center"
    >
      <Search
        aria-hidden
        className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground"
      />
      <Input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-controls={showDropdown ? listboxId : undefined}
        aria-activedescendant={
          showDropdown && activeIndex >= 0
            ? `${listboxId}-${activeIndex}`
            : undefined
        }
        aria-label="Search posts and responses"
        autoComplete="off"
        spellCheck={false}
        placeholder="Search authors, text, responses…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={cn(
          "h-7 rounded-md pl-7 text-[11px]",
          hasValue ? "pr-7" : "pr-2",
          // Hide native search clear button (we render our own)
          "[&::-webkit-search-cancel-button]:appearance-none",
        )}
      />
      {hasValue && (
        <button
          type="button"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
          className="absolute right-1 inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      )}

      {showDropdown && (
        <SuggestionList
          id={listboxId}
          suggestions={suggestions}
          activeIndex={activeIndex}
          onPick={commit}
          onHover={setActiveIndex}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SuggestionList — absolutely positioned dropdown anchored to the input
// ---------------------------------------------------------------------------

interface SuggestionListProps {
  id: string;
  suggestions: AuthorSuggestion[];
  activeIndex: number;
  onPick: (suggestion: AuthorSuggestion) => void;
  onHover: (index: number) => void;
}

function SuggestionList({
  id,
  suggestions,
  activeIndex,
  onPick,
  onHover,
}: SuggestionListProps) {
  return (
    <ul
      id={id}
      role="listbox"
      className={cn(
        "absolute left-0 right-0 top-full z-[var(--z-popover)] mt-1 max-h-60 overflow-y-auto",
        "rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10",
      )}
    >
      {suggestions.map((suggestion, index) => (
        <li
          key={`${suggestion.platform}:${suggestion.author}`}
          id={`${id}-${index}`}
          role="option"
          aria-selected={index === activeIndex}
        >
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(suggestion);
            }}
            onMouseEnter={() => onHover(index)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] transition-colors",
              index === activeIndex
                ? "bg-accent text-accent-foreground"
                : "hover:bg-muted",
            )}
          >
            <SocialIcon
              platform={suggestion.platform}
              className="h-2.5 w-2.5 shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 flex-1 truncate font-medium">
              @{suggestion.author}
            </span>
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
              {suggestion.count} post{suggestion.count !== 1 ? "s" : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
