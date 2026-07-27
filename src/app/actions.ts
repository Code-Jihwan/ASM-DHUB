"use server";

import { createClient } from "@/lib/supabase/server";
import { humanizeDbError } from "@/lib/errors";
import { isCenterRequest } from "@/lib/net";

const WIFI_MSG = "센터 와이파이에 연결한 뒤 다시 시도해 주세요.";

/**
 * 예약 생성. 센터 와이파이(공인 IP)에서 온 요청만 통과시킨다.
 * 브라우저에서 직접 Supabase로 넣지 않고 이 서버 액션을 거치므로, 클라이언트를 우회해도
 * IP 검사를 건너뛸 수 없다. 세션·RLS는 서버 클라이언트가 그대로 적용한다.
 */
export async function bookSeat(seatId: number, period: string): Promise<{ error?: string }> {
  const { allowed } = await isCenterRequest();
  if (!allowed) return { error: WIFI_MSG };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const { error } = await supabase
    .from("reservation")
    .insert({ seat_id: seatId, user_id: user.id, period });
  return error ? { error: humanizeDbError(error) } : {};
}

/** 자리 변경: 이용 시간은 그대로 두고 자리만 옮긴다. 역시 센터 와이파이에서만. */
export async function changeSeat(oldId: string, seatId: number): Promise<{ error?: string }> {
  const { allowed } = await isCenterRequest();
  if (!allowed) return { error: WIFI_MSG };

  const supabase = await createClient();
  const { error } = await supabase.rpc("change_reservation", {
    p_old_id: oldId,
    p_seat_id: seatId,
  });
  return error ? { error: humanizeDbError(error) } : {};
}
