import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "@/components/OnboardingForm";

export const dynamic = "force-dynamic";

export default async function Onboarding() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profile")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profile) redirect("/");

  return <OnboardingForm email={user.email ?? ""} />;
}
