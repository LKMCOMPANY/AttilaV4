import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginDialog } from "@/components/auth/login-dialog";

export default async function HomePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (data?.claims) {
    const userId = data.claims.sub;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();

    if (profile) {
      redirect(profile.role === "admin" ? "/admin" : "/dashboard");
    }

    await supabase.auth.signOut();
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-black">
      <header className="absolute top-0 right-0 z-10 p-6">
        <LoginDialog />
      </header>

      <main className="flex flex-1 items-center justify-center">
        <h1 className="select-none text-6xl font-bold tracking-[0.3em] text-white sm:text-7xl md:text-8xl lg:text-9xl">
          ATTILA
        </h1>
      </main>
    </div>
  );
}
