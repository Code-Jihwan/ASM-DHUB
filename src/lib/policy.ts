/**
 * 예약 정책. supabase/migrations 의 policy 스키마와 짝을 이룬다.
 * 여기 값을 바꾸면 SQL 쪽도 함께 바꿔야 한다. 최종 판정은 항상 DB가 한다.
 *
 * 예약 모델: "센터에 와서 지금부터 몇 분" 을 고른다. 시작은 늘 현재 분(초 버림),
 * 이용 시간은 10분 단위로 최대 maxBaseHours 까지. 절대 시각을 고르는 방식이 아니다.
 *
 * 개발 편의: .env.local 에 NEXT_PUBLIC_DEV_HOURS_24=1 을 두면 운영 시간이 00~24시로
 * 열려 밤에도 예약을 테스트할 수 있다. 단, DB 쪽 policy.open_time/close_time 도 함께
 * 열어야 실제로 삽입된다(supabase/dev/dev_hours.sql). 운영 배포 때는 이 플래그를 뺀다.
 */
const DEV_HOURS_24 = process.env.NEXT_PUBLIC_DEV_HOURS_24 === "1";

// 실제 운영 시간(08~20). 사용자 안내 문구는 dev 설정과 무관하게 이 값을 쓴다.
const REAL_OPEN = 8;
const REAL_CLOSE = 20;

export const POLICY = {
  maxBaseHours: 3,
  maxExtendHours: 3,
  extendWindowHours: 1,
  bookAheadHours: 12,
  slotMinutes: 10, // 이용 시간 단위(분). DB policy.duration_unit()(600초)와 짝을 이룬다.
  // 실제 예약 가능 시간. dev 플래그가 있으면 밤 테스트를 위해 00~24로 열린다.
  openHour: DEV_HOURS_24 ? 0 : REAL_OPEN,
  closeHour: DEV_HOURS_24 ? 24 : REAL_CLOSE,
  // 화면에 표기하는 운영 시간(항상 08~20). "예약 08–20시" 안내에 쓴다.
  displayOpenHour: REAL_OPEN,
  displayCloseHour: REAL_CLOSE,
  // 오픈 직전 이 시간 안(예: 07:30~08:00)에 오면 시작 시각을 오픈(08:00)으로 당겨 예약을 받는다.
  earlyGraceMinutes: 30,
  awayLimitMinutes: 20, // 자리비움 후 이 시간 안에 복귀하지 않으면 예약이 자동 취소된다.
  awayMaxCount: 2, // 한 예약에서 자리비움을 쓸 수 있는 최대 횟수. DB policy.away_max_count()와 짝.
  cooldownMinutes: 20, // 예약 종료 후 이 시간 동안은 그 자리를 다시 예약 불가. DB policy.cooldown()과 짝.
  // 취소를 두 가지로 가르는 경계(분). 이 시간 안에 그만두면 '예약 취소'(안 쓴 셈이라 쿨다운
  // 유예), 이 시간 이상 쓰고 그만두면 '좌석 반납'(정상 이용 + 쿨다운). DB policy.cancel_grace()와 짝.
  cancelGraceMinutes: 10,
} as const;

/**
 * 이용 시간 빠른 선택 버튼(분). 운영 종료·정책 상한을 넘는 값은 화면에서 걸러 낸다.
 * 상한(maxBaseHours=3h)까지 버튼 하나로 닿을 수 있게 30분·1·2·3시간으로 둔다.
 * 1시간 30분처럼 중간 값은 아래 10분 스테퍼로 맞춘다.
 */
export const DURATION_PRESETS = [30, 60, 120, 180] as const;

export const TZ = "Asia/Seoul";

const MS = { min: 60_000, hour: 3_600_000 } as const;
const OPEN_MIN = POLICY.openHour * 60;
const CLOSE_MIN = POLICY.closeHour * 60;

/** 자정 기준 경과 분(KST). 브라우저 시간대와 무관하게 한국 시각으로 판단한다. */
export function kstMinutes(d: Date): number {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const h = Number(p.find((x) => x.type === "hour")!.value);
  const m = Number(p.find((x) => x.type === "minute")!.value);
  return h * 60 + m;
}

export function addHours(d: Date, h: number): Date {
  return new Date(d.getTime() + h * MS.hour);
}

export function addMinutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * MS.min);
}

/** 초를 버리고 분 단위로 내린 시각. 예약 시작은 늘 "지금 이 분"이다. */
export function floorMinute(d: Date): Date {
  return new Date(Math.floor(d.getTime() / MS.min) * MS.min);
}

