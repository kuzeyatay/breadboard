# Document printing through Windows drivers or the registered document handler.
# A submitted job is not evidence that paper has physically left the printer.
[CmdletBinding()]
param(
    [ValidateSet('printers', 'jobs', 'cancel', 'print')][string]$Action = 'printers',
    [string]$Path,
    [string]$PrinterName,
    [ValidateRange(1, 100)][int]$Copies = 1,
    [ValidateRange(1, 2147483647)][int]$JobId,
    [string]$OutputPath,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Get-InstalledPrinters {
    # CIM supplies default/offline/port evidence as well as the exact queue name.
    @(Get-CimInstance -ClassName Win32_Printer -OperationTimeoutSec 15 |
        Select-Object Name, Default, WorkOffline, PrinterStatus, DriverName, PortName)
}

$printers = @(Get-InstalledPrinters)
if ($Action -eq 'printers') {
    @{ Printers = $printers; Verified = $true } | ConvertTo-Json -Depth 4 -Compress
    return
}
if ($PrinterName) {
    $selected = @($printers | Where-Object { $_.Name -eq $PrinterName })
} else {
    $selected = @($printers | Where-Object Default)
}
if ($selected.Count -ne 1) {
    throw 'Select one installed printer by its exact Name from the printers action; no unique default printer was found.'
}
$printer = $selected[0]
$PrinterName = $printer.Name
if ($Action -eq 'jobs') {
    $jobs = @(Get-PrintJob -PrinterName $PrinterName |
        Select-Object ID, DocumentName, JobStatus, SubmittedTime, TotalPages, PagesPrinted)
    @{ PrinterName = $PrinterName; Jobs = $jobs; Verified = $true } | ConvertTo-Json -Depth 4 -Compress
    return
}
if ($Action -eq 'cancel') {
    if (-not $PSBoundParameters.ContainsKey('JobId')) { throw 'cancel requires -JobId.' }
    Get-PrintJob -PrinterName $PrinterName -ID $JobId -ErrorAction Stop | Out-Null
    Remove-PrintJob -PrinterName $PrinterName -ID $JobId -ErrorAction Stop
    $remaining = @(Get-PrintJob -PrinterName $PrinterName | Where-Object ID -EQ $JobId)
    if ($remaining.Count) { throw 'Windows still reports the print job after cancellation; check jobs again.' }
    @{ PrinterName = $PrinterName; JobId = $JobId; Status = 'cancelled'; Verified = $true } | ConvertTo-Json -Compress
    return
}
if (-not $Path) { throw 'print requires -Path to an existing local document.' }
$file = Get-Item -LiteralPath $Path -ErrorAction Stop
if ($file.PSIsContainer -or $file.PSProvider.Name -ne 'FileSystem') { throw 'The print target must be a file.' }
$extension = $file.Extension.ToLowerInvariant()
$textExtensions = @('.txt', '.log', '.csv', '.md')
$imageExtensions = @('.png', '.jpg', '.jpeg', '.bmp', '.gif', '.tif', '.tiff')
$documentExtensions = @('.pdf', '.doc', '.docx', '.rtf', '.odt', '.xls', '.xlsx', '.ppt', '.pptx')
$native = $extension -eq '.pdf' -or $extension -in ($textExtensions + $imageExtensions)
if (-not $native -and $extension -notin $documentExtensions) {
    throw 'Unsupported print format. Use text, Markdown, CSV, a raster image, PDF, or an Office document.'
}
if ($file.Length -gt 100MB) { throw 'This print helper supports documents up to 100 MB.' }
if ($printer.WorkOffline) { throw "The printer '$PrinterName' is offline. No job was submitted." }
if ($OutputPath) {
    if (-not $native -or $printer.DriverName -ne 'Microsoft Print To PDF') {
        throw '-OutputPath is supported for PDF/text/images using the Microsoft Print to PDF driver.'
    }
    $OutputPath = [IO.Path]::GetFullPath($OutputPath)
    if ([IO.Path]::GetExtension($OutputPath) -ne '.pdf') { throw '-OutputPath must end in .pdf.' }
    if (Test-Path -LiteralPath $OutputPath) { throw 'The output file already exists; choose a new output path.' }
    if (-not (Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($OutputPath)) -PathType Container)) {
        throw 'The output directory does not exist.'
    }
} elseif ($printer.PortName -match '^(PORTPROMPT:|FILE:)$' -or $printer.DriverName -match 'Print To PDF|XPS|OneNote|Fax') {
    throw 'This virtual printer requires interactive output. For PDF/text/images choose Microsoft Print to PDF and supply -OutputPath; use document export for other formats.'
}

