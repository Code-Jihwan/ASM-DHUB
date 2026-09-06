import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { AnnouncementForm } from "@/components/AnnouncementForm";
import { BannerForm } from "@/components/BannerForm";
import type { Announcement, Banner } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 팝업/배너 공지(통합). 위: 팝업 공지, 아래: 배너 공지. 둘 다 관리자만. */
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
  const annInitial: Announcement =
    (ann as Announcement) ?? { id: 1, title: "", body: "", active: false, updated_at: "" };

  const { data: b } = await supabase
    .from("banner")
    .select("image_url, link_url, alt, active")
    .eq("id", 1)
    .maybeSingle();
  const bannerInitial: Banner =
    (b as Banner) ?? { image_url: null, link_url: null, alt: "", active: false };

  return (
    <AppShell name={profile.name as string} isAdmin variant="scroll">
      <div className="flex flex-col gap-10">
        <AnnouncementForm initial={annInitial} />
        <BannerForm initial={bannerInitial} />
      </div>
    </AppShell>
  );
}
