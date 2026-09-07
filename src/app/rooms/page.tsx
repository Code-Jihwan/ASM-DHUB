import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { MeetingRoomStatusPage } from "@/components/MeetingRoomStatusPage";

export const dynamic = "force-dynamic";

/** 회의실 예약 현황 조회. 로그인한 모든 사용자가 볼 수 있다(조회 전용). 업로드/삭제는 관리자 페이지에서. */
export default async function Rooms() {
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

  const isAdmin = !!profile.is_admin;
  return (
    <AppShell name={profile.name as string} isAdmin={isAdmin} variant="scroll">
      <MeetingRoomStatusPage isAdmin={isAdmin} />
    </AppShell>
  );
}
