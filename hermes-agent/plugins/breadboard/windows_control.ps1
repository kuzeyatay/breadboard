# Bounded Windows operations, invoked through Breadboard's existing Terminal
# capability/approval path. Read help before choosing an operation.
[CmdletBinding()]
param(
    [ValidateSet('help', 'audio', 'printers', 'print', 'print-jobs', 'cancel-print',
        'brightness', 'set-brightness', 'displays', 'battery', 'clipboard-read',
        'clipboard-write', 'open-file', 'reveal-file', 'settings')]
    [string]$Action = 'help',
    [ValidateSet('status', 'mute', 'unmute', 'set-volume', 'devices')][string]$AudioAction = 'status',
    [ValidateSet('output', 'input')][string]$Device = 'output',
    [ValidateSet('console', 'multimedia', 'communications')][string]$Role = 'multimedia',
    [string]$EndpointId,
    [ValidateRange(0, 100)][double]$Volume,
    [ValidateRange(0, 100)][byte]$Brightness,
    [string]$MonitorId,
    [string]$Path,
    [string]$PrinterName,
    [ValidateRange(1, 100)][int]$Copies = 1,
    [ValidateRange(1, 2147483647)][int]$JobId,
    [string]$OutputPath,
    [switch]$CheckOnly,
    [AllowEmptyString()][string]$Text,
    [ValidateSet('display', 'sound', 'printers', 'bluetooth', 'network-wifi',
        'apps-volume', 'privacy-microphone', 'privacy-webcam', 'powersleep')]
    [string]$SettingsPage = 'display'
)
$ErrorActionPreference = 'Stop'
function Write-Result($value) { $value | ConvertTo-Json -Depth 6 -Compress }

