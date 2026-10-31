package memory

// OCR 脚本正文（Windows WinRT）；放共享文件因为 Start 里要把它落盘，
// 非 Windows 平台也要能编译（脚本只是不会被用到）。
//
// 注意：
//   - 这个字符串会被 os.WriteFile 裸写到 memory/ocr.ps1——
//     千万不要走 writeAtomic（会 JSON 化，实测踩过）；
//   - 脚本体内不要写中文注释（PS5.1 对无 BOM 文件按 ANSI 读，实测踩过）；
//   - text 走 BASE64（PS5.1 stdout 编码随控制台状态漂移，实测踩过）。
//
// 协议：stdin 每行一个 PNG 绝对路径 → stdout 每行一个 JSON
//（{textB64, lang}）；EXIT 退出。常驻进程，WinRT 只初始化一次。

const ocrScript = `param()
$ErrorActionPreference = 'Stop'
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.RandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + "`" + `1' })[0]
function Await($WinRtTask, $ResultType) {
    $netTask = $asTaskGeneric.MakeGenericMethod($ResultType).Invoke($null, @($WinRtTask))
    $null = $netTask.Wait(-1)
    $netTask.Result
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) {
    $first = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | Select-Object -First 1
    if ($first) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($first) }
}
if (-not $engine) {
    # 无语言包：文本永远为空（截图照存），每次请求都回 NOLANG
    while ($true) {
        $line = [Console]::In.ReadLine()
        if (-not $line -or $line -eq 'EXIT') { break }
        Write-Output 'NOLANG'
    }
    exit 0
}

while ($true) {
    $line = [Console]::In.ReadLine()
    if (-not $line -or $line -eq 'EXIT') { break }
    try {
        $bytes = [System.IO.File]::ReadAllBytes($line)
        $ms = New-Object System.IO.MemoryStream (, $bytes)
        $stream = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)
        $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
        $textB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($result.Text))
        @{ textB64 = $textB64; lang = $engine.RecognizerLanguage.LanguageTag } | ConvertTo-Json -Compress
    } catch {
        $inner = $_.Exception
        while ($inner.InnerException) { $inner = $inner.InnerException }
        @{ textB64 = ''; err = $inner.Message } | ConvertTo-Json -Compress
    }
}
`
