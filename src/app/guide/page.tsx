import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { GuidePage } from "@/components/GuidePage";

export const dynamic = "force-dynamic";

export default async function Guide() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profile")
    .select("name, is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) redirect("/onboarding");

  return (
    <AppShell
      name={profile.name as string}
      isAdmin={profile.is_admin as boolean}
      variant="scroll"
    >
      <GuidePage />
    </AppShell>
  );
}
