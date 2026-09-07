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
# 콘솔에 한글이 깨지지 않도록 출력 인코딩을 UTF-8 로. (파일 자체는 UTF-8 BOM 으로 저장돼 있어야 5.1이 한글을 바르게 읽는다)
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

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

# 설정 파일을 여러 위치·여러 이름으로 찾는다.
# (윈도우는 점(.)으로 시작하는 파일을 만들기 까다로워, 점 없는 이름이나 .txt 가 붙는 실수가 잦다.)
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { $null }
$envDirs = @()
if ($scriptDir) { $envDirs += $scriptDir }
$envDirs += 'C:\rooms-sync'
$envDirs += $HOME
$envDirs = $envDirs | Where-Object { $_ } | Select-Object -Unique
$envNames = @('.rooms-sync.env', 'rooms-sync.env', '.rooms-sync.env.txt', 'rooms-sync.env.txt')
$envCandidates = foreach ($d in $envDirs) { foreach ($n in $envNames) { Join-Path $d $n } }
$envPath = $envCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($envPath) { Log "설정 파일 사용: $envPath" }
else { Log ("설정 파일을 못 찾음. 아래 위치·이름 중 하나로 두세요:`n  " + ($envCandidates -join "`n  ")) }
$cfg = if ($envPath) { Read-EnvFile $envPath } else { @{} }
$id     = if ($cfg['SWM_ID']) { $cfg['SWM_ID'] } else { $env:SWM_ID }
$pw     = if ($cfg['SWM_PW']) { $cfg['SWM_PW'] } else { $env:SWM_PW }
$secret = if ($cfg['ROOMS_INGEST_SECRET']) { $cfg['ROOMS_INGEST_SECRET'] } else { $env:ROOMS_INGEST_SECRET }
$ingest = if ($cfg['INGEST_URL']) { $cfg['INGEST_URL'] } elseif ($env:INGEST_URL) { $env:INGEST_URL } else { 'https://www.asm-dhub.fkii.space/api/rooms/ingest' }

if (-not $id -or -not $pw) { Log 'SWM_ID / SWM_PW 가 필요합니다 (.rooms-sync.env: 스크립트 폴더 또는 사용자 홈)'; exit 1 }
if (-not $secret) { Log 'ROOMS_INGEST_SECRET 가 필요합니다 (.rooms-sync.env: 스크립트 폴더 또는 사용자 홈)'; exit 1 }

$base       = 'https://www.swmaestro.ai/busan/bos'
$loginPage  = "$base/member/admin/forLogin.do"
$checkUrl   = "$base/member/admin/checkStat2.json"   # 로그인 전 계정 잠금/시도횟수 사전확인(브라우저가 먼저 호출)
$loginPost  = "$base/member/admin/toLogin.do"
$listUrl    = "$base/item/itemRent/list.do?menuNo=100240"   # 다운로드 전 목록 진입(세션에 모듈/사이트 컨텍스트 설정)
$today      = Get-Date -Format 'yyyy-MM-dd'
$downloadUrl = "$base/item/itemRent/downloadExcel.uxls?menuNo=100240&sdate=$today&edate=$today&searchStat=&searchCnd=1&searchWrd=&pageIndex=1"
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
$origin = 'https://www.swmaestro.ai'
$tmp = Join-Path $env:TEMP ("rooms-sync-" + [guid]::NewGuid().ToString('N') + ".xls")

# 로그인은 브라우저와 동일하게 2단계다:
#   ① checkStat2.json 로 계정 잠금/시도횟수 사전확인(resultCode=success 여야 함)
#   ② 그때만 toLogin.do 로 실제 로그인 폼 전송.
# ①을 건너뛰면 서버가 세션 플래그를 못 세워 로그인 페이지 HTML 만 돌아온다(과거 실패 원인).
$body = @{ siteName = 'bos'; loginFlag = ''; username = $id; password = $pw }
$loginHdr = @{ 'Referer' = $loginPage; 'Origin' = $origin; 'X-Requested-With' = 'XMLHttpRequest' }

# 로그인 POST 후 리다이렉트를 '수동으로' 따라가며 매 홉의 Set-Cookie 를 세션에 담는다.
# (Windows PowerShell 5.1 은 자동 리다이렉트 시 302 응답이 주는 새 세션 쿠키를 놓칠 수 있어,
#  로그인은 서버에서 성공했는데도 이후 요청이 '미로그인 세션'이 되는 문제가 있다.)
function Send-Login($startUri, $postBody, $webSess, $referer) {
  $cur = $startUri; $method = 'Post'; $hops = @()
  for ($h = 0; $h -lt 10; $h++) {
    $p = @{ Uri = $cur; WebSession = $webSess; UserAgent = $ua;
            Headers = @{ 'Referer' = $referer; 'Origin' = $origin };
            MaximumRedirection = 0; UseBasicParsing = $true; TimeoutSec = 60 }
    if ($method -eq 'Post') { $p['Method'] = 'Post'; $p['Body'] = $postBody } else { $p['Method'] = 'Get' }
    $status = 0; $loc = $null; $content = ''
    try {
      $r = Invoke-WebRequest @p
      $status = [int]$r.StatusCode; $loc = $r.Headers['Location']; $content = "$($r.Content)"
    } catch {
      $er = $_.Exception.Response
      if ($null -eq $er) { throw }
      $status = [int]$er.StatusCode
      try { $loc = $er.Headers['Location'] } catch {}
      try { $sr = New-Object System.IO.StreamReader($er.GetResponseStream()); $content = $sr.ReadToEnd(); $sr.Close() } catch {}
    }
    $hops += "$status"
    if ($status -ge 300 -and $status -lt 400 -and $loc) {
      $cur = ([uri]::new([uri]$cur, [string]$loc)).AbsoluteUri
      $referer = $cur; $method = 'Get'; continue
    }
    return [pscustomobject]@{ StatusCode = $status; Content = $content; Hops = ($hops -join '>') }
  }
  return [pscustomobject]@{ StatusCode = $status; Content = $content; Hops = ($hops -join '>') }
}

