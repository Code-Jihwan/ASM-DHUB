"use server";

import { createClient } from "@/lib/supabase/server";
import { humanizeDbError } from "@/lib/errors";
import { isCenterRequest } from "@/lib/net";

/**
 * 센터 와이파이가 아니라고 판정됐을 때의 안내.
 * 감지된 IP를 함께 알려 준다. 센터 안인데도 막히는 경우 이 값을 관리자에게 전달하면
 * 원인(센터의 다른 회선 IP인지, VPN·릴레이인지)을 바로 가릴 수 있다.
 */
function wifiMsg(ip: string, unknown: boolean, action: string): string {
  if (unknown) return `네트워크 확인에 실패해 ${action}할 수 없습니다. 잠시 후 다시 시도해 주세요.`;
  return `센터 와이파이에 연결한 뒤 ${action}할 수 있습니다. (감지된 IP: ${ip || "확인 불가"})`;
}

/**
 * 예약 생성. 센터 와이파이(공인 IP)에서 온 요청만 통과시킨다.
 * 브라우저에서 직접 Supabase로 넣지 않고 이 서버 액션을 거치므로, 클라이언트를 우회해도
 * IP 검사를 건너뛸 수 없다. 세션·RLS는 서버 클라이언트가 그대로 적용한다.
 */
export async function bookSeat(seatId: number, period: string): Promise<{ error?: string }> {
  const { allowed, ip, unknown } = await isCenterRequest();
  if (!allowed) return { error: wifiMsg(ip, unknown, "예약") };

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

/**
 * 자리비움 표시/복귀. 복귀("복귀했어요")는 센터에 실제로 있어야 인정하므로 IP를 검사한다.
 * (센터 밖에서 복귀를 눌러 자동 취소를 회피하는 것을 막는다.)
 * 자리비움 표시(away=true)는 자리를 떠나는 것이라 어디서나 허용한다.
 */
export async function setAwayAction(id: string, away: boolean): Promise<{ error?: string }> {
  if (!away) {
    const { allowed, ip, unknown } = await isCenterRequest();
    if (!allowed) return { error: wifiMsg(ip, unknown, "복귀 처리") };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_away", { p_id: id, p_away: away });
  return error ? { error: humanizeDbError(error) } : {};
}

/** 자리 변경: 이용 시간은 그대로 두고 자리만 옮긴다. 역시 센터 와이파이에서만. */
export async function changeSeat(oldId: string, seatId: number): Promise<{ error?: string }> {
  const { allowed, ip, unknown } = await isCenterRequest();
  if (!allowed) return { error: wifiMsg(ip, unknown, "자리 이동") };

  const supabase = await createClient();
  const { error } = await supabase.rpc("change_reservation", {
    p_old_id: oldId,
    p_seat_id: seatId,
  });
  return error ? { error: humanizeDbError(error) } : {};
}
