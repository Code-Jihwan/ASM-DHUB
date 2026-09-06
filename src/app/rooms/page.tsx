import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { MeetingRoomStatusPage } from "@/components/MeetingRoomStatusPage";

export const dynamic = "force-dynamic";

/** 회의실 예약 현황 조회. 관리자만 볼 수 있다(엑셀 업로드 → 화면 표시, 저장 없음). */
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
  if (!profile.is_admin) redirect("/");

  return (
    <AppShell name={profile.name as string} isAdmin variant="scroll">
      <MeetingRoomStatusPage />
    </AppShell>
  );
}
