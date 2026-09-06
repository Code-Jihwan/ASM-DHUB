"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { humanizeDbError } from "@/lib/errors";
import type { ParseResult } from "./meetingRooms";

// 회의실 예약 현황을 서버(DB)에 저장/조회한다. 여러 관리자가 공유하는 단일 스냅샷.
// 저장/삭제는 관리자만(서버의 security-definer 함수가 강제). 읽기는 정책이 허용하는 범위.

export type Snapshot = {
  data: ParseResult;
  uploadedAt: string;
  uploadedByName: string | null;
};

type SnapshotRow = {
  data: ParseResult;
  uploaded_at: string;
  uploaded_by_name: string | null;
};

/** 파싱 결과를 서버에 저장(업서트). 관리자만 가능. */
export async function saveSnapshot(data: ParseResult): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("save_meeting_room_snapshot", { p_data: data });
  if (error) throw new Error(humanizeDbError(error));
}

/** 서버의 스냅샷 삭제. 관리자만 가능. */
export async function clearSnapshot(): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("clear_meeting_room_snapshot");
  if (error) throw new Error(humanizeDbError(error));
}

/**
 * 서버 스냅샷을 구독한다. 마운트 시 1회 조회 + realtime 변경 시 재조회 + 창 포커스 시 재조회.
 * 반환: { snapshot, loading, refetch }.
 */
export function useMeetingRoomSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const refetchRef = useRef<() => void>(() => {});

  useEffect(() => {
    const supabase = createClient();
    let alive = true;
    let seq = 0; // 최신 응답만 반영(순서 뒤바뀐 재조회 응답 무시)

    const fetchIt = async () => {
      const mySeq = ++seq;
      const { data, error } = await supabase
        .from("meeting_room_snapshot")
        .select("data, uploaded_at, uploaded_by_name")
        .eq("id", 1)
        .maybeSingle<SnapshotRow>();
      if (!alive || mySeq !== seq) return; // 언마운트 / 구식 응답 무시
      setLoading(false);
      if (error) return; // 일시적 실패(포커스·오프라인 등)면 이미 보이는 데이터를 유지
      const valid =
        !!data &&
        !!data.data &&
        Array.isArray(data.data.bookings) &&
        Array.isArray(data.data.rooms);
      setSnapshot(
        valid
          ? { data: data.data, uploadedAt: data.uploaded_at, uploadedByName: data.uploaded_by_name }
          : null,
      );
    };
    refetchRef.current = () => void fetchIt();
    void fetchIt();

    const uid =
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const channel = supabase
      .channel(`meeting-room-snapshot-${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "meeting_room_snapshot" },
        () => void fetchIt(),
      )
      .subscribe();

    const onFocus = () => void fetchIt();
    window.addEventListener("focus", onFocus);

    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      supabase.removeChannel(channel);
    };
  }, []);

  return { snapshot, loading, refetch: () => refetchRef.current() };
}
