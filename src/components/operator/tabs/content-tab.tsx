"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Upload,
  Trash2,
  Loader2,
  Video,
  Image as ImageIcon,
  Smartphone,
  Check,
  FileVideo,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  getContentItems,
  createContentItem,
  deleteContentItem,
  pushContentToDevice,
} from "@/app/actions/content";
import type { AvatarWithRelations, ContentItem } from "@/types";

interface ContentTabProps {
  avatar: AvatarWithRelations;
}

export function ContentTab({ avatar }: ContentTabProps) {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadCount, setUploadCount] = useState(0);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadItems = useCallback(async () => {
    try {
      const data = await getContentItems(avatar.id);
      setItems(data);
    } catch {
      toast.error("Failed to load content");
    } finally {
      setLoading(false);
    }
  }, [avatar.id]);

  useEffect(() => {
    setLoading(true);
    loadItems();
  }, [loadItems]);

  const uploading = uploadCount > 0;

  const uploadFile = useCallback(
    async (file: File) => {
      setUploadCount((c) => c + 1);
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("accountId", avatar.account_id);

        const res = await fetch("/api/content/upload", {
          method: "POST",
          body: formData,
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Upload failed");

        const { data, error } = await createContentItem({
          accountId: avatar.account_id,
          avatarId: avatar.id,
          fileName: json.fileName,
          fileType: json.fileType,
          fileSize: json.fileSize,
          mimeType: json.mimeType,
          storagePath: json.storagePath,
        });

        if (error) throw new Error(error);
        if (data) {
          setItems((prev) => [data, ...prev]);
          toast.success("File uploaded");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploadCount((c) => c - 1);
      }
    },
    [avatar.account_id, avatar.id]
  );

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArr = Array.from(files);
      if (fileArr.length === 0) return;
      for (const file of fileArr) {
        uploadFile(file);
      }
    },
    [uploadFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleDelete = useCallback(async (id: string) => {
    const prev = items;
    setItems((current) => current.filter((i) => i.id !== id));
    const { error } = await deleteContentItem(id);
    if (error) {
      toast.error(error);
      setItems(prev);
    } else {
      toast.success("File deleted");
    }
  }, [items]);

  const handlePush = useCallback(
    async (contentId: string) => {
      if (!avatar.device_id) {
        toast.error("No device assigned to this avatar");
        return;
      }
      setPushingId(contentId);
      const { error } = await pushContentToDevice(contentId, avatar.device_id);
      if (error) {
        toast.error(error);
      } else {
        setItems((prev) =>
          prev.map((i) =>
            i.id === contentId
              ? {
                  ...i,
                  status: "pushed" as const,
                  pushed_to_device_id: avatar.device_id,
                  pushed_at: new Date().toISOString(),
                }
              : i
          )
        );
        toast.success("Pushed to device");
      }
      setPushingId(null);
    },
    [avatar.device_id]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">Content Library</h3>
        <span className="text-[11px] tabular-nums text-muted-foreground/60">
          {items.length} file{items.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Drop zone */}
      <div
        className={cn(
          "group relative flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed py-10 transition-colors",
          dragActive
            ? "border-primary/50 bg-primary/5"
            : "border-muted-foreground/15 bg-muted/10 hover:border-primary/30 hover:bg-primary/3"
        )}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept="video/*,image/*"
          multiple
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {uploading ? (
          <Loader2 className="h-6 w-6 animate-spin text-primary/60" />
        ) : (
          <div className="rounded-full bg-muted p-2.5 transition-colors group-hover:bg-primary/10">
            <Upload className="h-5 w-5 text-muted-foreground/40 transition-colors group-hover:text-primary/60" />
          </div>
        )}
        <div className="text-center">
          <p className="text-[12px] font-medium text-muted-foreground">
            {uploading ? "Uploading..." : "Drop videos or images here"}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground/50">
            MP4, MOV, WebM, JPEG, PNG — up to 100 MB
          </p>
        </div>
      </div>

      {/* Content grid */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40" />
        </div>
      ) : items.length > 0 ? (
        <div className="space-y-1.5">
          {items.map((item) => (
            <ContentRow
              key={item.id}
              item={item}
              hasDevice={!!avatar.device_id}
              pushing={pushingId === item.id}
              onPush={() => handlePush(item.id)}
              onDelete={() => handleDelete(item.id)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1.5 py-6 text-center">
          <FileVideo className="h-5 w-5 text-muted-foreground/15" />
          <p className="text-[11px] text-muted-foreground/40">
            No content yet
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content row
// ---------------------------------------------------------------------------

function ContentRow({
  item,
  hasDevice,
  pushing,
  onPush,
  onDelete,
}: {
  item: ContentItem;
  hasDevice: boolean;
  pushing: boolean;
  onPush: () => void;
  onDelete: () => void;
}) {
  const isVideo = item.file_type === "video";
  const isPushed = item.status === "pushed";
  const sizeLabel = formatFileSize(item.file_size);

  return (
    <div className="group flex items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 transition-colors hover:border-border hover:bg-muted/30">
      {/* Icon */}
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
          isVideo ? "bg-violet-500/10" : "bg-blue-500/10"
        )}
      >
        {isVideo ? (
          <Video className="h-3.5 w-3.5 text-violet-500/70" />
        ) : (
          <ImageIcon className="h-3.5 w-3.5 text-blue-500/70" />
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium leading-tight">
          {item.file_name}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] text-muted-foreground/50">
            {sizeLabel}
          </span>
          {isPushed && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-500/70">
              <Check className="h-2.5 w-2.5" />
              pushed
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {hasDevice && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            disabled={pushing}
            onClick={(e) => {
              e.stopPropagation();
              onPush();
            }}
            title="Push to device"
          >
            {pushing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Smartphone className="h-3 w-3" />
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
