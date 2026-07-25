import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { MyPage } from "@/components/MyPage";
import type { Seat } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Me() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profile")
    .select("name, team, is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) redirect("/onboarding");

  // 예약 이력에 좌석 번호를 붙이고, 신고 다이얼로그의 좌석 선택에도 쓴다.
  const { data: seats } = await supabase
    .from("seat")
    .select("id, label, block, seat_row, seat_col, active")
    .order("id");

  return (
    <AppShell
      name={profile.name as string}
      isAdmin={profile.is_admin as boolean}
      variant="scroll"
    >
      <MyPage
        seats={(seats ?? []) as Seat[]}
        userId={user.id}
        name={profile.name as string}
        team={profile.team as string}
        email={user.email ?? ""}
      />
    </AppShell>
  );
}
