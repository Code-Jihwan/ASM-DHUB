# 회의실 예약 현황 자동 동기화 (Windows PowerShell 5.1)
# 매 실행마다 관리자 로그인 -> 오늘 예약 현황 엑셀 다운로드 -> 수신 엔드포인트로 POST
# 작업 스케줄러 실행을 고려해 설정 파일과 로그 파일은 스크립트 폴더를 우선 사용한다.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

$scriptDir = if ($PSScriptRoot) {
  $PSScriptRoot
} elseif ($MyInvocation.MyCommand.Path) {
  Split-Path -Parent $MyInvocation.MyCommand.Path
} else {
  (Get-Location).Path
}

$LogFile = Join-Path $scriptDir 'rooms-sync.log'

function Log([string]$Message) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Write-Output $line
  try { Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8 } catch {}
}

function Read-EnvFile([string]$Path) {
  $values = @{}
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $values
  }

  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    $text = ($line -replace '^\uFEFF', '').Trim()
    if ($text.Length -eq 0 -or $text.StartsWith('#')) { continue }

    $separator = $text.IndexOf('=')
    if ($separator -lt 1) { continue }

    $key = $text.Substring(0, $separator).Trim()
    $value = $text.Substring($separator + 1).Trim()

    if ($value.Length -ge 2) {
      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
          ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
    }

    $values[$key] = $value
  }

  return $values
}

function Resolve-AbsoluteUrl([string]$PageUrl, [string]$Candidate) {
  if ([string]::IsNullOrWhiteSpace($Candidate)) { return $null }
  $decoded = [System.Net.WebUtility]::HtmlDecode($Candidate)
  return ([System.Uri]::new([System.Uri]$PageUrl, $decoded)).AbsoluteUri
}

function Get-JavaScriptAlert([string]$Html) {
  if ([string]::IsNullOrWhiteSpace($Html)) { return '' }

  $match = [regex]::Match(
    $Html,
    '(?is)alert\s*\(\s*([''"])(?<message>.*?)\1\s*\)'
  )

  if (-not $match.Success) { return '' }

  $message = [System.Net.WebUtility]::HtmlDecode($match.Groups['message'].Value)
  $message = $message -replace '\\r\\n|\\n|\\r', ' '
  return $message.Trim()
}

function Get-HtmlTitle([string]$Html) {
  if ([string]::IsNullOrWhiteSpace($Html)) { return '(제목 없음)' }

  $match = [regex]::Match($Html, '(?is)<title[^>]*>\s*(?<title>.*?)\s*</title>')
  if (-not $match.Success) { return '(제목 없음)' }

  $title = [System.Net.WebUtility]::HtmlDecode($match.Groups['title'].Value)
  return (($title -replace '<[^>]+>', ' ') -replace '\s+', ' ').Trim()
}

function Test-IsLoginPage([string]$Html) {
  if ([string]::IsNullOrWhiteSpace($Html)) { return $false }
  return [bool]($Html -match 'MiyaValidator|(?:id|name)=["'']loginForm["'']|forLogin\.do')
}

function Get-ResponsePath($Response) {
  try {
    if ($Response.BaseResponse.ResponseUri) {
      $path = $Response.BaseResponse.ResponseUri.AbsolutePath
      return ($path -replace '(?i);jsessionid=[^/?;]+', ';jsessionid=[REDACTED]')
    }
  } catch {}
  return '(확인 불가)'
}

