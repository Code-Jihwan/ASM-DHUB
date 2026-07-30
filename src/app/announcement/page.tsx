import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { AnnouncementForm } from "@/components/AnnouncementForm";
import type { Announcement } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AnnouncementAdmin() {
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

  const { data: ann } = await supabase
    .from("announcement")
    .select("id, title, body, active, updated_at")
    .eq("id", 1)
    .maybeSingle();

  const initial: Announcement =
    (ann as Announcement) ?? { id: 1, title: "", body: "", active: false, updated_at: "" };

  return (
    <AppShell name={profile.name as string} isAdmin variant="scroll">
      <AnnouncementForm initial={initial} />
    </AppShell>
  );
}
