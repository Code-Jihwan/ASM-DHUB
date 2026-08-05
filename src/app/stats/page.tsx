import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { StatsPage } from "@/components/StatsPage";

export const dynamic = "force-dynamic";

/** 시설 이용 분석. 관리자만 볼 수 있다(RPC 안에서도 다시 검사한다). */
export default async function Stats() {
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
      <StatsPage />
    </AppShell>
  );
}
