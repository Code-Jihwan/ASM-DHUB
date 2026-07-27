"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { humanizeDbError } from "@/lib/errors";

type Props = { email: string };

const FIELD =
  "w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm font-bold " +
  "text-neutral-900 outline-none transition-all placeholder:font-medium " +
  "placeholder:text-neutral-300 focus:border-neutral-900 focus:shadow-sm";

const LABEL = "text-xs font-bold text-neutral-500";

export function OnboardingForm({ email }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !team.trim()) return;

    setBusy(true);
    setError(null);

    const supabase = createClient();
    // 명단(roster) 대조 후 프로필 생성. 명단에 없거나 이미 사용된 항목이면 거부된다.
    const { error } = await supabase.rpc("register_profile", {
      p_name: name.trim(),
      p_team: team.trim(),
    });

    if (error) {
      setBusy(false);
      setError(humanizeDbError(error));
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-[380px] rounded-3xl border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-[26px] font-black leading-tight tracking-tighter text-neutral-900">
          처음 오셨네요
        </h1>
        <p className="mt-1.5 text-sm font-bold text-neutral-500">
          좌석 예약에 필요한 정보를 한 번만 등록합니다.
        </p>
        <p className="mt-3 text-xs font-bold text-neutral-400">{email}</p>

        <form onSubmit={submit} className="mt-7 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className={LABEL}>
              이름
            </label>
            <input
              id="name"
              required
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="홍길동"
              autoComplete="name"
              className={FIELD}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="team" className={LABEL}>
              팀명
            </label>
            <input
              id="team"
              required
              maxLength={40}
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              placeholder="소마 1팀"
              className={FIELD}
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="mt-2 rounded-xl bg-neutral-900 py-4 text-sm font-bold text-white transition-all hover:bg-black hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? "등록 중…" : "등록하고 시작하기"}
          </button>

          {error && (
            <p role="alert" className="text-sm font-bold text-red-600">
              {error}
            </p>
          )}
        </form>

        <p className="mt-6 text-xs font-medium leading-relaxed text-neutral-400">
          이름과 팀은 좌석에 누가 앉아 있는지 보여주는 데 씁니다.
        </p>
      </div>
    </main>
  );
}