switch ($Action) {
    'help' {
        Write-Result @{
            Actions = @{
                audio = '-AudioAction status|devices|mute|unmute|set-volume; -Volume 0..100 for set-volume; -Device output|input; optional -Role console|multimedia|communications or -EndpointId from devices. Writes are read back.'
                printers = 'List installed printer names, default/offline state and driver.'
                print = '-Path <local file> [-PrinterName <exact name>] [-Copies 1..100] [-CheckOnly]. PDF/text/images use Windows drivers (PDF: 1..200 pages, 200 dpi). Office requires a registered PrintTo handler; otherwise open the file and use its application print dialog. -OutputPath <new.pdf> supports PDF/text/images with Microsoft Print to PDF. Call -CheckOnly before submitting. Allow 120..300 seconds for long documents. Do not retry an uncertain submission.'
                'print-jobs' = '[-PrinterName <exact name>]: inspect queued jobs. Absence does not prove failure.'
                'cancel-print' = '-PrinterName <exact name> -JobId <id>: cancel that queued job and read back.'
                brightness = 'List supported built-in displays and current brightness; external displays without WMI support are reported unavailable.'
                'set-brightness' = '-Brightness 0..100 [-MonitorId <exact InstanceName>]; select a monitor if more than one. Writes are read back.'
                displays = 'List display names, bounds, working area and primary flag.'
                battery = 'Read AC/battery charge and remaining lifetime.'
                'clipboard-read' = 'Read text only when the user requests clipboard access.'
                'clipboard-write' = '-Text <text>: replace clipboard text and read back.'
                'open-file' = '-Path <document>: open in its registered application.'
                'reveal-file' = '-Path <file or directory>: select it in Explorer.'
                settings = '-SettingsPage display|sound|printers|bluetooth|network-wifi|apps-volume|privacy-microphone|privacy-webcam|powersleep: open the requested settings page.'
            }
            Evidence = 'Use Verified readback for state changes. A launched app is not a completed task, and submitted printing is not physical completion.'
        }
        return
    }
    'audio' {
        $arguments = @{ Action = $AudioAction; Device = $Device; Role = $Role }
        if ($PSBoundParameters.ContainsKey('Volume')) { $arguments.Volume = $Volume }
        if ($EndpointId) { $arguments.EndpointId = $EndpointId }
        & (Join-Path $PSScriptRoot 'windows_audio.ps1') @arguments
        return
    }
    { $_ -in @('printers', 'print', 'print-jobs', 'cancel-print') } {
        $arguments = @{ Action = @{ printers = 'printers'; print = 'print'; 'print-jobs' = 'jobs'; 'cancel-print' = 'cancel' }[$Action] }
        foreach ($parameter in @('Path', 'PrinterName', 'Copies', 'JobId', 'OutputPath', 'CheckOnly')) {
            if ($PSBoundParameters.ContainsKey($parameter)) { $arguments[$parameter] = $PSBoundParameters[$parameter] }
        }
        & (Join-Path $PSScriptRoot 'windows_print.ps1') @arguments
        return
    }
    { $_ -in @('brightness', 'set-brightness') } {
        try {
            $monitors = @(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -OperationTimeoutSec 15 |
                Where-Object Active | Select-Object InstanceName, CurrentBrightness, Levels, Level)
        } catch [Microsoft.Management.Infrastructure.CimException] {
            if ($Action -eq 'brightness' -and $_.Exception.StatusCode -in @('InvalidClass', 'NotSupported')) {
                Write-Result @{ Supported = $false; Monitors = @(); Verified = $true; Reason = 'This display does not expose Windows WMI brightness control.' }
                return
            }
            throw
        }
        if ($Action -eq 'brightness') {
            Write-Result @{ Supported = ($monitors.Count -gt 0); Monitors = $monitors; Verified = $true }
            return
        }
        if (-not $PSBoundParameters.ContainsKey('Brightness')) { throw 'set-brightness requires -Brightness 0..100.' }
        if ($MonitorId) { $monitors = @($monitors | Where-Object InstanceName -EQ $MonitorId) }
        if ($monitors.Count -ne 1) { throw 'Select one supported display with -MonitorId from the brightness action.' }
        $monitor = $monitors[0]
        if ($Brightness -notin $monitor.Level) { throw 'This display does not support that brightness; choose a value from its Level list.' }
        $methods = @(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -OperationTimeoutSec 15 |
            Where-Object InstanceName -EQ $monitor.InstanceName)
        if ($methods.Count -ne 1) { throw 'The selected display does not expose brightness control.' }
        $result = Invoke-CimMethod -InputObject $methods[0] -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]0; Brightness = $Brightness }
        # Some WMI display drivers expose this method as void, others return a
        # status code. The final brightness readback is authoritative in both.
        if ($null -ne $result -and $result.PSObject.Properties['ReturnValue'] -and $result.ReturnValue -ne 0) {
            throw "Windows rejected the brightness change: $($result.ReturnValue)."
        }
        $readback = $null
        for ($attempt = 0; $attempt -lt 10; $attempt++) {
            $readback = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -OperationTimeoutSec 15 |
                Where-Object InstanceName -EQ $monitor.InstanceName
            if ($readback.CurrentBrightness -eq $Brightness) { break }
            Start-Sleep -Milliseconds 100
        }
        if ($readback.CurrentBrightness -ne $Brightness) { throw 'Brightness readback did not match the requested value.' }
        Write-Result @{ MonitorId = $monitor.InstanceName; Brightness = $readback.CurrentBrightness; Verified = $true }
        return
    }
    'displays' {
        Add-Type -AssemblyName System.Windows.Forms
        Write-Result @{ Displays = @([Windows.Forms.Screen]::AllScreens | ForEach-Object {
            @{ Name = $_.DeviceName; Primary = $_.Primary;
                Bounds = @{ X = $_.Bounds.X; Y = $_.Bounds.Y; Width = $_.Bounds.Width; Height = $_.Bounds.Height };
                WorkingArea = @{ X = $_.WorkingArea.X; Y = $_.WorkingArea.Y; Width = $_.WorkingArea.Width; Height = $_.WorkingArea.Height } }
        }); Verified = $true }
        return
    }
    'battery' {
        Add-Type -AssemblyName System.Windows.Forms
        $power = [Windows.Forms.SystemInformation]::PowerStatus
        $available = ($power.BatteryChargeStatus -ne 'NoSystemBattery' -and $power.BatteryChargeStatus -ne 'Unknown')
        Write-Result @{ PowerLineStatus = $power.PowerLineStatus.ToString(); BatteryPresent = $available;
            ChargePercent = $(if ($available -and $power.BatteryLifePercent -le 1) { [Math]::Round($power.BatteryLifePercent * 100) } else { $null });
            RemainingSeconds = $(if ($power.BatteryLifeRemaining -ge 0) { $power.BatteryLifeRemaining } else { $null }); Verified = $true }
        return
    }
    { $_ -in @('clipboard-read', 'clipboard-write') } {
        Add-Type -AssemblyName System.Windows.Forms
        if ($Action -eq 'clipboard-write' -and -not $PSBoundParameters.ContainsKey('Text')) { throw 'clipboard-write requires -Text.' }
        for ($attempt = 0; $attempt -lt 5; $attempt++) {
            try {
                if ($Action -eq 'clipboard-write') {
                    if ($Text.Length) { [Windows.Forms.Clipboard]::SetText($Text) } else { [Windows.Forms.Clipboard]::Clear() }
                }
                $value = [Windows.Forms.Clipboard]::GetText()
                break
            } catch {
                if ($attempt -eq 4) { throw }
                Start-Sleep -Milliseconds 100
            }
        }
        if ($Action -eq 'clipboard-write' -and $value -cne $Text) { throw 'Clipboard readback did not match the requested text.' }
        Write-Result @{ Text = $value; Verified = $true }
        return
    }
    { $_ -in @('open-file', 'reveal-file') } {
        if (-not $Path) { throw "$Action requires -Path." }
        $file = Get-Item -LiteralPath $Path -ErrorAction Stop
        if ($file.PSProvider.Name -ne 'FileSystem') { throw 'Select a filesystem path.' }
        if ($Action -eq 'open-file') {
            if ($file.PSIsContainer -or $file.Extension.ToLowerInvariant() -notin @('.pdf', '.txt', '.md', '.csv', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.rtf', '.odt', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff')) {
                throw 'open-file supports documents and images. Use reveal-file for folders.'
            }
            Start-Process -FilePath $file.FullName
        } else {
            Start-Process -FilePath (Join-Path $env:SystemRoot 'explorer.exe') -ArgumentList ('/select,"' + $file.FullName + '"')
        }
        Write-Result @{ Status = 'launched'; Path = $file.FullName; Verified = $false }
        return
    }
    'settings' {
        Start-Process -FilePath ('ms-settings:' + $SettingsPage)
        Write-Result @{ Status = 'launched'; SettingsPage = $SettingsPage; Verified = $false }
        return
    }
}
