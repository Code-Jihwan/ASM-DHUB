export type Profile = {
  user_id: string;
  name: string;
  team: string;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
};

export type Seat = {
  id: number;
  label: string;
  /** 창가(1)에서 출입문(3) 쪽으로 가는 블록 번호 */
  block: number;
  /** 블록 안에서 앞줄(1) / 뒷줄(2). 두 줄은 등을 맞대고 있다. */
  seat_row: number;
  /** 줄 안에서 1~8. 3석 / 2석 / 3석 그룹으로 나뉘고 그 사이가 통로다. */
  seat_col: number;
  active: boolean;
};

export type Reservation = {
  id: string;
  seat_id: number;
  user_id: string;
  period: string; // tstzrange
  extended: boolean;
  status: "active" | "cancelled";
  away_since: string | null;
  away_count: number; // 이 예약에서 자리비움을 누른 횟수(복귀는 세지 않음). DB away_count와 짝.
  cancelled_at: string | null;
  created_at: string;
};

/** seat_occupancy 뷰. 남의 예약도 이름까지는 보인다. 연락처와 팀은 나오지 않는다. */
export type Occupancy = {
  seat_id: number;
  reservation_id: string;
  user_id: string;
  period: string;
  extended: boolean;
  away_since: string | null;
  reserver_name: string;
};

/** 좌석도에 그릴 한 좌석의 상태 */
export type SeatView = Seat & {
  busy: boolean;
  mine: boolean;
  reserverName: string | null;
  awaySince: Date | null;
};

/** 로그인 후 예약 화면에 뜨는 팝업 공지(단일 행, id=1) */
export type Announcement = {
  id: number;
  title: string;
  body: string;
  active: boolean;
  updated_at: string;
};

/**
 * admin_stats(p_days) 반환값. 시설 이용 분석 화면이 쓴다.
 * 값이 null인 것은 "그 기간에 계산할 데이터가 없다"는 뜻이다(0과 구분한다).
 */
export type StatsBucket = { bucket: string; cnt: number };
export type StatsOutcome = { kind: string; cnt: number };
export type StatsHour = { h: number; avg: number; today: number | null };
export type StatsSeat = { id: number; label: string; pct: number };

export type StatsPeriod = {
  /** 하루 예약 건수 */
  count: number | null;
  /** 실제 점유 30분 미만이라 평균에서 빠진 건수 */
  short: number | null;
  /** 인당 평균 이용 시간(분). 30분 이상인 건만 센다. */
  minutes: number | null;
  /** 좌석 이용률(%) */
  util: number | null;
};

export type Stats = {
  /** 비교 기준 시각("HH:MM"). 당일도 평균도 이 시각까지만 센다. */
  cutoff: string;
  /** 평균을 낸 날 수(이용이 있었던 날, 당일 제외) */
  days: number;
  seats: number;
  today: StatsPeriod;
  avg: StatsPeriod;
  hourly: StatsHour[];
  seats_pct: StatsSeat[];
  duration: StatsBucket[];
  outcome: StatsOutcome[];
};

/** admin_seat_history 반환 행 */
export type SeatHistoryRow = {
  reservation_id: string;
  period: string;
  extended: boolean;
  status: "active" | "cancelled";
  away_since: string | null;
  name: string | null;
  team: string | null;
  created_at: string;
};