function Save-SanitizedLoginDiagnostic(
  [string]$Content,
  [string[]]$SensitiveValues
) {
  $sanitized = [string]$Content

  foreach ($sensitiveValue in $SensitiveValues) {
    if (-not [string]::IsNullOrEmpty($sensitiveValue)) {
      $sanitized = $sanitized.Replace($sensitiveValue, '[REDACTED]')
    }
  }

  # 원문 비밀번호뿐 아니라 서버가 만든 해시값과 숨은 로그인 필드도 제거한다.
  foreach ($fieldName in @('username', 'password')) {
    $fieldPattern = '(?is)(<input\b(?=[^>]*\bname\s*=\s*["'']' +
      [regex]::Escape($fieldName) +
      '["''])[^>]*\bvalue\s*=\s*["''])[^"'']*(["''])'
    $sanitized = [regex]::Replace($sanitized, $fieldPattern, '$1[REDACTED]$2')
  }
  $sanitized = [regex]::Replace(
    $sanitized,
    '(?i)\$2[aby]\$[0-9]{2}\$[./0-9A-Za-z]{53}',
    '[REDACTED_BCRYPT]'
  )

  # URL이나 스크립트에 들어간 세션 식별자도 진단 파일에서 제거한다.
  $sanitized = [regex]::Replace(
    $sanitized,
    '(?i)(jsessionid=)[0-9a-z_-]+',
    '$1[REDACTED]'
  )
  $sanitized = [regex]::Replace(
    $sanitized,
    '(?i)(JSESSIONID\s*[=:]\s*)[0-9a-z_-]+',
    '$1[REDACTED]'
  )

  $diagnosticPath = Join-Path $scriptDir 'login-response-sanitized.html'
  $utf8Bom = New-Object System.Text.UTF8Encoding($true)
  [System.IO.File]::WriteAllText($diagnosticPath, $sanitized, $utf8Bom)
  return $diagnosticPath
}

# 설정 파일은 1) 스크립트 폴더, 2) 실행 사용자 홈 순서로 찾는다.
$envCandidates = @(
  (Join-Path $scriptDir '.rooms-sync.env'),
  (Join-Path $HOME '.rooms-sync.env')
) | Select-Object -Unique

$envPath = $envCandidates |
  Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
  Select-Object -First 1

if (-not $envPath) {
  Log ('설정 파일(.rooms-sync.env)을 찾지 못했습니다. 확인 위치: ' + ($envCandidates -join ' | '))
  exit 1
}

Log "설정 파일 사용: $envPath"
$cfg = Read-EnvFile $envPath

$id = if ($cfg.ContainsKey('SWM_ID') -and $cfg['SWM_ID']) {
  $cfg['SWM_ID']
} else {
  $env:SWM_ID
}

$pw = if ($cfg.ContainsKey('SWM_PW') -and $cfg['SWM_PW']) {
  $cfg['SWM_PW']
} else {
  $env:SWM_PW
}

$secret = if ($cfg.ContainsKey('ROOMS_INGEST_SECRET') -and $cfg['ROOMS_INGEST_SECRET']) {
  $cfg['ROOMS_INGEST_SECRET']
} else {
  $env:ROOMS_INGEST_SECRET
}

$ingest = if ($cfg.ContainsKey('INGEST_URL') -and $cfg['INGEST_URL']) {
  $cfg['INGEST_URL']
} elseif ($env:INGEST_URL) {
  $env:INGEST_URL
} else {
  'https://www.asm-dhub.fkii.space/api/rooms/ingest'
}

if ([string]::IsNullOrWhiteSpace($id) -or [string]::IsNullOrWhiteSpace($pw)) {
  Log 'SWM_ID / SWM_PW 값이 필요합니다.'
  exit 1
}

if ([string]::IsNullOrWhiteSpace($secret)) {
  Log 'ROOMS_INGEST_SECRET 값이 필요합니다.'
  exit 1
}

$base = 'https://www.swmaestro.ai/busan/bos'
$origin = 'https://www.swmaestro.ai'
$loginPage = "$base/member/admin/forLogin.do"
$defaultCheckUrl = "$base/member/admin/checkStat2.json"
$defaultLoginPost = "$base/member/admin/toLogin.do"
$listUrl = "$base/item/itemRent/list.do?menuNo=100240"
$today = Get-Date -Format 'yyyy-MM-dd'
$downloadUrl = "$base/item/itemRent/downloadExcel.uxls?menuNo=100240&sdate=$today&edate=$today&searchStat=&searchCnd=1&searchWrd=&pageIndex=1"
$userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
$tempFile = Join-Path $env:TEMP ('rooms-sync-' + [guid]::NewGuid().ToString('N') + '.xls')
$oldDiagnosticFile = Join-Path $scriptDir 'login-response-sanitized.html'

# 이전 실행에서 만든 진단 파일에는 현재 버전보다 덜 가려진 값이 있을 수 있으므로 먼저 정리한다.
if (Test-Path -LiteralPath $oldDiagnosticFile -PathType Leaf) {
  Remove-Item -LiteralPath $oldDiagnosticFile -Force -ErrorAction SilentlyContinue
}

