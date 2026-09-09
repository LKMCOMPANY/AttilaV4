"use client";

import { useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { CalendarClock, ChevronDown, ChevronRight, Image as ImageIcon, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskStatusBadge } from "@/components/shared/maintenance-badge";
import { TASK_KIND_LABEL } from "@/lib/presentation/maintenance";
import { cn } from "@/lib/utils";
import { Section } from "./device-info";
import { ProofDialog } from "./proof-dialog";
import type { MaintenanceStep, MaintenanceTask } from "@/types";

/**
 * The maintainer's tasks for this avatar, newest first: what is planned,
 * what ran, and — unfolded — the step journal with its proofs. A scheduled
 * or running task can be cancelled; the runner stops at its next step.
 */
export function MaintenanceTaskList({ tasks, onCancel }: { tasks: MaintenanceTask[]; onCancel: (taskId: string) => Promise<void> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [proofPath, setProofPath] = useState<string | null>(null);

  return (
    <Section title="Sessions and checks" icon={CalendarClock}>
      {tasks.length === 0 && (
        <p className="py-1.5 text-[11px] text-muted-foreground">
          Nothing planned yet — the schedule fills the day once maintenance is on and the layer is enabled.
        </p>
      )}
      {tasks.map((task) => {
        const open = openId === task.id;
        const cancellable = task.status === "scheduled" || task.status === "running";
        return (
          <div key={task.id} className="py-1.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : task.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                aria-expanded={open}
              >
                {open ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                <span className="text-[11px] font-medium">{TASK_KIND_LABEL[task.kind]}</span>
                {task.platform && <span className="text-[10px] text-muted-foreground">{task.platform === "twitter" ? "X" : "TikTok"}</span>}
                <TaskStatusBadge status={task.status} />
                {task.outcome && task.status !== "scheduled" && (
                  <span className="truncate font-mono text-[10px] text-muted-foreground">{task.outcome}</span>
                )}
              </button>
              <span className="shrink-0 text-[10px] text-muted-foreground" title={format(new Date(task.scheduled_for), "PPpp")}>
                {task.status === "scheduled"
                  ? `in ${formatDistanceToNow(new Date(task.scheduled_for))}`
                  : formatDistanceToNow(new Date(task.finished_at ?? task.started_at ?? task.scheduled_for), { addSuffix: true })}
              </span>
              {cancellable && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                  title="Cancel"
                  onClick={() => void onCancel(task.id)}
                >
                  <XCircle className="h-3 w-3" />
                </Button>
              )}
            </div>
            {open && <StepJournal task={task} onProof={setProofPath} />}
          </div>
        );
      })}
      <ProofDialog path={proofPath} onClose={() => setProofPath(null)} />
    </Section>
  );
}

function StepJournal({ task, onProof }: { task: MaintenanceTask; onProof: (path: string) => void }) {
  const steps = task.steps ?? [];
  return (
    <div className="mt-1.5 ml-4 space-y-1 border-l pl-2.5">
      {task.error_message && (
        <p className="text-[10px] text-destructive">
          {task.error_category && <span className="font-mono">[{task.error_category}] </span>}
          {task.error_message}
        </p>
      )}
      {steps.length === 0 && <p className="text-[10px] text-muted-foreground">No step recorded.</p>}
      {steps.map((step, index) => (
        <StepRow key={`${step.at}-${index}`} step={step} onProof={onProof} />
      ))}
      {task.params.minutes !== undefined && (
        <p className="text-[10px] text-muted-foreground">Planned length: {String(task.params.minutes)} min</p>
      )}
    </div>
  );
}

function StepRow({ step, onProof }: { step: MaintenanceStep; onProof: (path: string) => void }) {
  return (
    <div className="flex items-start gap-2 text-[10px]">
      <span
        className={cn(
          "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
          step.outcome === "ok" ? "bg-success" : step.outcome === "failed" ? "bg-destructive" : "bg-muted-foreground/40",
        )}
      />
      <div className="min-w-0 flex-1">
        <span className="font-medium">{step.name}</span>
        {step.screen_state && <span className="ml-1.5 font-mono text-muted-foreground">{step.screen_state}</span>}
        <span className="ml-1.5 text-muted-foreground">{(step.duration_ms / 1000).toFixed(1)} s</span>
        {step.detail && <p className="truncate text-muted-foreground">{step.detail}</p>}
      </div>
      {step.proof_path && (
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground"
          onClick={() => onProof(step.proof_path!)}
          title="View the screenshot"
        >
          <ImageIcon className="h-3 w-3" /> proof
        </button>
      )}
    </div>
  );
}
