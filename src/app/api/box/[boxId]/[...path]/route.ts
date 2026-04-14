import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getCfHeaders } from "@/lib/box-api";

async function proxyRequest(
  req: NextRequest,
  { params }: { params: Promise<{ boxId: string; path: string[] }> }
) {
  await requireAdmin();

  const { boxId, path } = await params;

  const supabase = await createClient();
  const { data: box, error } = await supabase
    .from("boxes")
    .select("tunnel_hostname")
    .eq("id", boxId)
    .single();

  if (error || !box) {
    return NextResponse.json({ error: "Box not found" }, { status: 404 });
  }

  const target = `https://${box.tunnel_hostname}/${path.join("/")}`;
  const headers = new Headers();
  Object.entries(getCfHeaders()).forEach(([k, v]) => headers.set(k, v));

  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const body =
    req.method !== "GET" && req.method !== "HEAD"
      ? await req.arrayBuffer()
      : undefined;

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body,
  });

  const responseHeaders = new Headers();
  const ct = upstream.headers.get("content-type");
  if (ct) responseHeaders.set("content-type", ct);
  responseHeaders.set("cache-control", "no-store");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const DELETE = proxyRequest;