$body = [ordered]@{
  siteName = ''
  loginFlag = ''
  username = $id
  password = $pw
}

$ajaxHeaders = @{
  'Accept' = 'application/json, text/javascript, */*; q=0.01'
  'Referer' = $loginPage
  'Origin' = $origin
  'X-Requested-With' = 'XMLHttpRequest'
}

$formHeaders = @{
  'Accept' = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  'Referer' = $loginPage
  'Origin' = $origin
}

$exitCode = 0

try {
  # 1) 로그인 페이지를 먼저 열어 쿠키와 페이지에 포함된 동적 JSESSIONID URL을 받는다.
  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $loginPageResponse = Invoke-WebRequest -Uri $loginPage -Method Get -WebSession $session `
    -UserAgent $userAgent -UseBasicParsing -TimeoutSec 60

  $loginPageHtml = [string]$loginPageResponse.Content
  if (-not (Test-IsLoginPage $loginPageHtml)) {
    throw ('로그인 페이지 형식이 예상과 다릅니다. 페이지 제목: ' + (Get-HtmlTitle $loginPageHtml))
  }

  # 브라우저가 실제 사용하는 ;jsessionid=... 포함 URL을 HTML에서 추출한다.
  $regexOptions = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  $checkMatch = [regex]::Match(
    $loginPageHtml,
    '["''](?<url>[^"'']*checkStat2\.json(?:;jsessionid=[^"'']*)?)["'']',
    $regexOptions
  )
  $loginMatch = [regex]::Match(
    $loginPageHtml,
    'action\s*=\s*["''](?<url>[^"'']*toLogin\.do(?:;jsessionid=[^"'']*)?)["'']',
    $regexOptions
  )

  $checkUrl = if ($checkMatch.Success) {
    Resolve-AbsoluteUrl $loginPage $checkMatch.Groups['url'].Value
  } else {
    $defaultCheckUrl
  }

  $loginPost = if ($loginMatch.Success) {
    Resolve-AbsoluteUrl $loginPage $loginMatch.Groups['url'].Value
  } else {
    $defaultLoginPost
  }

  if ($checkMatch.Success -and $loginMatch.Success) {
    Log '로그인 페이지의 동적 세션 URL 반영 OK'
  } else {
    Log '! 동적 세션 URL을 모두 찾지 못해 기본 URL과 세션 쿠키를 사용합니다.'
  }

  # 2) 브라우저의 AJAX 사전확인과 동일하게 계정 잠금 상태를 확인한다.
  $checkResponse = Invoke-WebRequest -Uri $checkUrl -Method Post -Body $body `
    -ContentType 'application/x-www-form-urlencoded; charset=UTF-8' `
    -WebSession $session -UserAgent $userAgent -Headers $ajaxHeaders `
    -UseBasicParsing -TimeoutSec 60

  try {
    $checkResult = $checkResponse.Content | ConvertFrom-Json
  } catch {
    throw ('로그인 사전확인 응답이 JSON이 아닙니다. 페이지 제목: ' + (Get-HtmlTitle ([string]$checkResponse.Content)))
  }

  if ([string]$checkResult.resultCode -ne 'success') {
    $lockText = if ($checkResult.lockMin) {
      ' (' + [string]$checkResult.lockMin + '분 후 재시도)'
    } else {
      ''
    }
    throw ('로그인 사전확인 실패 — 계정 잠김 또는 시도 횟수 초과 가능성' + $lockText)
  }

  Log '로그인 사전확인 OK'

  # 3) 같은 세션으로 실제 로그인 폼을 제출한다.
  $loginResponse = Invoke-WebRequest -Uri $loginPost -Method Post -Body $body `
    -ContentType 'application/x-www-form-urlencoded; charset=UTF-8' `
    -WebSession $session -UserAgent $userAgent -Headers $formHeaders `
    -UseBasicParsing -TimeoutSec 60

  $loginHtml = [string]$loginResponse.Content
  $loginTrace = @(
    '<!-- toLogin.do response -->',
    $loginHtml
  )

  # toLogin.do는 인증을 바로 끝내지 않고, 서버에서 해시한 비밀번호가 든
  # gofrm을 반환한 뒤 브라우저의 document.gofrm.submit()으로 login.do에 재전송한다.
  # Invoke-WebRequest는 JavaScript를 실행하지 않으므로 이 폼을 직접 찾아 동일하게 POST한다.
  $handoffFormMatch = [regex]::Match(
    $loginHtml,
    '(?is)<form\b(?=[^>]*\bname\s*=\s*["'']gofrm["''])[^>]*>(?<inner>.*?)</form>'
  )

  if ($handoffFormMatch.Success -and $loginHtml -match '(?is)document\.gofrm\.submit\s*\(') {
    $handoffFormTag = $handoffFormMatch.Value
    $handoffActionMatch = [regex]::Match(
      $handoffFormTag,
      '(?is)<form\b[^>]*\baction\s*=\s*["''](?<url>[^"'']+)["'']'
    )

    if (-not $handoffActionMatch.Success) {
      throw '로그인 후속 폼(gofrm)의 action 주소를 찾지 못했습니다.'
    }

    $handoffUrl = Resolve-AbsoluteUrl $loginPost $handoffActionMatch.Groups['url'].Value
    $handoffUri = [System.Uri]$handoffUrl
    $originUri = [System.Uri]$origin

    if ($handoffUri.Scheme -ne 'https' -or $handoffUri.Host -ne $originUri.Host) {
      throw '로그인 후속 폼이 허용되지 않은 주소를 가리킵니다.'
    }

    $handoffBody = @{}
    $inputMatches = [regex]::Matches(
      $handoffFormMatch.Groups['inner'].Value,
      '(?is)<input\b[^>]*>'
    )

    foreach ($inputMatch in $inputMatches) {
      $inputTag = $inputMatch.Value
      $nameMatch = [regex]::Match(
        $inputTag,
        '(?is)\bname\s*=\s*["''](?<name>[^"'']+)["'']'
      )
      if (-not $nameMatch.Success) { continue }

      $valueMatch = [regex]::Match(
        $inputTag,
        '(?is)\bvalue\s*=\s*["''](?<value>[^"'']*)["'']'
      )
      $fieldValue = if ($valueMatch.Success) {
        [System.Net.WebUtility]::HtmlDecode($valueMatch.Groups['value'].Value)
      } else {
        ''
      }

      $handoffBody[$nameMatch.Groups['name'].Value] = $fieldValue
    }

    if (-not $handoffBody.ContainsKey('username') -or
        -not $handoffBody.ContainsKey('password')) {
      throw '로그인 후속 폼에서 username/password 필드를 찾지 못했습니다.'
    }

    Log '로그인 후속 폼 감지 — login.do 자동 제출'
    $handoffResponse = Invoke-WebRequest -Uri $handoffUrl -Method Post -Body $handoffBody `
      -ContentType 'application/x-www-form-urlencoded; charset=UTF-8' `
      -WebSession $session -UserAgent $userAgent `
      -Headers @{
        'Accept' = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        'Referer' = $loginPost
        'Origin' = $origin
      } `
      -UseBasicParsing -TimeoutSec 60

    # 해시값은 더 이상 필요하지 않으므로 즉시 참조를 비운다.
    $handoffBody['password'] = $null
    $handoffBody = $null

    $loginResponse = $handoffResponse
    $loginHtml = [string]$handoffResponse.Content
    $loginTrace += @(
      '<!-- login.do handoff response -->',
      $loginHtml
    )
  }

  $loginResponseContentType = [string]$loginResponse.Headers['Content-Type']
  $loginAlert = Get-JavaScriptAlert $loginHtml
  $loginKind = if (Test-IsLoginPage $loginHtml) {
    '로그인페이지'
  } elseif ($loginHtml -match '로그아웃|logout|관리자') {
    '관리자페이지'
  } else {
    '중간응답'
  }

  $cookieNames = try {
    (($session.Cookies.GetCookies([uri]$loginPage) |
      ForEach-Object { $_.Name } |
      Sort-Object -Unique) -join ',')
  } catch {
    ''
  }

  Log ('로그인 POST: HTTP {0} / 최종경로 {1} / 쿠키[{2}] / 응답={3}' -f `
      [int]$loginResponse.StatusCode, (Get-ResponsePath $loginResponse), $cookieNames, $loginKind)
  Log ('로그인 응답 본문: {0}자 / Content-Type={1}' -f $loginHtml.Length, $loginResponseContentType)

  if ($loginAlert) {
    Log ('로그인 서버 메시지: ' + $loginAlert)
  }

  # 4) 회의실 목록을 직접 열어 로그인 성공 여부를 최종 판정한다.
  $listResponse = Invoke-WebRequest -Uri $listUrl -Method Get -WebSession $session `
    -UserAgent $userAgent -Headers @{ 'Referer' = $loginPage } `
    -UseBasicParsing -TimeoutSec 60

  $listHtml = [string]$listResponse.Content
  $listAlert = Get-JavaScriptAlert $listHtml
  $listPath = Get-ResponsePath $listResponse

  if ((Test-IsLoginPage $listHtml) -or $listPath -match '/(?:forLogin|toLogin)\.do$') {
    $reason = if ($loginAlert) {
      $loginAlert
    } elseif ($listAlert) {
      $listAlert
    } else {
      '서버가 인증 세션을 만들지 않았습니다. 웹브라우저에서 같은 계정으로 직접 로그인되는지 확인하세요.'
    }

    $diagnosticContent = @(
      ($loginTrace -join "`r`n"),
      '<!-- itemRent/list.do response -->',
      $listHtml
    ) -join "`r`n"
    $diagnosticPath = Save-SanitizedLoginDiagnostic `
      -Content $diagnosticContent `
      -SensitiveValues @($id, $pw, $secret)
    Log ('진단 파일 생성: ' + $diagnosticPath)

    throw ('로그인 실패 — ' + $reason)
  }

  if ($listHtml -notmatch '회의실|예약|로그아웃|logout') {
    throw ('목록 페이지가 예상과 다릅니다. 제목: ' + (Get-HtmlTitle $listHtml) + ' / 경로: ' + $listPath)
  }

  Log '로그인·회의실 목록 진입 OK'

  # 5) 오늘 예약 현황 엑셀을 내려받는다.
  Log "다운로드 ($today) ..."
  Invoke-WebRequest -Uri $downloadUrl -Method Get -WebSession $session `
    -UserAgent $userAgent -Headers @{ 'Referer' = $listUrl } `
    -OutFile $tempFile -UseBasicParsing -TimeoutSec 60 | Out-Null

  if (-not (Test-Path -LiteralPath $tempFile -PathType Leaf)) {
    throw '다운로드 파일이 생성되지 않았습니다.'
  }

  $bytes = [System.IO.File]::ReadAllBytes($tempFile)
  $isExcel = ($bytes.Length -ge 2) -and (
    (($bytes[0] -eq 0x50) -and ($bytes[1] -eq 0x4B)) -or
    (($bytes[0] -eq 0xD0) -and ($bytes[1] -eq 0xCF))
  )

  if (-not $isExcel) {
    $head = ''
    try {
      $head = [System.Text.Encoding]::UTF8.GetString(
        $bytes,
        0,
        [Math]::Min(1200, $bytes.Length)
      )
    } catch {}

    if (Test-IsLoginPage $head) {
      throw '다운로드 시점에 로그인 세션이 만료됐거나 거부되어 로그인 페이지가 반환됐습니다.'
    }

    throw ('다운로드 응답이 엑셀 형식이 아닙니다. 응답 제목: ' + (Get-HtmlTitle $head))
  }

  Log ('다운로드 OK (' + $bytes.Length + ' bytes)')

  # 6) 수신 엔드포인트로 업로드한다.
  Log "업로드 -> $ingest"
  $uploadResponse = Invoke-RestMethod -Uri $ingest -Method Post -InFile $tempFile `
    -ContentType 'application/vnd.ms-excel' `
    -Headers @{
      'x-ingest-secret' = $secret
      'x-file-name' = "rooms_$today.xls"
    } `
    -TimeoutSec 60

  Log ('완료: ' + ($uploadResponse | ConvertTo-Json -Compress))
} catch {
  Log ('! 실패: ' + $_.Exception.Message)
  $exitCode = 1
} finally {
  if (Test-Path -LiteralPath $tempFile -PathType Leaf) {
    Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
  }
}

exit $exitCode
