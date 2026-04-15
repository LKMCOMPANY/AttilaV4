import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client for the Gorgone project (read-only access).
 * Uses service_role to bypass RLS on Gorgone's side.
 * NEVER import this in client components.
 */
export function createGorgoneClient() {
  const url = process.env.GORGONE_SUPABASE_URL;
  const key = process.env.GORGONE_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing GORGONE_SUPABASE_URL or GORGONE_SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
