"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BookOpen, Target, MessageSquare } from "lucide-react";
import type { StepProps } from "../types";

export function StepGuidelines({ data, onChange }: StepProps) {
  return (
    <div className="space-y-5 px-1">
      <div className="space-y-1">
        <p className="text-sm font-medium">Campaign Guidelines</p>
        <p className="text-xs text-muted-foreground">
          Define the context and strategy for AI responses
        </p>
      </div>

      {/* Operational Context */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <Label htmlFor="operational-context">Operational Context</Label>
        </div>
        <Textarea
          id="operational-context"
          placeholder="Describe the situation, background, and what the AI needs to know..."
          value={data.operational_context}
          onChange={(e) => onChange({ operational_context: e.target.value })}
          rows={4}
          className="resize-none"
        />
        <p className="text-[11px] text-muted-foreground">
          Background information the AI will use to understand the campaign
          context
        </p>
      </div>

      {/* Strategy */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-muted-foreground" />
          <Label htmlFor="strategy">Strategy</Label>
        </div>
        <Textarea
          id="strategy"
          placeholder="Define the objectives and behavioral rules for avatars..."
          value={data.strategy}
          onChange={(e) => onChange({ strategy: e.target.value })}
          rows={4}
          className="resize-none"
        />
        <p className="text-[11px] text-muted-foreground">
          Objectives, tone directives, and behavioral constraints for avatar
          responses
        </p>
      </div>

      {/* Key Messages */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <Label htmlFor="key-messages">Key Messages</Label>
        </div>
        <Textarea
          id="key-messages"
          placeholder="Specific phrases, hashtags, or terminology to use or avoid..."
          value={data.key_messages}
          onChange={(e) => onChange({ key_messages: e.target.value })}
          rows={4}
          className="resize-none"
        />
        <p className="text-[11px] text-muted-foreground">
          Hashtags to push, terms to avoid, specific talking points or
          vocabulary
        </p>
      </div>
    </div>
  );
}
