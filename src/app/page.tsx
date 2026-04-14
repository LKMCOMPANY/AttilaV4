import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginDialog } from "@/components/auth/login-dialog";
import { AttilaLogo } from "@/components/icons/attila-logo";

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
      redirect(profile.role === "admin" ? "/admin/accounts" : "/dashboard");
    }

    await supabase.auth.signOut();
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-black">
      <header className="absolute top-0 right-0 z-10 p-6">
        <LoginDialog />
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-6">
        <AttilaLogo className="h-20 w-20 text-white/80 sm:h-24 sm:w-24 md:h-28 md:w-28" />
        <h1 className="select-none text-6xl font-bold tracking-[0.3em] text-white sm:text-7xl md:text-8xl lg:text-9xl">
          ATTILA
        </h1>
      </main>
    </div>
  );
}
