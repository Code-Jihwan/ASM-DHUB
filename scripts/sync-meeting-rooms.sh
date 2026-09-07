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
CHECK_URL="$BASE/member/admin/checkStat2.json"   # 로그인 전 계정 잠금/시도횟수 사전확인(브라우저가 먼저 호출)
LOGIN_POST="$BASE/member/admin/toLogin.do"
LIST_URL="$BASE/item/itemRent/list.do?menuNo=100240"   # 다운로드 전 목록 진입(세션에 모듈/사이트 컨텍스트 설정)
TODAY="$(date +%F)"
DL="$BASE/item/itemRent/downloadExcel.uxls?menuNo=100240&sdate=$TODAY&edate=$TODAY&searchStat=&searchCnd=1&searchWrd=&pageIndex=1"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
ORIGIN="https://www.swmaestro.ai"

JAR="$(mktemp -t rooms-jar)"
TMP="$(mktemp -t rooms-sync)"
trap 'rm -f "$JAR" "$TMP"' EXIT

echo "[$(date '+%F %T')] 로그인 → 다운로드 ($TODAY) …"
# 로그인은 브라우저와 동일하게 2단계:
#   ① checkStat2.json 사전확인(resultCode=success 여야 함) → ② 그때만 toLogin.do 폼 전송.
#   ①을 건너뛰면 서버가 세션 플래그를 못 세워 로그인 페이지 HTML 만 돌아온다(과거 실패 원인).
# 1) 로그인 페이지 GET(세션 쿠키 확보)
curl -fsSL --max-time 60 -A "$UA" -c "$JAR" "$LOGIN_PAGE" -o /dev/null
# 2) 사전확인(AJAX). 잠겨 있으면 success 가 아니라 lockMin 이 온다.
CHECK="$(curl -fsSL --max-time 60 -A "$UA" -b "$JAR" -c "$JAR" -e "$LOGIN_PAGE" \
  -H "Origin: $ORIGIN" -H 'X-Requested-With: XMLHttpRequest' \
  --data "siteName=bos" --data "loginFlag=" \
  --data-urlencode "username=$SWM_ID" --data-urlencode "password=$SWM_PW" \
  "$CHECK_URL")"
if ! printf '%s' "$CHECK" | grep -q 'success'; then
  echo "‼️  로그인 사전확인 실패 — 계정 잠김/시도횟수 초과일 수 있음. 응답: $(printf '%s' "$CHECK" | head -c 160)"
  exit 1
fi
# 3) 실제 로그인 POST(폼 전송)
curl -fsSL --max-time 60 -A "$UA" -b "$JAR" -c "$JAR" -L -e "$LOGIN_PAGE" \
  -H "Origin: $ORIGIN" \
  --data "siteName=bos" --data "loginFlag=" \
  --data-urlencode "username=$SWM_ID" --data-urlencode "password=$SWM_PW" \
  "$LOGIN_POST" -o /dev/null
# 4) 목록 페이지 진입(브라우저와 동일) + 로그인 상태 확인.
#    목록이 로그인 페이지면 → 로그인 실패(아이디/비번). 회의실 목록이면 → 로그인 OK.
#    (이 진입이 세션에 회의실예약 모듈/사이트 컨텍스트를 세운다. 없으면 다운로드가 서울로 튕김.)
LIST_HTML="$(curl -fsSL --max-time 60 -A "$UA" -b "$JAR" -c "$JAR" -e "$LOGIN_PAGE" "$LIST_URL")"
if printf '%s' "$LIST_HTML" | grep -qE 'MiyaValidator|loginForm|forLogin\.do'; then
  echo "‼️  로그인 실패 — 목록이 로그인 페이지로 튕김. ~/.rooms-sync.env 의 SWM_ID/SWM_PW 가 브라우저 로그인과 동일한지 확인(오타/공백/다른 계정)."
  exit 1
fi
if ! printf '%s' "$LIST_HTML" | grep -qE '회의실|예약|로그아웃|logout'; then
  echo "‼️  목록 진입이 예상과 다름(로그인/사이트 컨텍스트 의심). 앞부분: $(printf '%s' "$LIST_HTML" | tr '\n' ' ' | head -c 120)"
fi
# 5) 오늘 엑셀 다운로드(목록에서 엑셀 버튼 누른 것처럼 Referer 를 목록 페이지로)
curl -fsSL --max-time 60 -A "$UA" -b "$JAR" -e "$LIST_URL" "$DL" -o "$TMP"

# 로그인 실패/세션 문제면 엑셀 대신 HTML 이 온다 → 매직바이트(504b/d0cf) 아니면 중단.
SIG="$(od -An -tx1 -N2 "$TMP" | tr -d ' \n' | tr 'A-F' 'a-f')"
if [ "$SIG" != "504b" ] && [ "$SIG" != "d0cf" ]; then
  HEAD="$(head -c 600 "$TMP" | tr '\n' ' ')"
  if printf '%s' "$HEAD" | grep -qE 'loginForm|MiyaValidator|forLogin|toLogin'; then
    echo "‼️  로그인 세션이 아닙니다 — 아이디/비번 확인 또는 계정 잠김(로그인 페이지가 돌아옴)."
  else
    echo "‼️  엑셀이 아닙니다 — 로그인은 됐으나 다운로드 응답이 엑셀이 아님(권한/파라미터?). 응답: $(printf '%s' "$HEAD" | head -c 160)"
  fi
  exit 1
fi

echo "[$(date '+%F %T')] 업로드 → $INGEST_URL"
RESP="$(curl -fsS --max-time 60 -X POST "$INGEST_URL" \
  -H "x-ingest-secret: ${ROOMS_INGEST_SECRET}" \
  -H "x-file-name: rooms_${TODAY}.xls" \
  -H "content-type: application/vnd.ms-excel" \
  --data-binary "@${TMP}")"
echo "[$(date '+%F %T')] 완료: $RESP"