$backend = if ($native) { 'windows-driver' } else { 'registered-printto-handler' }
if ($native) {
    $settings = New-Object Drawing.Printing.PrinterSettings
    $settings.PrinterName = $PrinterName
    if (-not $settings.IsValid) { throw 'The printer is unavailable.' }
    if ($Copies -gt $settings.MaximumCopies) { throw 'The printer does not support that many copies.' }
}
if ($extension -in $imageExtensions) {
    # Decode before creating a spool job so a corrupt image never prints blank.
    $probeImage = [Drawing.Image]::FromFile($file.FullName)
    $probeImage.Dispose()
}
if ($extension -eq '.pdf') {
    . (Join-Path $PSScriptRoot 'windows_pdf.ps1')
    $pdf = Open-WindowsPdf $file.FullName
    $backend = 'windows-pdf-driver'
}
if (-not $native) {
    if ($Copies -ne 1) { throw 'Registered document handlers support one copy per request; use the application print dialog for multiple copies.' }
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $file.FullName
    $startInfo.UseShellExecute = $true
    if ('printto' -notin $startInfo.Verbs) {
        throw "No PrintTo handler is installed for $extension. Open the file in its application and use its print dialog, or install a handler supporting printing to a named printer. No job was submitted."
    }
}
if ($CheckOnly) {
    @{ Status = 'ready'; Submitted = $false; CanPrint = $true; Path = $file.FullName;
        PrinterName = $PrinterName; Copies = $Copies; Backend = $backend; OutputPath = $OutputPath;
        PageCount = $(if ($extension -eq '.pdf') { $pdf.PageCount } else { $null }) } |
        ConvertTo-Json -Compress
    return
}

