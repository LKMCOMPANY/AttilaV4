"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type FieldVariant = "input" | "textarea";

interface AutoSaveFieldProps {
  value: string;
  onSave: (value: string) => Promise<{ error: string | null }>;
  placeholder?: string;
  variant?: FieldVariant;
  className?: string;
  disabled?: boolean;
  maxLength?: number;
}

type SaveStatus = "idle" | "saving" | "saved";

export function AutoSaveField({
  value: initialValue,
  onSave,
  placeholder,
  variant = "input",
  className,
  disabled,
  maxLength,
}: AutoSaveFieldProps) {
  const [localValue, setLocalValue] = useState(initialValue);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [, startTransition] = useTransition();
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(initialValue);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const handleBlur = useCallback(() => {
    const trimmed = localValue.trim();
    if (trimmed === lastSavedRef.current) return;

    setStatus("saving");
    startTransition(async () => {
      const result = await onSave(trimmed);
      if (result.error) {
        toast.error(result.error);
        setStatus("idle");
        return;
      }

      lastSavedRef.current = trimmed;
      setStatus("saved");

      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setStatus("idle"), 1500);
    });
  }, [localValue, onSave, startTransition]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && variant === "input") {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    }
  };

  // Composed once, up front. Reading it back off `sharedProps` in the JSX would
  // make the compiler treat that object — which also carries handlers closing
  // over refs — as read during render (`react-hooks/refs`). `pr-8` reserves room
  // for the status glyph and applies to both variants.
  const fieldClassName = cn(
    "border-transparent bg-transparent transition-colors",
    "hover:border-border focus:border-border focus:bg-card",
    className,
    "pr-8"
  );

  const sharedProps = {
    value: localValue,
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => setLocalValue(e.target.value),
    onBlur: handleBlur,
    onKeyDown: handleKeyDown,
    placeholder,
    disabled,
    maxLength,
    className: fieldClassName,
  };

  return (
    <div className="relative">
      {variant === "textarea" ? (
        <Textarea {...sharedProps} rows={2} />
      ) : (
        <Input {...sharedProps} />
      )}
      <div
        className={cn(
          "pointer-events-none absolute right-2",
          variant === "textarea"
            ? "top-2"
            : "top-1/2 -translate-y-1/2"
        )}
      >
        {status === "saving" && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
        {status === "saved" && (
          <Check className="h-3.5 w-3.5 text-success animate-in" />
        )}
      </div>
    </div>
  );
}
