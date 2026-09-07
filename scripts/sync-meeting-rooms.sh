#!/usr/bin/env bash
# 회의실 예약 현황 자동 동기화
#   SW마에스트로에서 '오늘' 예약 현황 엑셀을 받아 → 자리요 수신 엔드포인트로 밀어넣는다.
#   매일 09/12/15/18/21시에 크론이 호출하는 용도.
#
# 준비: 아래 값을 담은 ~/.rooms-sync.env 파일(권한 600 권장)을 만들어 둔다.
#   SWM_COOKIE='JSESSIONID=....; ...'     # SW마에스트로 로그인 세션 쿠키
#   ROOMS_INGEST_SECRET='...'             # 자리요(Vercel) ROOMS_INGEST_SECRET 과 동일 값
#   # INGEST_URL='https://www.asm-dhub.fkii.space/api/rooms/ingest'  # (선택) 기본값 있음
#
#   ※ SWM_COOKIE 는 로그인 세션이라 시간이 지나면 만료된다. 만료되면 이 스크립트가
#     "엑셀이 아님(세션 만료)"으로 실패하고 로그를 남긴다 → 쿠키를 다시 넣어 준다.
#
# 크론 등록 예 (crontab -e):
#   0 9,12,15,18,21 * * * /Users/jujihwan/ASM-DHUB/scripts/sync-meeting-rooms.sh >> "$HOME/rooms-sync.log" 2>&1

set -euo pipefail

# 비밀값은 파일에서 읽는다(크론 라인에 노출하지 않기 위해).
[ -f "$HOME/.rooms-sync.env" ] && . "$HOME/.rooms-sync.env"

: "${SWM_COOKIE:?SWM_COOKIE 가 필요합니다 (~/.rooms-sync.env)}"
: "${ROOMS_INGEST_SECRET:?ROOMS_INGEST_SECRET 가 필요합니다 (~/.rooms-sync.env)}"
INGEST_URL="${INGEST_URL:-https://www.asm-dhub.fkii.space/api/rooms/ingest}"
MENU_NO="100240"

TODAY="$(date +%F)" # YYYY-MM-DD
SRC="https://www.swmaestro.ai/busan/bos/item/itemRent/downloadExcel.uxls?menuNo=${MENU_NO}&sdate=${TODAY}&edate=${TODAY}&searchStat=&searchCnd=1&searchWrd=&pageIndex=1"

TMP="$(mktemp -t rooms-sync)"
trap 'rm -f "$TMP"' EXIT

echo "[$(date '+%F %T')] 다운로드 ($TODAY) …"
curl -fsSL --max-time 60 -A "Mozilla/5.0" --cookie "$SWM_COOKIE" "$SRC" -o "$TMP"

# 로그인 만료 시 SW마에스트로는 엑셀 대신 HTML(로그인/리다이렉트)을 준다.
# 엑셀 매직바이트(PK=504b / OLE2=d0cf)가 아니면 중단해 오염 저장을 막는다.
SIG="$(od -An -tx1 -N2 "$TMP" | tr -d ' \n' | tr 'A-F' 'a-f')"
if [ "$SIG" != "504b" ] && [ "$SIG" != "d0cf" ]; then
  echo "‼️  엑셀이 아닙니다(SW마에스트로 로그인 세션 만료 추정). SWM_COOKIE 를 갱신하세요."
  echo "    응답 앞부분: $(head -c 160 "$TMP" | tr '\n' ' ')"
  exit 1
fi

echo "[$(date '+%F %T')] 업로드 → $INGEST_URL"
RESP="$(curl -fsS --max-time 60 -X POST "$INGEST_URL" \
  -H "x-ingest-secret: ${ROOMS_INGEST_SECRET}" \
  -H "x-file-name: 회의실 예약 현황_${TODAY}.xls" \
  -H "content-type: application/vnd.ms-excel" \
  --data-binary "@${TMP}")"
echo "[$(date '+%F %T')] 완료: $RESP"
