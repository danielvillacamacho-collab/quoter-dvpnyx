param(
  [Parameter(Mandatory = $true)]
  [string]$ApiBase,

  [string]$Token = "",
  [string]$Email = "",
  [string]$Password = "",
  [int]$TimeoutSec = 30
)

$ErrorActionPreference = "Stop"
$ApiBase = $ApiBase.TrimEnd("/")

function Invoke-Json {
  param(
    [string]$Method,
    [string]$Path,
    [object]$Body = $null,
    [switch]$Auth
  )

  $headers = @{ "content-type" = "application/json" }
  if ($Auth) {
    if (-not $script:Token) { throw "Missing token for authenticated request $Method $Path" }
    $headers["authorization"] = "Bearer $script:Token"
  }

  $params = @{
    Method = $Method
    Uri = "$ApiBase$Path"
    Headers = $headers
    TimeoutSec = $TimeoutSec
  }
  if ($null -ne $Body) {
    $params.Body = ($Body | ConvertTo-Json -Depth 20)
  }

  $started = Get-Date
  try {
    $response = Invoke-RestMethod @params
    $elapsed = [int]((Get-Date) - $started).TotalMilliseconds
    return @{ ok = $true; status = 200; elapsed = $elapsed; body = $response }
  } catch {
    $elapsed = [int]((Get-Date) - $started).TotalMilliseconds
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    return @{ ok = $false; status = $status; elapsed = $elapsed; error = $_.Exception.Message }
  }
}

if (-not $Token -and $Email -and $Password) {
  $login = Invoke-Json -Method "POST" -Path "/api/auth/login" -Body @{ email = $Email; password = $Password }
  if (-not $login.ok -or -not $login.body.token) {
    throw "Login failed against $ApiBase/api/auth/login"
  }
  $Token = $login.body.token
}

$script:Token = $Token

$tests = @(
  @{ name = "platform health";       method = "GET"; path = "/api/health"; auth = $false },
  @{ name = "platform me";           method = "GET"; path = "/api/auth/me"; auth = $true },
  @{ name = "clients";               method = "GET"; path = "/api/clients?limit=1"; auth = $true },
  @{ name = "crm contacts";          method = "GET"; path = "/api/contacts?limit=1"; auth = $true },
  @{ name = "employees";             method = "GET"; path = "/api/employees?limit=1"; auth = $true },
  @{ name = "opportunities";         method = "GET"; path = "/api/opportunities?limit=1"; auth = $true },
  @{ name = "quotations";            method = "GET"; path = "/api/quotations?limit=1"; auth = $true },
  @{ name = "contracts";             method = "GET"; path = "/api/contracts?limit=1"; auth = $true },
  @{ name = "resource requests";     method = "GET"; path = "/api/resource-requests?limit=1"; auth = $true },
  @{ name = "assignments";           method = "GET"; path = "/api/assignments?limit=1"; auth = $true },
  @{ name = "capacity";              method = "GET"; path = "/api/capacity/planner"; auth = $true },
  @{ name = "time entries";          method = "GET"; path = "/api/time-entries?limit=1"; auth = $true },
  @{ name = "revenue";               method = "GET"; path = "/api/revenue?limit=1"; auth = $true },
  @{ name = "reports utilization";   method = "GET"; path = "/api/reports/utilization"; auth = $true },
  @{ name = "project portfolio";     method = "GET"; path = "/api/projects/portfolio-health"; auth = $true },
  @{ name = "internal initiatives";  method = "GET"; path = "/api/internal-initiatives?limit=1"; auth = $true }
)

$failed = 0
foreach ($test in $tests) {
  $result = Invoke-Json -Method $test.method -Path $test.path -Auth:([bool]$test.auth)
  $mark = if ($result.ok) { "OK " } else { "FAIL" }
  "{0} {1,-22} {2,4} {3,6}ms {4} {5}" -f $mark, $test.name, $result.status, $result.elapsed, $test.method, $test.path
  if (-not $result.ok) {
    $failed += 1
    "     $($result.error)"
  }
}

if ($failed -gt 0) {
  throw "$failed smoke tests failed"
}

"All smoke tests passed."
