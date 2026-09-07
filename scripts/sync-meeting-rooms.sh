#!/usr/bin/env bash
# 회의실 예약 현황 자동 동기화 (macOS/Linux) — 자동 로그인 방식
#   매 실행마다 SW마에스트로에 로그인 → 오늘 엑셀 다운로드 → 자리요 수신 엔드포인트로 POST.
#   로그인해서 새 세션을 받으므로 쿠키 만료 걱정이 없다. 크론이 하루 5회 호출.
#
# 준비: ~/.rooms-sync.env (권한 600 권장)에 아래를 넣는다.
#   SWM_ID=관리자아이디
#   SWM_PW=관리자비밀번호
#   ROOMS_INGEST_SECRET=자리요(Vercel) ROOMS_INGEST_SECRET 과 동일 값
#   # INGEST_URL=https://www.asm-dhub.fkii.space/api/rooms/ingest   (선택)
#   ※ 관리자 비밀번호가 평문으로 저장된다. 파일 권한을 잠그고(chmod 600) 가능하면 권한 낮은 계정 사용 권장.
#
# 크론 예 (crontab -e):
#   0 9,12,15,18,21 * * * /Users/jujihwan/ASM-DHUB/scripts/sync-meeting-rooms.sh >> "$HOME/rooms-sync.log" 2>&1

set -euo pipefail

[ -f "$HOME/.rooms-sync.env" ] && . "$HOME/.rooms-sync.env"
: "${SWM_ID:?SWM_ID 가 필요합니다 (~/.rooms-sync.env)}"
: "${SWM_PW:?SWM_PW 가 필요합니다 (~/.rooms-sync.env)}"
: "${ROOMS_INGEST_SECRET:?ROOMS_INGEST_SECRET 가 필요합니다 (~/.rooms-sync.env)}"
INGEST_URL="${INGEST_URL:-https://www.asm-dhub.fkii.space/api/rooms/ingest}"

BASE="https://www.swmaestro.ai/busan/bos"
LOGIN_PAGE="$BASE/member/admin/forLogin.do"
LOGIN_POST="$BASE/member/admin/toLogin.do"
TODAY="$(date +%F)"
DL="$BASE/item/itemRent/downloadExcel.uxls?menuNo=100240&sdate=$TODAY&edate=$TODAY&searchStat=&searchCnd=1&searchWrd=&pageIndex=1"
UA="Mozilla/5.0"

JAR="$(mktemp -t rooms-jar)"
TMP="$(mktemp -t rooms-sync)"
trap 'rm -f "$JAR" "$TMP"' EXIT

echo "[$(date '+%F %T')] 로그인 → 다운로드 ($TODAY) …"
# 1) 로그인 페이지 GET(세션 쿠키 확보)
curl -fsSL --max-time 60 -A "$UA" -c "$JAR" "$LOGIN_PAGE" -o /dev/null
# 2) 로그인 POST(폼 전송). 실패해도 로그인 페이지가 돌아올 뿐 → 아래서 걸러짐.
curl -fsSL --max-time 60 -A "$UA" -b "$JAR" -c "$JAR" -L \
  --data "siteName=bos" --data "loginFlag=" \
  --data-urlencode "username=$SWM_ID" --data-urlencode "password=$SWM_PW" \
  "$LOGIN_POST" -o /dev/null
# 3) 오늘 엑셀 다운로드(로그인된 세션으로)
curl -fsSL --max-time 60 -A "$UA" -b "$JAR" "$DL" -o "$TMP"

# 로그인 실패/세션 문제면 엑셀 대신 HTML 이 온다 → 매직바이트(504b/d0cf) 아니면 중단.
SIG="$(od -An -tx1 -N2 "$TMP" | tr -d ' \n' | tr 'A-F' 'a-f')"
if [ "$SIG" != "504b" ] && [ "$SIG" != "d0cf" ]; then
  echo "‼️  엑셀이 아닙니다 — 로그인 실패(아이디/비번 확인) 또는 사이트 응답 이상."
  echo "    응답 앞부분: $(head -c 160 "$TMP" | tr '\n' ' ')"
  exit 1
fi

echo "[$(date '+%F %T')] 업로드 → $INGEST_URL"
RESP="$(curl -fsS --max-time 60 -X POST "$INGEST_URL" \
  -H "x-ingest-secret: ${ROOMS_INGEST_SECRET}" \
  -H "x-file-name: rooms_${TODAY}.xls" \
  -H "content-type: application/vnd.ms-excel" \
  --data-binary "@${TMP}")"
echo "[$(date '+%F %T')] 완료: $RESP"
