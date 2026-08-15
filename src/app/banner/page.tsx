import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { BannerForm } from "@/components/BannerForm";
import type { Banner } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BannerAdmin() {
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

  const { data: b } = await supabase
    .from("banner")
    .select("image_url, link_url, alt, active")
    .eq("id", 1)
    .maybeSingle();

  const initial: Banner =
    (b as Banner) ?? { image_url: null, link_url: null, alt: "", active: false };

  return (
    <AppShell name={profile.name as string} isAdmin variant="scroll">
      <BannerForm initial={initial} />
    </AppShell>
  );
}
