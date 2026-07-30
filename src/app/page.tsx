import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { ReservePage } from "@/components/ReservePage";
import { AnnouncementPopup } from "@/components/AnnouncementPopup";
import type { Seat } from "@/lib/types";

// 로그인 상태에 따라 갈리는 페이지라 정적으로 구우면 안 된다.
export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 프로필이 없으면 예약 자체가 DB에서 막힌다. 먼저 등록시킨다.
  const { data: profile } = await supabase
    .from("profile")
    .select("name, is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) redirect("/onboarding");

  const { data: seats } = await supabase
    .from("seat")
    .select("id, label, block, seat_row, seat_col, active")
    .order("id");

  return (
    <AppShell name={profile.name as string} isAdmin={profile.is_admin as boolean}>
      <ReservePage seats={(seats ?? []) as Seat[]} userId={user.id} />
      <AnnouncementPopup />
    </AppShell>
  );
}