try {
  # 1) 로그인 페이지 GET → 세션 쿠키 확보(같은 세션으로 이어 감)
  Invoke-WebRequest -Uri $loginPage -SessionVariable sess -UserAgent $ua -UseBasicParsing -TimeoutSec 60 | Out-Null
  # 2) 사전확인(AJAX). 잠겨 있으면 여기서 lockMin 분 후 재시도 안내가 온다.
  $check = Invoke-WebRequest -Uri $checkUrl -Method Post -Body $body -WebSession $sess -UserAgent $ua `
    -Headers $loginHdr -UseBasicParsing -TimeoutSec 60
  if ($check.Content -notmatch 'success') {
    $lock = ''
    if ($check.Content -match '"lockMin"\s*:\s*"?([0-9]+)') { $lock = $Matches[1] }
    Log ("! 로그인 사전확인 실패 — 계정 잠김/시도횟수 초과일 수 있음" + $(if($lock){" ($lock분 후 재시도)"}else{""}) + ". 응답: " + ($check.Content.Substring(0, [Math]::Min(160, $check.Content.Length))))
    exit 1
  }
  # 3) 실제 로그인 POST — 리다이렉트를 수동으로 따라가며 세션 쿠키를 확실히 담는다.
  $before = ''
  try { $before = (($sess.Cookies.GetCookies([uri]$loginPost)) | Where-Object { $_.Name -eq 'JSESSIONID' } | Select-Object -First 1).Value } catch {}
  $login = Send-Login $loginPost $body $sess $loginPage
  $after = ''
  try { $after = (($sess.Cookies.GetCookies([uri]$loginPost)) | Where-Object { $_.Name -eq 'JSESSIONID' } | Select-Object -First 1).Value } catch {}
  $cookieNames = ''
  try { $cookieNames = (($sess.Cookies.GetCookies([uri]$loginPost)) | ForEach-Object { $_.Name }) -join ',' } catch {}
  $lb = "$($login.Content)"
  $loginState = if ($lb -match 'MiyaValidator|loginForm') { '로그인페이지(인증실패)' } `
                elseif ($lb -match '관리자페이지|로그아웃|logout') { '관리자홈(성공추정)' } else { '기타' }
  $ltitle = if ($lb -match '(?is)<title>\s*(.*?)\s*</title>') { $Matches[1] } else { '' }
  Log ("로그인 응답: 홉[$($login.Hops)] / 세션쿠키[$cookieNames] / JSESSIONID변경=$([bool]($before -ne $after)) / ID$($id.Length)·PW$($pw.Length)자 / $loginState / 제목:$ltitle")
  # 4) 목록 페이지 진입(브라우저와 동일) + 로그인 상태 확인.
  #    목록이 로그인 페이지로 튕기면 → 로그인 실패(아이디/비번). 회의실 목록이 보이면 → 로그인 OK.
  #    (이 진입이 세션에 회의실예약 모듈/사이트 컨텍스트를 세운다. 없으면 다운로드가 서울로 튕김.)
  $listResp = Invoke-WebRequest -Uri $listUrl -WebSession $sess -UserAgent $ua `
    -Headers @{ 'Referer' = $loginPage } -UseBasicParsing -TimeoutSec 60
  $lc = "$($listResp.Content)"
  if ($lc -match 'MiyaValidator|loginForm|forLogin\.do') {
    Log "! 로그인 실패 — 목록이 로그인 페이지로 튕겼습니다. .rooms-sync.env 의 SWM_ID/SWM_PW 가 브라우저에서 직접 로그인할 때와 똑같은지 확인하세요(오타/앞뒤 공백/다른 계정)."
    exit 1
  }
  if ($lc -notmatch '회의실|예약|로그아웃|logout') {
    $lt = if ($lc -match '(?is)<title>\s*(.*?)\s*</title>') { $Matches[1] } else { '(제목없음)' }
    Log ("! 목록 진입이 예상과 다릅니다(로그인/사이트 컨텍스트 의심). 페이지: " + $lt)
  } else {
    Log "로그인·목록 진입 OK"
  }
  # 5) 오늘 엑셀 다운로드(목록에서 엑셀 버튼 누른 것처럼 Referer 를 목록 페이지로)
  Log "다운로드 ($today) ..."
  Invoke-WebRequest -Uri $downloadUrl -WebSession $sess -UserAgent $ua `
    -Headers @{ 'Referer' = $listUrl } -OutFile $tmp -UseBasicParsing -TimeoutSec 60
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
  # 응답 앞부분을 보고 로그인 문제인지 다운로드 문제인지 구분해 알려준다.
  $head = ''
  try { $head = [System.Text.Encoding]::UTF8.GetString($bytes, 0, [Math]::Min(600, $bytes.Length)) } catch {}
  if ($head -match 'loginForm|MiyaValidator|forLogin|toLogin') {
    Log "! 로그인 세션이 아닙니다 — 아이디/비번 확인 또는 계정 잠김(로그인 페이지가 돌아옴)."
  } else {
    $title = if ($head -match '(?is)<title>\s*(.*?)\s*</title>') { $Matches[1] } else { ($head -replace '\s+', ' ').Substring(0, [Math]::Min(160, ($head -replace '\s+',' ').Length)) }
    Log ("! 엑셀이 아닙니다 — 로그인은 됐으나 다운로드 응답이 엑셀이 아님(권한/파라미터?). 응답: " + $title)
  }
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
