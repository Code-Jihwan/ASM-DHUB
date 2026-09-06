"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Upload } from "lucide-react";
import {
  ACCENT,
  DE,
  DS,
  SPAN,
  STEP,
  dur,
  hm,
  pct,
  type Booking,
  type RoomDef,
} from "@/lib/meetingRooms";
import { useMeetingRoomSnapshot } from "@/lib/meetingRoomStore";

/**
 * 회의실 예약 현황 (관리자 전용, 조회 전용).
 * 관리자 페이지에서 올린 엑셀을 서버(DB)에서 읽어, 18F 회의실 7개의 하루 일정을
 * 배치도·타임라인으로 보여준다. 업로드/삭제는 관리자 페이지에서 한다(여기선 표시만).
 *
 * 디자인: design_handoff_meeting_room_status (Wanted 토큰). 축은 09~24시.
 */
export function MeetingRoomStatusPage() {
  const { snapshot, loading } = useMeetingRoomSnapshot();
  const data = snapshot?.data ?? null;
  const [selId, setSelId] = useState<string>("");
  const [hover, setHover] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // 현재 시각 20초마다 갱신(오늘 데이터일 때만 실제로 쓰임)
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 20000);
    return () => clearInterval(t);
  }, []);

  // ── 불러오는 중 ──
  if (loading && !data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18, color: "#171719" }}>
        <PageHeader chips={null} />
        <div style={{ height: 260, background: "#FFFFFF", border: "1px solid #E8E9EB", borderRadius: 16 }} />
      </div>
    );
  }

  // ── 비어 있으면 안내 ──
  if (!data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18, color: "#171719" }}>
        <PageHeader chips={null} />
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid #E8E9EB",
            borderRadius: 16,
            padding: "56px 28px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "#EAF2FF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CalendarClock size={26} color={ACCENT} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" }}>
              아직 올라온 회의실 예약 현황이 없어요
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#6B6E76", lineHeight: 1.6 }}>
              관리자 페이지의 <b style={{ color: "#46474C" }}>회의실 예약 현황</b> 칸에서 엑셀을 올리면
              <br />
              여기에 오늘 일정이 표시됩니다.
            </div>
          </div>
          <Link
            href="/admin"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: ACCENT,
              color: "#FFFFFF",
              borderRadius: 10,
              padding: "12px 20px",
              fontSize: 14,
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            <Upload size={16} />
            관리자 페이지에서 올리기
          </Link>
        </div>
      </div>
    );
  }

  // ── 파생 상태 ──
  const now = new Date(nowMs);
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  const isToday = data.dateStr === todayStr;
  const clock = now.getHours() + now.getMinutes() / 60;

  const bookingsOf = (roomId: string) =>
    data.bookings.filter((b) => b.roomId === roomId).sort((a, b) => a.start - b.start);
  const isLive = (b: Booking) => isToday && clock >= b.start && clock < b.end;
  const isPast = (b: Booking) => isToday && clock >= b.end;
  const inUseRoom = (roomId: string) => bookingsOf(roomId).some(isLive);

  const firstWithBooking = data.rooms.find((r) => data.bookings.some((b) => b.roomId === r.id))?.id;
  const selEff =
    selId && data.rooms.some((r) => r.id === selId)
      ? selId
      : (firstWithBooking ?? data.rooms[0]?.id ?? "");
  const sel = data.rooms.find((r) => r.id === selEff) ?? data.rooms[0];
  const selBookings = bookingsOf(sel.id);
  const totalConfirmed = data.bookings.length;

  const select = (id: string) => setSelId(id);
  const onKeyActivate = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select(id);
    }
  };

  const chips = (
    <>
      <Chip>18F 회의실</Chip>
      <Chip tabular>{data.dateLabel}</Chip>
      {isToday ? (
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#FFFFFF",
            background: ACCENT,
            borderRadius: 8,
            padding: "8px 12px",
            letterSpacing: "0.06em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {hm(Math.floor(clock) + Math.round((clock - Math.floor(clock)) * 60) / 60)} 기준
        </div>
      ) : (
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#8E9199",
            background: "#F1F2F3",
            borderRadius: 8,
            padding: "8px 12px",
            letterSpacing: "0.02em",
          }}
        >
          다른 날짜 데이터
        </div>
      )}
    </>
  );

  const freeCount = isToday
    ? `${data.rooms.filter((r) => !inUseRoom(r.id)).length}개 이용 가능`
    : `예약 ${totalConfirmed}건`;
  const freeCountColor = isToday ? "#00A939" : "#6B6E76";

  const cur = isToday ? selBookings.find((b) => clock >= b.start && clock < b.end) : undefined;
  const next = isToday ? selBookings.find((b) => b.start > clock) : undefined;
  let headline: string;
  let headSub: string;
  if (!isToday) {
    headline = selBookings.length ? `예약 ${selBookings.length}건` : "예약 없음";
    headSub = selBookings.length ? `${data.monthDay} 기준` : "이 날 등록된 일정이 없습니다";
  } else if (cur) {
    headline = "이용 중";
    headSub = `${hm(cur.end)} 종료 · ${cur.title}`;
  } else if (next) {
    headline = `${dur(Math.max(0, next.start - Math.max(clock, DS)))} 이용 가능`;
    headSub = `다음 일정 ${hm(next.start)}`;
  } else {
    headline = "종일 이용 가능";
    headSub = "남은 일정 없음";
  }

  const statusText = isToday ? (cur ? "이용 중" : "이용 가능") : `${selBookings.length}건`;
  const statusColor = isToday ? (cur ? "#FF6B4F" : "#00A939") : "#171719";
  const nextText = isToday
    ? next
      ? hm(next.start)
      : "없음"
    : selBookings.length
      ? hm(selBookings[0].start)
      : "-";

  // 우측 상세는 칸이 넓으니 눈금 라벨은 매시간(09~24), 격자선만 STEP(3시간) 간격으로.
  const axisLabels: number[] = [];
  for (let h = DS; h <= DE; h += 1) axisLabels.push(h);
  const gridLines: number[] = [];
  for (let h = DS; h <= DE; h += STEP) gridLines.push(h);
  const axisMid = Math.round((DS + DE) / 2);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, color: "#171719" }}>
      <PageHeader chips={chips} />

      <div style={{ display: "flex", gap: 18, alignItems: "stretch", flexWrap: "wrap" }}>
        {/* 좌측 패널 */}
        <div
          style={{
            flex: "0 1 356px",
            minWidth: 300,
            background: "#FFFFFF",
            border: "1px solid #E8E9EB",
            borderRadius: 16,
            padding: 18,
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em" }}>회의실</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: freeCountColor }}>{freeCount}</div>
          </div>

          {/* 18F 배치도 */}
          <div
            style={{
              background: "#F7F8FA",
              borderRadius: 12,
              padding: 12,
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              gap: 9,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#46474C", letterSpacing: "0.14em" }}>
                18F LAYOUT
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#6B6E76" }}>{sel.id} 위치</div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "66px minmax(0, 1fr)",
                gridTemplateRows: "34px minmax(0, 1fr)",
                gap: 6,
              }}
            >
              <div style={{ gridArea: "1 / 1 / 3 / 2", display: "flex", flexDirection: "column", gap: 5 }}>
                {data.rooms
                  .filter((r) => r.row === "col")
                  .map((r) => (
                    <MapTile
                      key={r.id}
                      room={r}
                      on={r.id === sel.id}
                      inUse={inUseRoom(r.id)}
                      hovered={hover === `tile:${r.id}`}
                      onHover={(v) => setHover(v ? `tile:${r.id}` : null)}
                      onSelect={() => select(r.id)}
                      onKeyActivate={onKeyActivate(r.id)}
                    />
                  ))}
              </div>
              <div
                style={{
                  gridArea: "1 / 2 / 2 / 3",
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 5,
                }}
              >
                {data.rooms
                  .filter((r) => r.row === "top")
                  .map((r) => (
                    <MapTile
                      key={r.id}
                      room={r}
                      on={r.id === sel.id}
                      inUse={inUseRoom(r.id)}
                      hovered={hover === `tile:${r.id}`}
                      onHover={(v) => setHover(v ? `tile:${r.id}` : null)}
                      onSelect={() => select(r.id)}
                      onKeyActivate={onKeyActivate(r.id)}
                    />
                  ))}
              </div>
              <div
                style={{
                  gridArea: "2 / 2 / 3 / 3",
                  position: "relative",
                  background: "#EEF0F3",
                  borderRadius: 8,
                  boxSizing: "border-box",
                  overflow: "hidden",
                  minHeight: 74,
                }}
              >
                <svg
                  viewBox="0 0 200 110"
                  preserveAspectRatio="xMidYMid meet"
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                >
                  <path
                    d="M36 44 C 22 76, 76 88, 100 58 C 124 28, 178 40, 164 72"
                    fill="none"
                    stroke="#C4C8CF"
                    strokeWidth="11"
                    strokeLinecap="round"
                  />
                </svg>
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    transform: "translateX(-50%)",
                    bottom: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#FFFFFF",
                    background: "#6B6E76",
                    borderRadius: 5,
                    padding: "3px 7px",
                    letterSpacing: "0.06em",
                  }}
                >
                  입구
                </div>
              </div>
            </div>
          </div>

          {/* 회의실 리스트 */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            {data.rooms.map((r) => {
              const on = r.id === sel.id;
              const rb = bookingsOf(r.id);
              const inUse = inUseRoom(r.id);
              const hovered = hover === `row:${r.id}`;
              const pillBg = on ? "#FFFFFF" : isToday ? (inUse ? "#FFEDE8" : "#E7F8EC") : "#EEF0F3";
              const pillFg = on ? "#0052CC" : isToday ? (inUse ? "#B33F1E" : "#00701F") : "#46474C";
              const pillText = isToday ? (inUse ? "이용 중" : "이용 가능") : `${rb.length}건`;
              return (
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => select(r.id)}
                  onKeyDown={onKeyActivate(r.id)}
                  onMouseEnter={() => setHover(`row:${r.id}`)}
                  onMouseLeave={() => setHover(null)}
                  style={{
                    boxSizing: "border-box",
                    cursor: "pointer",
                    padding: "13px 14px",
                    borderRadius: 12,
                    background: on ? ACCENT : hovered ? "#EFF1F4" : "#F7F8FA",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    boxShadow: on ? "0 8px 20px rgba(0,102,255,0.20)" : "none",
                    transition: "background 160ms ease-out, box-shadow 200ms ease-out",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div
                      style={{
                        fontSize: 17,
                        fontWeight: 700,
                        letterSpacing: "-0.02em",
                        lineHeight: 1,
                        color: on ? "#FFFFFF" : "#171719",
                      }}
                    >
                      {r.id}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.01em",
                        color: on ? "#FFFFFF" : "#6B6E76",
                      }}
                    >
                      {r.meta || "회의실"}
                    </div>
                    <div style={{ flex: 1 }} />
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.02em",
                        padding: "4px 8px",
                        borderRadius: 5,
                        background: pillBg,
                        color: pillFg,
                      }}
                    >
                      {pillText}
                    </div>
                  </div>
                  <div
                    style={{
                      position: "relative",
                      height: 6,
                      borderRadius: 3,
                      background: on ? "rgba(255,255,255,0.26)" : "#E4E6EA",
                      overflow: "hidden",
                    }}
                  >
                    {rb.map((b, i) => (
                      <div
                        key={i}
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left: `${pct(b.start)}%`,
                          width: `${Math.max(0, pct(b.end) - pct(b.start))}%`,
                          background: on ? "#FFFFFF" : isPast(b) ? "#C4C8CF" : ACCENT,
                          borderRadius: 3,
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 11,
              fontWeight: 600,
              color: "#6B6E76",
              letterSpacing: "0.1em",
            }}
          >
            <div>{String(DS).padStart(2, "0")}</div>
            <div>{String(axisMid).padStart(2, "0")}</div>
            <div>{String(DE).padStart(2, "0")}</div>
          </div>
        </div>

        {/* 우측 상세 패널 */}
        <div
          style={{
            flex: "1 1 420px",
            minWidth: 300,
            background: "#FFFFFF",
            border: "1px solid #E8E9EB",
            borderRadius: 16,
            padding: "26px 28px 20px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          {/* 룸 헤더 */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 20,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ fontSize: 38, fontWeight: 700, color: ACCENT, letterSpacing: "-0.04em", lineHeight: 1 }}>
                {sel.id}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" }}>
                  {sel.space || "회의실"}
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "#8E9199" }}>{sel.meta || "—"}</div>
              </div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#6B6E76", letterSpacing: "0.12em", paddingTop: 6 }}>
              {data.monthDay} {isToday ? "· 오늘" : `(${data.weekday})`}
            </div>
          </div>

          {/* 요약 3칸 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
              gap: 1,
              background: "#EDEEF0",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <SummaryCell label="STATUS" value={statusText} valueColor={statusColor} />
            <SummaryCell label="NEXT" value={nextText} />
            <SummaryCell label="TOTAL" value={`${selBookings.length}건`} />
          </div>

          {/* 헤드라인 + 타임라인 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 23, fontWeight: 700, color: ACCENT, letterSpacing: "-0.03em" }}>
                {headline}
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#8E9199" }}>{headSub}</div>
            </div>

            <div style={{ position: "relative", paddingTop: 22 }}>
              <div style={{ position: "relative", height: 16 }}>
                {axisLabels.map((h) => (
                  <div
                    key={h}
                    style={{
                      position: "absolute",
                      left: `${pct(h)}%`,
                      transform: h === DS ? "none" : h === DE ? "translateX(-100%)" : "translateX(-50%)",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#6B6E76",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {String(h).padStart(2, "0")}
                  </div>
                ))}
              </div>
              {isToday && clock >= DS && clock <= DE && (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: `${pct(clock)}%`,
                    transform: "translateX(-50%)",
                    fontSize: 11,
                    fontWeight: 700,
                    color: ACCENT,
                    background: "#FFFFFF",
                    padding: "0 4px",
                    letterSpacing: "0.04em",
                    whiteSpace: "nowrap",
                  }}
                >
                  {hm(Math.floor(clock) + Math.round((clock - Math.floor(clock)) * 60) / 60)}
                </div>
              )}
              <div
                style={{
                  position: "relative",
                  height: 58,
                  background: "#F4F6F8",
                  borderRadius: 10,
                  overflow: "hidden",
                }}
              >
                {gridLines.map((h) => (
                  <div
                    key={h}
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: `${pct(h)}%`,
                      width: 1,
                      background: h === DS || h === DE ? "transparent" : "#E7EAEE",
                    }}
                  />
                ))}
                {isToday && clock >= DS && clock <= DE && (
                  <div
                    style={{
                      position: "absolute",
                      left: `${pct(clock)}%`,
                      top: 0,
                      bottom: 0,
                      width: 2,
                      marginLeft: -1,
                      background: ACCENT,
                      opacity: 0.9,
                    }}
                  />
                )}
                {selBookings.map((b, i) => {
                  const live = isLive(b);
                  const past = isPast(b);
                  const bg = live ? ACCENT : past ? "#E5E7EA" : "#D2E4FF";
                  const fg = live ? "#FFFFFF" : past ? "#5F6269" : "#0B4FBF";
                  const width = Math.max(0, pct(b.end) - pct(b.start));
                  const showTime = (b.end - b.start) / SPAN >= 0.16;
                  return (
                    <div
                      key={i}
                      title={`${hm(b.start)}–${hm(b.end)} ${b.title}${b.who ? ` · ${b.who}` : ""}`}
                      style={{
                        position: "absolute",
                        top: 6,
                        bottom: 6,
                        left: `${pct(b.start)}%`,
                        width: `${width}%`,
                        background: bg,
                        borderRadius: 8,
                        padding: "0 10px",
                        boxSizing: "border-box",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        gap: 2,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: fg,
                          letterSpacing: "-0.01em",
                          whiteSpace: "nowrap",
                          textOverflow: "ellipsis",
                          overflow: "hidden",
                        }}
                      >
                        {b.title}
                      </div>
                      {showTime && (
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: fg,
                            opacity: 0.72,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {hm(b.start)}–{hm(b.end)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 일정 리스트 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#6B6E76", letterSpacing: "0.14em" }}>
              {isToday ? "오늘 일정" : "예약 일정"}
            </div>
            {selBookings.map((b, i) => {
              const live = isLive(b);
              const past = isPast(b);
              const tag = !isToday ? "예약" : live ? "진행 중" : past ? "종료" : "예정";
              const tagBg = !isToday ? "#EAF2FF" : live ? ACCENT : past ? "#F1F2F3" : "#EAF2FF";
              const tagFg = !isToday ? "#0B4FBF" : live ? "#FFFFFF" : past ? "#5F6269" : "#0B4FBF";
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "11px 2px",
                    borderTop: "1px solid #F1F2F3",
                    flexWrap: "wrap",
                    opacity: past ? 0.72 : 1,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      letterSpacing: "0.01em",
                      fontVariantNumeric: "tabular-nums",
                      minWidth: 104,
                    }}
                  >
                    {hm(b.start)} – {hm(b.end)}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", flex: 1 }}>
                    {b.title}
                  </div>
                  {(b.who || b.people) && (
                    <div style={{ fontSize: 12, fontWeight: 500, color: "#8E9199" }}>
                      {b.who}
                      {b.who && b.people ? " · " : ""}
                      {b.people ? `${b.people}명` : ""}
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                      padding: "4px 8px",
                      borderRadius: 6,
                      background: tagBg,
                      color: tagFg,
                    }}
                  >
                    {tag}
                  </div>
                </div>
              );
            })}
            {selBookings.length === 0 && (
              <div style={{ padding: "20px 0", fontSize: 13, fontWeight: 500, color: "#6B6E76" }}>
                {isToday ? "오늘 등록된 일정이 없습니다." : "이 회의실에 등록된 일정이 없습니다."}
              </div>
            )}
          </div>

          <div
            style={{
              marginTop: "auto",
              paddingTop: 16,
              borderTop: "1px solid #F1F2F3",
              fontSize: 12,
              fontWeight: 600,
              color: ACCENT,
              letterSpacing: "0.01em",
            }}
          >
            예약 현황 조회 전용 · 예약은 공식 회의실 예약 시스템에서 진행하세요
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 하위 조각 ─────────────────────────────────────────────
function PageHeader({ chips }: { chips: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 20,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#6B6E76", letterSpacing: "0.2em" }}>
          MEETING ROOM
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>회의실 예약 현황</div>
      </div>
      {chips && <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>{chips}</div>}
    </div>
  );
}

function Chip({ children, tabular }: { children: React.ReactNode; tabular?: boolean }) {
  return (
    <div
      style={{
        fontSize: 12,
        fontWeight: 600,
        color: "#46474C",
        background: "#FFFFFF",
        border: "1px solid #E8E9EB",
        borderRadius: 8,
        padding: "7px 11px",
        letterSpacing: "0.04em",
        fontVariantNumeric: tabular ? "tabular-nums" : "normal",
      }}
    >
      {children}
    </div>
  );
}

function SummaryCell({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ background: "#FFFFFF", padding: "15px 18px", display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#6B6E76", letterSpacing: "0.14em" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em", color: valueColor ?? "#171719" }}>
        {value}
      </div>
    </div>
  );
}

function MapTile({
  room,
  on,
  inUse,
  hovered,
  onHover,
  onSelect,
  onKeyActivate,
}: {
  room: RoomDef;
  on: boolean;
  inUse: boolean;
  hovered: boolean;
  onHover: (v: boolean) => void;
  onSelect: () => void;
  onKeyActivate: (e: React.KeyboardEvent) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={onKeyActivate}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{
        flex: 1,
        minHeight: 34,
        boxSizing: "border-box",
        cursor: "pointer",
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "-0.01em",
        background: on ? ACCENT : inUse ? "#FFF0EB" : "#FFFFFF",
        color: on ? "#FFFFFF" : "#171719",
        boxShadow: on
          ? "0 4px 12px rgba(0,102,255,0.24)"
          : hovered
            ? "inset 0 0 0 1px #B9BCC2"
            : inUse
              ? "inset 0 0 0 1px #FBD6C9"
              : "inset 0 0 0 1px #E4E6EA",
        transition: "background 160ms ease-out, box-shadow 200ms ease-out",
      }}
    >
      {room.id}
    </div>
  );
}
