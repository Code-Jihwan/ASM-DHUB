/**
 * DB가 던진 오류를 사용자 문장으로 바꾼다.
 * 트리거가 raise한 메시지는 이미 한국어라 그대로 쓰고,
 * 제약 위반은 PostgreSQL이 만든 문장이라(로케일도 제각각) 이름으로 판별한다.
 */
export function humanizeDbError(err: unknown): string {
  const msg =
    typeof err === "object" && err && "message" in err ? String(err.message) : String(err);

  if (msg.includes("reservation_no_overlap")) {
    return "방금 다른 분이 먼저 예약했습니다. 좌석을 다시 골라 주세요.";
  }
  if (msg.includes("reservation_bounded")) {
    return "예약 가능한 시간을 넘었습니다.";
  }
  if (msg.includes("reservation_positive")) {
    return "종료 시각이 시작 시각보다 빠릅니다.";
  }
  // 트리거/함수가 raise한 한국어 메시지
  return msg || "알 수 없는 오류가 발생했습니다.";
}
