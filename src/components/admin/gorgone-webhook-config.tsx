"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, KeyRound, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  inspectWebhookConfig,
  pushWebhookConfigToGorgone,
} from "@/app/actions/gorgone";
import { toast } from "sonner";

/**
 * Tiny status row that surfaces the current webhook config stored in
 * Gorgone's `integration_config` and lets the admin push Attila's env
 * (URL + secret) to it. Used for first-time wiring and secret rotation.
 */
export function GorgoneWebhookConfig({
  expectedUrlSuffix = "/api/gorgone/webhook",
}: {
  expectedUrlSuffix?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [hasSecret, setHasSecret] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPushing, startPush] = useTransition();

  const refresh = useCallback(async () => {
    try {
      const config = await inspectWebhookConfig();
      setUrl(config.url);
      setHasSecret(Boolean(config.secret));
    } catch {
      setUrl(null);
      setHasSecret(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function handlePush() {
    startPush(async () => {
      const result = await pushWebhookConfigToGorgone();
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Webhook config pushed to Gorgone");
      }
      refresh();
    });
  }

  const urlMatches = url ? url.endsWith(expectedUrlSuffix) : false;
  const isHealthy = urlMatches && hasSecret === true;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Checking webhook config...
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2">
      {isHealthy ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <KeyRound className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs font-medium">Webhook config</span>
          <span className="text-[10px] text-muted-foreground">
            {isHealthy ? "Synced with Gorgone" : "Out of sync"}
          </span>
        </div>
        <p className="truncate text-[10px] text-muted-foreground/70">
          {url ?? "Not configured"}
          {hasSecret === false && " · No secret set"}
        </p>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 text-xs text-muted-foreground"
        onClick={handlePush}
        disabled={isPushing}
      >
        {isPushing && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        {isHealthy ? "Re-push" : "Push config"}
      </Button>
    </div>
  );
}
