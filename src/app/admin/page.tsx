import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { AdminPage } from "@/components/AdminPage";
import type { Seat } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Admin() {
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
  if (!profile.is_admin) redirect("/");

  const { data: seats } = await supabase
    .from("seat")
    .select("id, label, block, seat_row, seat_col, active")
    .order("id");

  return (
    <AppShell name={profile.name as string} isAdmin variant="scroll">
      <AdminPage seats={(seats ?? []) as Seat[]} userId={user.id} />
    </AppShell>
  );
}
