import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

const ALLOWED_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const accountId = formData.get("accountId") as string | null;

    if (!file || !accountId) {
      return NextResponse.json(
        { error: "Missing file or accountId" },
        { status: 400 }
      );
    }

    if (
      session.profile.role !== "admin" &&
      accountId !== session.profile.account_id
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `File type "${file.type}" not allowed` },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File exceeds 100MB limit" },
        { status: 400 }
      );
    }

    const timestamp = Date.now();
    const safeName = file.name
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_{2,}/g, "_");
    const storagePath = `${accountId}/${timestamp}_${safeName}`;

    const supabase = await createClient();
    const { error: uploadError } = await supabase.storage
      .from("content")
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: uploadError.message },
        { status: 500 }
      );
    }

    const fileType = file.type.startsWith("video/") ? "video" : "image";

    return NextResponse.json({
      storagePath,
      fileName: file.name,
      fileType,
      fileSize: file.size,
      mimeType: file.type,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status = message.includes("Forbidden")
      ? 403
      : message.includes("Unauthorized")
        ? 401
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
