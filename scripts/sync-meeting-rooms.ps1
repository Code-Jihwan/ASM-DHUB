# 회의실 예약 현황 자동 동기화 (Windows PowerShell)
#   SW마에스트로에서 '오늘' 예약 현황 엑셀을 받아 → 자리요 수신 엔드포인트로 POST 한다.
#   Windows 작업 스케줄러가 하루 5회(09/12/15/18/21시) 호출하는 용도.
#
# 준비: 메모장으로 %USERPROFILE%\.rooms-sync.env 파일을 만들고 아래 두 줄을 넣는다.
#   SWM_COOKIE=JSESSIONID=....; ....        ← SW마에스트로 로그인 세션 쿠키
#   ROOMS_INGEST_SECRET=....                 ← 자리요(Vercel) ROOMS_INGEST_SECRET 과 동일 값
#   # INGEST_URL=https://www.asm-dhub.fkii.space/api/rooms/ingest   (선택, 기본값 있음)
#
#   ※ SWM_COOKIE(로그인 세션)는 시간이 지나면 만료된다. 만료되면 이 스크립트가
#     "엑셀이 아님(세션 만료)"으로 실패하고 로그(%USERPROFILE%\rooms-sync.log)를 남긴다 → 쿠키를 다시 넣는다.
#
# 수동 실행/테스트:
#   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\경로\scripts\sync-meeting-rooms.ps1"

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$LogFile = Join-Path $HOME 'rooms-sync.log'
function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Output $line
  try { Add-Content -Path $LogFile -Value $line -Encoding UTF8 } catch {}
}

# ~/.rooms-sync.env 읽기 (KEY=VALUE, 값의 = 는 그대로, 앞뒤 따옴표/BOM 제거)
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
$cookie = if ($cfg['SWM_COOKIE']) { $cfg['SWM_COOKIE'] } else { $env:SWM_COOKIE }
$secret = if ($cfg['ROOMS_INGEST_SECRET']) { $cfg['ROOMS_INGEST_SECRET'] } else { $env:ROOMS_INGEST_SECRET }
$ingest = if ($cfg['INGEST_URL']) { $cfg['INGEST_URL'] } elseif ($env:INGEST_URL) { $env:INGEST_URL } else { 'https://www.asm-dhub.fkii.space/api/rooms/ingest' }

if (-not $cookie) { Log 'SWM_COOKIE 가 필요합니다 (%USERPROFILE%\.rooms-sync.env)'; exit 1 }
if (-not $secret) { Log 'ROOMS_INGEST_SECRET 가 필요합니다 (%USERPROFILE%\.rooms-sync.env)'; exit 1 }

$today = Get-Date -Format 'yyyy-MM-dd'
$src = "https://www.swmaestro.ai/busan/bos/item/itemRent/downloadExcel.uxls?menuNo=100240&sdate=$today&edate=$today&searchStat=&searchCnd=1&searchWrd=&pageIndex=1"
$tmp = Join-Path $env:TEMP ("rooms-sync-" + [guid]::NewGuid().ToString('N') + ".xls")

Log "다운로드 ($today) ..."
try {
  Invoke-WebRequest -Uri $src -Headers @{ 'Cookie' = $cookie; 'User-Agent' = 'Mozilla/5.0' } `
    -OutFile $tmp -TimeoutSec 60 -UseBasicParsing
}
catch {
  Log ("다운로드 실패: " + $_.Exception.Message); exit 1
}

# 로그인 만료 시 SW마에스트로는 엑셀 대신 HTML(로그인/리다이렉트)을 준다.
# 엑셀 매직바이트(PK=50 4B / OLE2=D0 CF)가 아니면 저장하지 않고 중단(오염 방지).
$bytes = [System.IO.File]::ReadAllBytes($tmp)
$isXls = ($bytes.Length -ge 2) -and (
  (($bytes[0] -eq 0x50) -and ($bytes[1] -eq 0x4B)) -or
  (($bytes[0] -eq 0xD0) -and ($bytes[1] -eq 0xCF))
)
if (-not $isXls) {
  Log "! 엑셀이 아닙니다 (SW마에스트로 로그인 세션 만료 추정). SWM_COOKIE 를 갱신하세요."
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
