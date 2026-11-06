# Native Windows PDF rasterizer. No browser/file-association dependency.
# https://learn.microsoft.com/uwp/api/windows.data.pdf.pdfpage.rendertostreamasync
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
$null = [Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]

function Wait-WindowsOperation($Operation, [Type]$ResultType) {
    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and
        $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    if (-not $task.Wait(30000)) { $Operation.Cancel(); throw 'Windows PDF operation timed out before printing.' }
    $task.Result
}

function Open-WindowsPdf([string]$FilePath) {
    $storageFile = Wait-WindowsOperation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($FilePath)) ([Windows.Storage.StorageFile])
    $document = Wait-WindowsOperation ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($storageFile)) ([Windows.Data.Pdf.PdfDocument])
    if ($document.PageCount -lt 1 -or $document.PageCount -gt 200) {
        throw 'Native PDF printing supports 1..200 pages per request.'
    }
    $document
}

function Export-WindowsPdfPages($Document, [string]$Directory) {
    for ($index = 0; $index -lt $Document.PageCount; $index++) {
        $page = $Document.GetPage([uint32]$index)
        $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
        try {
            $options = New-Object Windows.Data.Pdf.PdfPageRenderOptions
            # 200 dpi for normal documents, bounded for unusually large pages.
            $scale = [Math]::Min(200 / 96, 4000 / [Math]::Max($page.Size.Width, $page.Size.Height))
            $options.DestinationWidth = [uint32][Math]::Max(1, $page.Size.Width * $scale)
            $action = $page.RenderToStreamAsync($stream, $options)
            $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
                $_.Name -eq 'AsTask' -and -not $_.IsGenericMethod -and
                $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
            } | Select-Object -First 1
            $task = $asTask.Invoke($null, @($action))
            if (-not $task.Wait(30000)) { $action.Cancel(); throw 'Windows PDF rendering timed out before printing.' }
            $stream.Seek(0)
            $inputStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
            $target = Join-Path $Directory ($index.ToString() + '.png')
            $outputStream = [IO.File]::Create($target)
            try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose() }
            $target
        } finally { $stream.Dispose(); $page.Dispose() }
    }
}
