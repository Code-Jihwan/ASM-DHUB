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