if ($native) {
    if (-not ('Breadboard.DocumentPrinter' -as [type])) {
        Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Printing;
using System.IO;

namespace Breadboard {
    public static class DocumentPrinter {
        public static void Print(string path, string printer, short copies, string output, bool text, string[] pages) {
            using (PrintDocument document = new PrintDocument()) {
                document.PrinterSettings.PrinterName = printer;
                if (!document.PrinterSettings.IsValid) throw new InvalidOperationException("The printer is unavailable.");
                if (copies > document.PrinterSettings.MaximumCopies) throw new InvalidOperationException("The printer does not support that many copies.");
                document.PrinterSettings.Copies = copies;
                document.DocumentName = Path.GetFileName(path);
                document.PrintController = new StandardPrintController();
                if (!String.IsNullOrEmpty(output)) {
                    document.PrinterSettings.PrintToFile = true;
                    document.PrinterSettings.PrintFileName = output;
                }
                if (text) {
                    string remaining = File.ReadAllText(path);
                    using (Font font = new Font("Consolas", 10)) {
                        document.PrintPage += delegate(object sender, PrintPageEventArgs e) {
                            int characters, lines;
                            e.Graphics.MeasureString(remaining, font, e.MarginBounds.Size,
                                StringFormat.GenericTypographic, out characters, out lines);
                            if (remaining.Length > 0 && characters == 0)
                                throw new InvalidOperationException("The printable area is too small for this text.");
                            e.Graphics.DrawString(remaining.Substring(0, characters), font, Brushes.Black,
                                e.MarginBounds, StringFormat.GenericTypographic);
                            remaining = remaining.Substring(characters);
                            e.HasMorePages = remaining.Length > 0;
                        };
                        document.Print();
                    }
                } else {
                    string[] images = pages ?? new string[] { path };
                    int pageIndex = 0;
                    int frameIndex = 0;
                    document.PrintPage += delegate(object sender, PrintPageEventArgs e) {
                        using (Image image = Image.FromFile(images[pageIndex])) {
                            bool paged = Array.IndexOf(image.FrameDimensionsList, System.Drawing.Imaging.FrameDimension.Page.Guid) >= 0;
                            int frames = paged ? image.GetFrameCount(System.Drawing.Imaging.FrameDimension.Page) : 1;
                            if (paged) image.SelectActiveFrame(System.Drawing.Imaging.FrameDimension.Page, frameIndex);
                            float scale = Math.Min((float)e.MarginBounds.Width / image.Width,
                                (float)e.MarginBounds.Height / image.Height);
                            e.Graphics.DrawImage(image, e.MarginBounds.Left, e.MarginBounds.Top,
                                image.Width * scale, image.Height * scale);
                            if (++frameIndex >= frames) { frameIndex = 0; pageIndex++; }
                        }
                        e.HasMorePages = pageIndex < images.Length;
                    };
                    document.Print();
                }
            }
        }
    }
}
'@
    }
    $renderDirectory = $null
    try {
        $pages = $null
        if ($extension -eq '.pdf') {
            $renderDirectory = Join-Path ([IO.Path]::GetTempPath()) ('breadboard-print-' + [Guid]::NewGuid().ToString('N'))
            [IO.Directory]::CreateDirectory($renderDirectory) | Out-Null
            $pages = [string[]]@(Export-WindowsPdfPages $pdf $renderDirectory)
        }
        [Breadboard.DocumentPrinter]::Print($file.FullName, $PrinterName, $Copies, $OutputPath, ($extension -in $textExtensions), $pages)
    } finally {
        if ($renderDirectory -and [IO.Directory]::Exists($renderDirectory)) {
            # Only direct files in our newly-created private directory; never recurse.
            foreach ($rendered in [IO.Directory]::GetFiles($renderDirectory)) { [IO.File]::Delete($rendered) }
            [IO.Directory]::Delete($renderDirectory)
        }
    }
} else {
    # Exact installed queue name is a data argument, never a command expression.
    if ($PrinterName.Contains('"')) { throw 'The printer name cannot contain a double quote.' }
    $startInfo.Verb = 'printto'
    $startInfo.Arguments = '"' + $PrinterName + '"'
    $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $process = [Diagnostics.Process]::Start($startInfo)
    if ($null -ne $process) { $process.Dispose() }
}
if ($OutputPath) {
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    $outputVerified = $false
    do {
        if (Test-Path -LiteralPath $OutputPath) {
            try {
                $stream = [IO.File]::OpenRead($OutputPath)
                try {
                    $header = New-Object byte[] 5
                    $count = $stream.Read($header, 0, 5)
                    if ($count -eq 5 -and [Text.Encoding]::ASCII.GetString($header) -eq '%PDF-') {
                        $tail = New-Object byte[] ([Math]::Min(1024, $stream.Length))
                        $null = $stream.Seek(-$tail.Length, [IO.SeekOrigin]::End)
                        $null = $stream.Read($tail, 0, $tail.Length)
                        if ([Text.Encoding]::ASCII.GetString($tail) -match '%%EOF\s*$') { $outputVerified = $true; break }
                    }
                } finally { $stream.Dispose() }
            } catch [IO.IOException] { }
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not $outputVerified) {
        throw 'Print was submitted, but the PDF output could not be verified. Check the queue before retrying to avoid duplicates.'
    }
    @{ Status = 'output-created'; Submitted = $true; Verified = $true; OutputPath = $OutputPath;
        PrinterName = $PrinterName; Path = $file.FullName; Backend = $backend } | ConvertTo-Json -Compress
} else {
    @{ Status = $(if ($native) { 'submitted' } else { 'handed-to-application' }); Submitted = $true;
        Verified = $false; PrinterName = $PrinterName; Path = $file.FullName; Copies = $Copies; Backend = $backend;
        Note = 'Physical completion is unverified. Check jobs; a missing job can already have completed. Do not automatically retry.' } |
        ConvertTo-Json -Compress
}
