"use client";

import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Globe, Search } from "lucide-react";
import {
  COUNTRIES,
  REGION_LABELS,
  getCountriesGroupedByRegion,
  getDefaultLanguageForCountry,
} from "@/lib/data/countries";
import { getLanguagesForSelect, getLanguageName } from "@/lib/data/languages";
import type { StepProps } from "../types";

export function StepCountry({ data, onChange }: StepProps) {
  const [search, setSearch] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const grouped = useMemo(() => getCountriesGroupedByRegion(), []);
  const languages = useMemo(() => getLanguagesForSelect(), []);

  const filteredCountries = useMemo(() => {
    if (!search.trim()) return COUNTRIES;
    const q = search.toLowerCase();
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q)
    );
  }, [search]);

  const selectedCountry = COUNTRIES.find((c) => c.code === data.country_code);

  // Scroll to selected country on mount
  useEffect(() => {
    if (selectedRef.current && listRef.current) {
      selectedRef.current.scrollIntoView({ block: "center", behavior: "instant" });
    }
  }, []);

  const handleCountrySelect = (code: string) => {
    const lang = getDefaultLanguageForCountry(code);
    onChange({
      country_code: code,
      language_code: data.language_code || lang,
    });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <h3 className="text-heading-3">Country & Language</h3>
        <p className="text-body-sm text-muted-foreground">
          Select the country and primary language for this avatar.
        </p>
      </div>

      {/* Country */}
      <div className="space-y-2">
        <Label className="text-label">Country</Label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search countries..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            autoComplete="off"
          />
        </div>

        <div
          ref={listRef}
          className="max-h-[260px] overflow-y-auto rounded-lg border scrollbar-thin"
        >
          {search.trim() ? (
            <div className="p-1">
              {filteredCountries.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No countries match "{search}"
                </p>
              ) : (
                filteredCountries.map((c) => (
                  <CountryRow
                    key={c.code}
                    ref={data.country_code === c.code ? selectedRef : undefined}
                    code={c.code}
                    name={c.name}
                    selected={data.country_code === c.code}
                    onSelect={handleCountrySelect}
                  />
                ))
              )}
            </div>
          ) : (
            Object.entries(grouped).map(([region, countries]) => (
              <div key={region}>
                <div className="sticky top-0 z-10 bg-muted/80 px-3 py-1.5 backdrop-blur-sm">
                  <span className="text-caption">
                    {REGION_LABELS[region as keyof typeof REGION_LABELS]}
                  </span>
                </div>
                <div className="p-1">
                  {countries.map((c) => (
                    <CountryRow
                      key={c.code}
                      ref={data.country_code === c.code ? selectedRef : undefined}
                      code={c.code}
                      name={c.name}
                      selected={data.country_code === c.code}
                      onSelect={handleCountrySelect}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {selectedCountry && (
          <div className="flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2 ring-1 ring-primary/10">
            <Globe className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">{selectedCountry.name}</span>
            <Badge variant="secondary" className="ml-auto text-xs">
              {selectedCountry.code}
            </Badge>
          </div>
        )}
      </div>

      {/* Language */}
      <div className="space-y-2">
        <Label className="text-label">Language</Label>
        <Select
          value={data.language_code}
          onValueChange={(v) => { if (v) onChange({ language_code: v }); }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a language" />
          </SelectTrigger>
          <SelectContent className="max-h-[240px]">
            {languages.map((l) => (
              <SelectItem key={l.code} value={l.code}>
                <span>{l.name}</span>
                <span className="ml-2 text-muted-foreground">{l.nativeName}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {data.language_code && (
          <p className="text-xs text-muted-foreground">
            Selected: {getLanguageName(data.language_code)}
          </p>
        )}
      </div>
    </div>
  );
}

const CountryRow = forwardRef<
  HTMLButtonElement,
  {
    code: string;
    name: string;
    selected: boolean;
    onSelect: (code: string) => void;
  }
>(function CountryRow({ code, name, selected, onSelect }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onSelect(code)}
      className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
        selected
          ? "bg-primary/10 text-primary font-medium"
          : "hover:bg-muted"
      }`}
    >
      <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">{code}</span>
      <span className="flex-1 truncate">{name}</span>
      {selected && <div className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
    </button>
  );
});
