"use client";

import { useState } from "react";
import { Megaphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { humanizeDbError } from "@/lib/errors";
import type { Announcement } from "@/lib/types";
import { NoticeWindow } from "./AnnouncementPopup";

const CARD = "rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm md:p-6";
const FIELD =
  "w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm font-bold " +
  "text-neutral-900 outline-none transition-all placeholder:font-medium " +
  "placeholder:text-neutral-300 focus:border-neutral-900";

export function AnnouncementForm({ initial }: { initial: Announcement }) {
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [active, setActive] = useState(initial.active);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("announcement")
      .update({ title: title.trim(), body: body.trim(), active })
      .eq("id", 1);
    setSaving(false);
    if (error) {
      setError(humanizeDbError(error));
      return;
    }
    setNotice(
      active
        ? "저장했습니다. 사용자에게 팝업으로 표시됩니다."
        : "저장했습니다. (표시 꺼짐 상태라 팝업은 뜨지 않습니다.)",
    );
  }

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <header>
        <h1 className="flex items-center gap-2 text-[28px] font-black tracking-tighter text-neutral-900">
          <Megaphone className="h-6 w-6 text-neutral-400" />
          팝업 공지
        </h1>
        <p className="mt-1 text-sm font-bold text-neutral-500">
          사용자가 로그인 후 좌석 예약 화면에 들어오면 이 공지가 팝업으로 뜹니다.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3.5 text-sm font-bold text-red-700"
        >
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3.5 text-sm font-bold text-emerald-700">
          {notice}
        </div>
      )}

      <div className="grid gap-5 md:gap-6 lg:grid-cols-2">
        {/* 작성 */}
        <section className={CARD}>
          <div className="flex flex-col gap-4">
            <label className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 p-4">
              <span className="min-w-0">
                <span className="block text-sm font-black text-neutral-900">팝업 표시</span>
                <span className="block text-[13px] font-medium text-neutral-500">
                  켜면 사용자에게 즉시 노출됩니다.
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={active}
                onClick={() => setActive((v) => !v)}
                className={
                  "relative h-7 w-12 shrink-0 rounded-full transition-colors " +
                  (active ? "bg-emerald-600" : "bg-neutral-300")
                }
              >
                <span
                  className={
                    "absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all " +
                    (active ? "left-6" : "left-1")
                  }
                />
              </button>
            </label>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="title" className="text-xs font-bold text-neutral-500">
                제목
              </label>
              <input
                id="title"
                value={title}
                maxLength={100}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="예: 8/5(월) 시스템 점검 안내"
                className={FIELD}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="body" className="text-xs font-bold text-neutral-500">
                내용
              </label>
              <textarea
                id="body"
                value={body}
                maxLength={2000}
                onChange={(e) => setBody(e.target.value)}
                rows={7}
                placeholder="공지 내용을 입력하세요. 줄바꿈은 그대로 표시됩니다."
                className={`${FIELD} resize-y font-medium leading-relaxed`}
              />
              <span className="self-end text-[11px] font-bold text-neutral-300 tabular-nums">
                {body.length}/2000
              </span>
            </div>

            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-xl bg-neutral-900 py-4 text-sm font-bold text-white transition-all hover:bg-black active:scale-[0.98] disabled:opacity-50"
            >
              {saving ? "저장 중…" : "저장"}
            </button>
            <p className="text-[12px] font-medium leading-relaxed text-neutral-400">
              내용을 저장하면(수정 포함) 이미 공지를 본 사용자에게도 다시 한 번 뜹니다. 닫은
              사용자에게는 다음 수정 전까지 다시 뜨지 않습니다.
            </p>
          </div>
        </section>

        {/* 미리보기 */}
        <section className={CARD}>
          <h2 className="mb-4 text-sm font-black tracking-wider text-neutral-400">미리보기</h2>
          <div className="flex items-center justify-center rounded-2xl border border-neutral-100 bg-neutral-100 p-6">
            <NoticeWindow title={title} body={body} />
          </div>
        </section>
      </div>
    </div>
  );
}
