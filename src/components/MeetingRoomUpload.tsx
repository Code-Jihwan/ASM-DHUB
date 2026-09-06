"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock, FileSpreadsheet, Trash2, Upload } from "lucide-react";
import { parseWorkbook } from "@/lib/meetingRooms";
import { clearSnapshot, saveSnapshot, useMeetingRoomSnapshot } from "@/lib/meetingRoomStore";

const CARD = "rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm md:p-6";

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}. ${p(d.getMonth() + 1)}. ${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 관리자 페이지 안의 '회의실 예약 현황' 업로드 칸.
 * 엑셀을 올리면 파싱해 서버(DB)에 저장하고, '회의실 현황' 메뉴가 그걸 읽어 표시한다.
 * 여러 관리자가 같은 데이터를 공유한다.
 */
export function MeetingRoomUpload() {
  const { snapshot, loading, refetch } = useMeetingRoomSnapshot();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const data = await parseWorkbook(file);
      await saveSnapshot(data);
      refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "파일을 올리는 중 문제가 생겼습니다.");
    } finally {
      setBusy(false);
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
    e.target.value = "";
  }

  async function onClear() {
    if (!window.confirm("올린 회의실 예약 현황을 지울까요? '회의실 현황' 화면이 모두에게 비워집니다.")) return;
    setBusy(true);
    setError(null);
    try {
      await clearSnapshot();
      refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "지우는 중 문제가 생겼습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={CARD}>
      <h2 className="mb-1 flex items-center gap-2 text-lg font-black tracking-tight text-neutral-900">
        <CalendarClock className="h-5 w-5 text-neutral-500" />
        회의실 예약 현황
      </h2>
      <p className="mb-4 text-[13px] font-medium text-neutral-500">
        회의실 예약 시스템에서 내려받은 엑셀(.xls / .xlsx)을 올리면 좌측{" "}
        <b className="font-bold text-neutral-700">회의실 현황</b> 메뉴에 반영됩니다. 취소 건은 자동으로
        빠지고, <b className="font-bold text-neutral-700">모든 관리자</b>가 같은 데이터를 봅니다.
      </p>

      {loading && !snapshot ? (
        <div className="h-24 animate-pulse rounded-2xl bg-neutral-100" />
      ) : snapshot ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-neutral-500 shadow-sm">
              <FileSpreadsheet className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-black text-neutral-900">{snapshot.data.fileName}</p>
              <p className="mt-0.5 text-[12px] font-bold text-neutral-500">
                {snapshot.data.dateLabel} · 예약완료 {snapshot.data.bookings.length}건
                {snapshot.data.cancelledCount > 0 && ` · 취소 ${snapshot.data.cancelledCount}건 제외`}
                {snapshot.data.skippedCount > 0 && ` · 형식오류 ${snapshot.data.skippedCount}건 제외`}
              </p>
              <p className="mt-0.5 text-[12px] font-medium text-neutral-400">
                {snapshot.uploadedByName ? `${snapshot.uploadedByName} · ` : ""}
                {fmtWhen(snapshot.uploadedAt)} 업로드
              </p>
              {snapshot.data.multiDate && (
                <p className="mt-0.5 text-[12px] font-bold text-amber-600">
                  여러 날짜가 섞여 있어요. 주 날짜({snapshot.data.dateLabel}) 기준으로 표시됩니다.
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/rooms"
              className="inline-flex items-center gap-1.5 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-black"
            >
              <CalendarClock className="h-4 w-4" />
              회의실 현황 열기
            </Link>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-200 px-4 py-2.5 text-sm font-bold text-neutral-600 transition-all hover:border-neutral-900 hover:text-neutral-900 disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              {busy ? "처리 중…" : "다시 올리기"}
            </button>
            <button
              type="button"
              onClick={onClear}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-200 px-4 py-2.5 text-sm font-bold text-neutral-500 transition-all hover:border-red-500 hover:text-red-600 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              지우기
            </button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFile(f);
          }}
          className={
            "flex flex-col items-center gap-3 rounded-2xl border border-dashed px-4 py-10 text-center transition-colors " +
            (dragOver ? "border-neutral-900 bg-neutral-50" : "border-neutral-300")
          }
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-500">
            <FileSpreadsheet className="h-6 w-6" />
          </span>
          <p className="text-sm font-bold text-neutral-600">
            예약 현황 엑셀을 여기로 끌어다 놓거나 아래 버튼으로 선택하세요.
          </p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-black disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {busy ? "처리 중…" : "엑셀 파일 선택"}
          </button>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600">
          {error}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={onInputChange}
        hidden
      />
    </section>
  );
}
