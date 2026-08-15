"use client";

import { useMemo, useState } from "react";
import { Images, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { humanizeDbError } from "@/lib/errors";
import type { Banner } from "@/lib/types";

const CARD = "rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm md:p-6";
const FIELD =
  "w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm font-bold " +
  "text-neutral-900 outline-none transition-all placeholder:font-medium " +
  "placeholder:text-neutral-300 focus:border-neutral-900";

const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const OK_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export function BannerForm({ initial }: { initial: Banner }) {
  const supabase = useMemo(() => createClient(), []);
  const [imageUrl, setImageUrl] = useState(initial.image_url);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(initial.image_url);
  const [linkUrl, setLinkUrl] = useState(initial.link_url ?? "");
  const [alt, setAlt] = useState(initial.alt);
  const [active, setActive] = useState(initial.active);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function pick(f: File | null) {
    setError(null);
    setNotice(null);
    if (!f) return;
    if (!OK_TYPES.includes(f.type)) {
      setError("PNG · JPG · WEBP · GIF 이미지만 올릴 수 있습니다.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError("이미지는 2MB 이하만 올릴 수 있습니다.");
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      let url = imageUrl;

      // 새 이미지를 골랐으면 먼저 Storage에 올리고 공개 URL을 얻는다.
      if (file) {
        const ext = (file.name.split(".").pop() || "png").toLowerCase();
        const path = `sidebar-${Date.now()}.${ext}`;
        const up = await supabase.storage
          .from("banners")
          .upload(path, file, { cacheControl: "3600", upsert: false });
        if (up.error) {
          setError(`이미지 업로드 실패: ${up.error.message}`);
          setBusy(false);
          return;
        }
        url = supabase.storage.from("banners").getPublicUrl(path).data.publicUrl;
      }

      const { error: dbErr } = await supabase
        .from("banner")
        .update({
          image_url: url,
          link_url: linkUrl.trim() || null,
          alt: alt.trim(),
          active,
        })
        .eq("id", 1);

      if (dbErr) {
        setError(humanizeDbError(dbErr));
        setBusy(false);
        return;
      }

      setImageUrl(url);
      setFile(null);
      setBusy(false);
      setNotice(
        active
          ? url
            ? "저장했습니다. 사이드바에 노출됩니다."
            : "저장했지만 이미지가 없어 노출되지 않습니다. 이미지를 올려 주세요."
          : "저장했습니다. (표시 꺼짐 상태라 배너는 노출되지 않습니다.)",
      );
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.");
    }
  }

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <header>
        <h1 className="flex items-center gap-2 text-[28px] font-black tracking-tighter text-neutral-900">
          <Images className="h-6 w-6 text-neutral-400" />
          광고 배너
        </h1>
        <p className="mt-1 text-sm font-bold text-neutral-500">
          PC 사이드바 하단에 노출되는 배너입니다. 이미지 · 링크를 등록하고 표시를 켜세요.
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
                <span className="block text-sm font-black text-neutral-900">배너 표시</span>
                <span className="block text-[13px] font-medium text-neutral-500">
                  켜면 사이드바에 즉시 노출됩니다.
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

            {/* 이미지 업로드 */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-neutral-500">이미지</span>
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-8 text-center transition-colors hover:border-neutral-900">
                <Upload className="h-6 w-6 text-neutral-400" />
                <span className="text-sm font-bold text-neutral-700">
                  {file ? file.name : "이미지 선택"}
                </span>
                <span className="text-[12px] font-medium text-neutral-400">
                  PNG · JPG · WEBP · GIF · 2MB 이하 · 4:5 권장(400×500)
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => pick(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="link" className="text-xs font-bold text-neutral-500">
                링크 URL <span className="font-medium text-neutral-400">(선택)</span>
              </label>
              <input
                id="link"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://example.com"
                inputMode="url"
                className={FIELD}
              />
              <span className="text-[11px] font-medium text-neutral-400">
                입력하면 배너 클릭 시 새 탭으로 열립니다. 비우면 클릭해도 이동하지 않습니다.
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="alt" className="text-xs font-bold text-neutral-500">
                대체 텍스트 <span className="font-medium text-neutral-400">(선택)</span>
              </label>
              <input
                id="alt"
                value={alt}
                maxLength={200}
                onChange={(e) => setAlt(e.target.value)}
                placeholder="예: OO 해커톤 참가 모집"
                className={FIELD}
              />
            </div>

            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded-xl bg-neutral-900 py-4 text-sm font-bold text-white transition-all hover:bg-black active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? "저장 중…" : "저장"}
            </button>
          </div>
        </section>

        {/* 미리보기 */}
        <section className={CARD}>
          <h2 className="mb-4 text-sm font-black tracking-wider text-neutral-400">
            미리보기 (사이드바)
          </h2>
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-neutral-100 bg-neutral-50 p-6">
            <div className="w-[200px]">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview}
                  alt={alt || "광고"}
                  className="aspect-[4/5] w-full rounded-2xl border border-neutral-200 object-cover"
                />
              ) : (
                <div className="flex aspect-[4/5] w-full items-center justify-center rounded-2xl border border-dashed border-neutral-300 text-[12px] font-bold text-neutral-400">
                  이미지 없음
                </div>
              )}
            </div>
            <p className="text-[12px] font-bold text-neutral-500">
              {active ? "표시 켜짐" : "표시 꺼짐"}
              {linkUrl.trim() ? " · 클릭 시 링크 열림" : ""}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