/** start부터 운영 종료(closeHour)까지 남은 분 */
function minutesUntilClose(start: Date): number {
  return CLOSE_MIN - kstMinutes(start);
}

/** 10분 단위로 내린 값 */
function floorUnit(minutes: number): number {
  return Math.max(0, Math.floor(minutes / POLICY.slotMinutes) * POLICY.slotMinutes);
}

/** 지금이 예약 가능한 운영 시간(open~close) 안인가. 밖이면 예약을 받지 않는다. */
export function withinBookingHours(now: Date): boolean {
  const m = kstMinutes(now);
  return m >= OPEN_MIN && m < CLOSE_MIN;
}

/**
 * 지금 예약을 걸 때의 시작 시각.
 *  - 운영 시간(08~20) 안: 지금 이 분.
 *  - 오픈 직전 유예(07:30~08:00): 오픈 시각(08:00)으로 당겨 준다.
 *  - 그 외(너무 이른 새벽 / 마감 후): null → 예약 불가.
 */
export function bookingStart(now: Date): Date | null {
  const m = kstMinutes(now);
  if (m >= OPEN_MIN && m < CLOSE_MIN) return floorMinute(now);
  if (m >= OPEN_MIN - POLICY.earlyGraceMinutes && m < OPEN_MIN) {
    return addMinutes(floorMinute(now), OPEN_MIN - m); // 오늘 08:00 정각
  }
  return null;
}

/**
 * start(=지금)에 대해 예약 가능한 최대 이용 시간(분).
 * 운영 시간 밖이면 0(예약 불가). 안이면 정책 상한과 마감까지 남은 시간 중 작은 값을 10분 단위로 내린다.
 */
export function maxDurationMinutes(start: Date): number {
  if (!withinBookingHours(start)) return 0;
  return floorUnit(Math.min(POLICY.maxBaseHours * 60, minutesUntilClose(start)));
}

/** 10분 단위 이용 시간 선택지(분). 드롭다운에 쓴다. */
export function durationChoices(start: Date): number[] {
  const max = maxDurationMinutes(start);
  const out: number[] = [];
  for (let m = POLICY.slotMinutes; m <= max; m += POLICY.slotMinutes) out.push(m);
  return out;
}

/** 연장으로 더 늘릴 수 있는 시간(분) 선택지. 최대 maxExtend, 운영 종료까지. */
export function extendChoices(currentEnd: Date): number[] {
  const max = floorUnit(Math.min(POLICY.maxExtendHours * 60, minutesUntilClose(currentEnd)));
  const out: number[] = [];
  for (let m = POLICY.slotMinutes; m <= max; m += POLICY.slotMinutes) out.push(m);
  return out;
}

export function inExtendWindow(end: Date, now: Date): boolean {
  return now >= addHours(end, -POLICY.extendWindowHours) && now < end;
}

/** 자리비움 경과 분 */
export function awayMinutes(awaySince: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - awaySince.getTime()) / MS.min));
}

/**
 * 그만둔 예약이 '좌석 반납'인가(=충분히 쓰고 반납). 아니면 '예약 취소'(=짧게 그만둠).
 * releasedAt은 취소 시각(취소 이력) 또는 지금(카드에서 누르기 직전).
 * 경계는 cancelGraceMinutes로, DB 쿨다운 유예선과 정확히 같다.
 */
export function isSeatReturn(start: Date, releasedAt: Date): boolean {
  return releasedAt.getTime() - start.getTime() >= POLICY.cancelGraceMinutes * MS.min;
}

/** PostgreSQL tstzrange 리터럴 */
export function toRange(start: Date, end: Date): string {
  return `[${start.toISOString()},${end.toISOString()})`;
}

/** tstzrange 문자열을 파싱한다. 예: ["2026-07-17 09:00:00+00","2026-07-17 11:00:00+00") */
export function parseRange(raw: string): { start: Date; end: Date } {
  const inner = raw.slice(1, -1);
  const [a, b] = inner.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
  return { start: new Date(a), end: new Date(b) };
}

export function fmtTime(d: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  }).format(d);
}

export function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  }).format(d);
}

export function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: TZ,
  }).format(d);
}

export function fmtHours(h: number): string {
  if (Number.isInteger(h)) return `${h}시간`;
  const whole = Math.floor(h);
  return whole === 0 ? "30분" : `${whole}시간 30분`;
}

/** 분을 "1시간 30분" 꼴로. 이용 시간 표기에 쓴다. */
export function fmtMinutes(m: number): string {
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}시간` : `${h}시간 ${rest}분`;
}
