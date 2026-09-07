# 회의실 예약 현황 자동 동기화 (Windows PowerShell) — 자동 로그인 방식
#   매 실행마다 SW마에스트로에 로그인 → 오늘 예약 현황 엑셀 다운로드 → 자리요 수신 엔드포인트로 POST.
#   Windows 작업 스케줄러가 하루 5회(09/12/15/18/21시) 호출하는 용도.
#   로그인해서 새 세션을 받으므로 쿠키 만료 걱정이 없다.
#
# 준비: 메모장으로 %USERPROFILE%\.rooms-sync.env 파일을 만들고 아래를 넣는다(따옴표 불필요).
#   SWM_ID=관리자아이디
#   SWM_PW=관리자비밀번호
#   ROOMS_INGEST_SECRET=자리요(Vercel) ROOMS_INGEST_SECRET 과 동일 값
#   # INGEST_URL=https://www.asm-dhub.fkii.space/api/rooms/ingest   (선택, 기본값 있음)
#
#   ※ 이 파일에 관리자 비밀번호가 평문으로 들어간다. 파일 권한을 그 사용자만 읽도록 잠그고,
#     가능하면 권한이 낮은 별도 계정을 쓰는 것을 권장한다.
#
# 수동 테스트:
#   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\rooms-sync\sync-meeting-rooms.ps1"

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$LogFile = Join-Path $HOME 'rooms-sync.log'
function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Output $line
  try { Add-Content -Path $LogFile -Value $line -Encoding UTF8 } catch {}
}

function Read-EnvFile($path) {
  $h = @{}
  if (Test-Path $path) {
    foreach ($line in Get-Content -Path $path) {
      $t = ($line -replace "^\uFEFF", "").Trim()
      if ($t -eq '' -or $t.StartsWith('#')) { continue }
      $i = $t.IndexOf('=')
      if ($i -lt 1) { continue }
      $k = $t.Substring(0, $i).Trim()
      $v = $t.Substring($i + 1).Trim().Trim('"').Trim("'")
      $h[$k] = $v
    }
  }
  return $h
}

$cfg = Read-EnvFile (Join-Path $HOME '.rooms-sync.env')
$id     = if ($cfg['SWM_ID']) { $cfg['SWM_ID'] } else { $env:SWM_ID }
$pw     = if ($cfg['SWM_PW']) { $cfg['SWM_PW'] } else { $env:SWM_PW }
$secret = if ($cfg['ROOMS_INGEST_SECRET']) { $cfg['ROOMS_INGEST_SECRET'] } else { $env:ROOMS_INGEST_SECRET }
$ingest = if ($cfg['INGEST_URL']) { $cfg['INGEST_URL'] } elseif ($env:INGEST_URL) { $env:INGEST_URL } else { 'https://www.asm-dhub.fkii.space/api/rooms/ingest' }

if (-not $id -or -not $pw) { Log 'SWM_ID / SWM_PW 가 필요합니다 (%USERPROFILE%\.rooms-sync.env)'; exit 1 }
if (-not $secret) { Log 'ROOMS_INGEST_SECRET 가 필요합니다 (%USERPROFILE%\.rooms-sync.env)'; exit 1 }

$base       = 'https://www.swmaestro.ai/busan/bos'
$loginPage  = "$base/member/admin/forLogin.do"
$loginPost  = "$base/member/admin/toLogin.do"
$today      = Get-Date -Format 'yyyy-MM-dd'
$downloadUrl = "$base/item/itemRent/downloadExcel.uxls?menuNo=100240&sdate=$today&edate=$today&searchStat=&searchCnd=1&searchWrd=&pageIndex=1"
$ua = 'Mozilla/5.0'
$tmp = Join-Path $env:TEMP ("rooms-sync-" + [guid]::NewGuid().ToString('N') + ".xls")

try {
  # 1) 로그인 페이지 GET → 세션 쿠키 확보(같은 세션으로 이어 감)
  Invoke-WebRequest -Uri $loginPage -SessionVariable sess -UserAgent $ua -UseBasicParsing -TimeoutSec 60 | Out-Null
  # 2) 로그인 POST (폼 전송; 실패해도 로그인 페이지가 돌아올 뿐이라 아래 다운로드에서 걸러짐)
  $body = @{ siteName = 'bos'; loginFlag = ''; username = $id; password = $pw }
  Invoke-WebRequest -Uri $loginPost -Method Post -Body $body -WebSession $sess -UserAgent $ua `
    -Headers @{ 'Referer' = $loginPage } -UseBasicParsing -TimeoutSec 60 | Out-Null
  # 3) 오늘 엑셀 다운로드(로그인된 세션으로)
  Log "다운로드 ($today) ..."
  Invoke-WebRequest -Uri $downloadUrl -WebSession $sess -UserAgent $ua -OutFile $tmp -UseBasicParsing -TimeoutSec 60
}
catch {
  Log ("요청 실패: " + $_.Exception.Message); exit 1
}

# 로그인 실패/세션 문제면 엑셀 대신 HTML 이 온다 → 매직바이트(PK=50 4B / OLE2=D0 CF) 아니면 중단.
$bytes = [System.IO.File]::ReadAllBytes($tmp)
$isXls = ($bytes.Length -ge 2) -and (
  (($bytes[0] -eq 0x50) -and ($bytes[1] -eq 0x4B)) -or
  (($bytes[0] -eq 0xD0) -and ($bytes[1] -eq 0xCF))
)
if (-not $isXls) {
  Log "! 엑셀이 아닙니다 — 로그인 실패(아이디/비번 확인) 또는 사이트 응답 이상."
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  exit 1
}

Log "업로드 -> $ingest"
try {
  $resp = Invoke-RestMethod -Uri $ingest -Method Post -InFile $tmp `
    -ContentType 'application/vnd.ms-excel' `
    -Headers @{ 'x-ingest-secret' = $secret; 'x-file-name' = "rooms_$today.xls" } `
    -TimeoutSec 60
  Log ("완료: " + ($resp | ConvertTo-Json -Compress))
}
catch {
  Log ("업로드 실패: " + $_.Exception.Message)
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  exit 1
}
Remove-Item $tmp -Force -ErrorAction SilentlyContinue
