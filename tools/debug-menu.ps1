$chrome = Start-Process 'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe' -ArgumentList @(
  '--headless=new',
  '--disable-gpu',
  '--remote-debugging-port=9222',
  '--user-data-dir=C:\Users\reneh\AppData\Local\Temp\potzloats-cdp',
  'file:///C:/Users/reneh/OneDrive/Documenten/Codex-app/index.html'
) -PassThru

Start-Sleep -Milliseconds 1500
$version = Invoke-RestMethod 'http://127.0.0.1:9222/json/version'
$wsUri = [Uri]$version.webSocketDebuggerUrl
$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$cts = [System.Threading.CancellationTokenSource]::new()
$ws.ConnectAsync($wsUri, $cts.Token).GetAwaiter().GetResult()

$script:id = 0

function Send-Cdp {
  param(
    [string]$Method,
    [hashtable]$Params = @{}
  )

  $script:id++
  $payload = @{
    id = $script:id
    method = $Method
    params = $Params
  } | ConvertTo-Json -Compress -Depth 20

  $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
  $segment = [System.ArraySegment[byte]]::new($bytes)
  $null = $ws.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).GetAwaiter().GetResult()

  $buffer = New-Object byte[] 65536
  $stream = New-Object System.IO.MemoryStream

  do {
    $recvSeg = [System.ArraySegment[byte]]::new($buffer)
    $result = $ws.ReceiveAsync($recvSeg, $cts.Token).GetAwaiter().GetResult()
    $stream.Write($buffer, 0, $result.Count)
  } until ($result.EndOfMessage)

  $json = [System.Text.Encoding]::UTF8.GetString($stream.ToArray())
  return $json | ConvertFrom-Json -Depth 50
}

Send-Cdp 'Runtime.enable' | Out-Null
Send-Cdp 'Page.enable' | Out-Null
Start-Sleep -Milliseconds 1000

$openMenu = Send-Cdp 'Runtime.evaluate' @{
  expression = @"
(() => {
  const trigger = document.querySelector('.menu-panel__trigger');
  trigger.click();
  return {
    menuOpen: document.querySelector('.menu-panel')?.classList.contains('is-open'),
    menuHidden: document.querySelector('.menu-panel__content')?.hidden,
    authHidden: document.querySelector('#auth-modal')?.hidden,
    accountText: document.querySelector('#account-toggle')?.innerText
  };
})()
"@
  returnByValue = $true
}

$clickLogin = Send-Cdp 'Runtime.evaluate' @{
  expression = @"
(() => {
  const btn = document.querySelector('#account-toggle');
  const rect = btn.getBoundingClientRect();
  const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  btn.click();
  return {
    topTag: top?.tagName,
    topId: top?.id || '',
    topClass: top?.className || '',
    menuOpen: document.querySelector('.menu-panel')?.classList.contains('is-open'),
    menuHidden: document.querySelector('.menu-panel__content')?.hidden,
    authHidden: document.querySelector('#auth-modal')?.hidden,
    authDisplay: getComputedStyle(document.querySelector('#auth-modal')).display,
    authStatus: document.querySelector('#auth-status')?.textContent || ''
  };
})()
"@
  returnByValue = $true
}

$nativeClick = Send-Cdp 'Runtime.evaluate' @{
  expression = @"
(() => {
  window.__debugClicked = false;
  document.querySelector('#account-toggle')?.addEventListener('click', () => {
    window.__debugClicked = true;
  }, { once: true });
  const btn = document.querySelector('#account-toggle');
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  return {
    clicked: window.__debugClicked,
    authHidden: document.querySelector('#auth-modal')?.hidden,
    menuOpen: document.querySelector('.menu-panel')?.classList.contains('is-open')
  };
})()
"@
  returnByValue = $true
}

'OPEN_MENU'
$openMenu.result.value | ConvertTo-Json -Depth 20
'CLICK_LOGIN'
$clickLogin.result.value | ConvertTo-Json -Depth 20
'NATIVE_CLICK'
$nativeClick.result.value | ConvertTo-Json -Depth 20

$ws.Dispose()
Stop-Process -Id $chrome.Id -Force
