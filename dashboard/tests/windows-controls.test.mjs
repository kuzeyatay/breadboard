import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { executeTerminalCommand } from "../scripts/runtime-v2-terminal-command-worker.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const helper = path.join(root, "hermes-agent/plugins/breadboard/windows_control.ps1");
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const windows = { skip: process.platform !== "win32", timeout: 120_000 };

async function run(args, { allowFailure = false } = {}) {
  return runCommand(`& ${quote(helper)} ${args}`, { allowFailure });
}

async function runCommand(command, { allowFailure = false } = {}) {
  const result = await executeTerminalCommand({ identity: { jobId: "windows-controls-test" }, request: {
    command,
    workspaceRoot: root,
    maxRuntimeMs: 45_000,
  } }, new AbortController().signal, { checkpoint() {} });
  if (allowFailure) return result;
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.timedOut, false);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

test("Windows control help, displays, battery and printer discovery execute through the real worker", windows, async () => {
  const help = await run("-Action help");
  assert.ok(help.Actions.print);
  const displays = await run("-Action displays");
  assert.equal(displays.Verified, true);
  assert.ok(displays.Displays.every((display) => display.Bounds.Width > 0));
  const battery = await run("-Action battery");
  assert.equal(battery.Verified, true);
  assert.equal(typeof battery.BatteryPresent, "boolean");
  const printers = await run("-Action printers");
  assert.equal(printers.Verified, true);
  assert.ok(Array.isArray(printers.Printers));
});

// Explicit acceptance mode briefly changes real hardware and always restores it.
// Ordinary test runs are read-only except for printing to an isolated PDF file.
const hardware = { ...windows, skip: process.platform !== "win32" || process.env.BREADBOARD_TEST_WINDOWS_HARDWARE !== "1" };

test("Windows mute/unmute and volume writes read back correctly and restore the original state", hardware, async () => {
  const state = await runCommand(`$h = ${quote(helper)}
$before = & $h -Action audio | ConvertFrom-Json
try {
  $muted = & $h -Action audio -AudioAction mute -EndpointId $before.EndpointId | ConvertFrom-Json
  $zero = & $h -Action audio -AudioAction set-volume -Volume 0 -EndpointId $before.EndpointId | ConvertFrom-Json
  $unmuted = & $h -Action audio -AudioAction unmute -EndpointId $before.EndpointId | ConvertFrom-Json
  & $h -Action audio -AudioAction mute -EndpointId $before.EndpointId | Out-Null
  @{Muted=$muted.Muted; Volume=$zero.Volume; Unmuted=$unmuted.Muted; Verified=($muted.Verified -and $zero.Verified -and $unmuted.Verified)} | ConvertTo-Json -Compress
} finally {
  & $h -Action audio -AudioAction set-volume -Volume $before.Volume -EndpointId $before.EndpointId | Out-Null
  $restore = if ($before.Muted) {'mute'} else {'unmute'}
  & $h -Action audio -AudioAction $restore -EndpointId $before.EndpointId | Out-Null
}`);
  assert.equal(state.Muted, true);
  assert.equal(state.Unmuted, false);
  assert.equal(state.Volume, 0);
  assert.equal(state.Verified, true);
});

test("Windows brightness writes are verified and the original level is restored", hardware, async (t) => {
  const available = await run("-Action brightness");
  if (!available.Supported) { t.skip("No display with WMI brightness support"); return; }
  const state = await runCommand(`$h = ${quote(helper)}
$before = (& $h -Action brightness | ConvertFrom-Json).Monitors[0]
$target = @($before.Level | Where-Object { $_ -gt 10 -and $_ -ne $before.CurrentBrightness } | Sort-Object { [Math]::Abs($_ - $before.CurrentBrightness) })[0]
try {
  & $h -Action set-brightness -Brightness $target -MonitorId $before.InstanceName
} finally {
  & $h -Action set-brightness -Brightness $before.CurrentBrightness -MonitorId $before.InstanceName | Out-Null
}`);
  assert.equal(state.Verified, true);
  const restored = await run("-Action brightness");
  assert.equal(restored.Monitors[0].CurrentBrightness, available.Monitors[0].CurrentBrightness);
});

test("Windows clipboard text survives Unicode and restores prior clipboard formats", hardware, async () => {
  const state = await runCommand(`Add-Type -AssemblyName System.Windows.Forms
$before = [Windows.Forms.Clipboard]::GetDataObject()
$saved = New-Object Windows.Forms.DataObject
if ($before) { foreach ($format in $before.GetFormats($false)) { $saved.SetData($format, $before.GetData($format)) } }
$probe = 'Breadboard clipboard test — İstanbul 日本語'
try {
  & ${quote(helper)} -Action clipboard-write -Text $probe
} finally {
  if ([Windows.Forms.Clipboard]::GetText() -ceq $probe) { [Windows.Forms.Clipboard]::SetDataObject($saved, $true) }
}`);
  assert.equal(state.Text, "Breadboard clipboard test — İstanbul 日本語");
  assert.equal(state.Verified, true);
});

test("audio enumerates real output/input endpoints and reads back their state", windows, async () => {
  for (const device of ["output", "input"]) {
    const devices = await run(`-Action audio -AudioAction devices -Device ${device}`);
    assert.ok(Array.isArray(devices.EndpointIds));
    for (const id of devices.EndpointIds) {
      const state = await run(`-Action audio -Device ${device} -EndpointId ${quote(id)}`);
      assert.equal(state.EndpointId, id);
      assert.equal(state.Verified, true);
      assert.equal(typeof state.Muted, "boolean");
      assert.ok(state.Volume >= 0 && state.Volume <= 100);
    }
  }
});

test("invalid and missing Windows control inputs fail before changes", windows, async () => {
  for (const args of [
    "-Action audio -AudioAction set-volume",
    "-Action audio -AudioAction set-volume -Volume 101",
    "-Action set-brightness",
    "-Action clipboard-write",
    "-Action print",
    "-Action settings -SettingsPage invalid-page",
    "-Action open-file -Path C:/Windows/System32/cmd.exe",
  ]) {
    const result = await run(args, { allowFailure: true });
    assert.notEqual(result.exitCode, 0, args);
    assert.ok(result.stderr.length > 0, args);
  }
});

test("document and Settings launch arguments preserve literal paths and stay on allowed pages", windows, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-open-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const document = path.join(directory, "literal ' [name].txt");
  fs.writeFileSync(document, "launch fixture");
  for (const action of ["open-file", "reveal-file", "settings"]) {
    const args = action === "settings" ? "-SettingsPage sound" : `-Path ${quote(document)}`;
    const launch = await runCommand(`function Start-Process { param($FilePath, $ArgumentList) $global:breadboardLaunchProbe = @{FilePath=$FilePath; ArgumentList=$ArgumentList} }
& ${quote(helper)} -Action ${action} ${args} | Out-Null
$global:breadboardLaunchProbe | ConvertTo-Json -Compress`);
    if (action === "open-file") assert.equal(launch.FilePath, document);
    if (action === "reveal-file") assert.equal(launch.ArgumentList, `/select,"${document}"`);
    if (action === "settings") assert.equal(launch.FilePath, "ms-settings:sound");
  }
});

test("print cancellation addresses only the selected job and verifies queue removal", windows, async () => {
  const result = await runCommand(`$global:breadboardJobs = @(12,13)
function Get-CimInstance { [pscustomobject]@{Name='Test queue'; Default=$true; WorkOffline=$false} }
function Get-PrintJob {
  [CmdletBinding()]param($PrinterName,$ID)
  if ($PrinterName -ne 'Test queue') { throw 'wrong printer' }
  foreach ($job in $global:breadboardJobs) {
    if (-not $PSBoundParameters.ContainsKey('ID') -or $job -eq $ID) { [pscustomobject]@{ID=$job; DocumentName='fixture'} }
  }
}
function Remove-PrintJob {
  [CmdletBinding()]param($PrinterName,$ID)
  if ($PrinterName -ne 'Test queue' -or $ID -ne 12) { throw 'wrong job' }
  $global:breadboardJobs = @($global:breadboardJobs | Where-Object { $_ -ne $ID })
}
$result = & ${quote(helper)} -Action cancel-print -PrinterName 'Test queue' -JobId 12 | ConvertFrom-Json
@{Result=$result; Remaining=$global:breadboardJobs} | ConvertTo-Json -Depth 4 -Compress`);
  assert.equal(result.Result.Status, "cancelled");
  assert.equal(result.Result.Verified, true);
  assert.deepEqual(result.Remaining, [13]);
});

test("native print preflight creates no job/output, and the Windows PDF driver creates a real PDF", windows, async (t) => {
  const printers = await run("-Action printers");
  const printer = printers.Printers.find((item) => item.DriverName === "Microsoft Print To PDF" && !item.WorkOffline);
  if (!printer) { t.skip("Microsoft Print to PDF is not installed"); return; }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-print-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, "document ' [1] İstanbul.txt");
  const output = path.join(directory, "printed.pdf");
  fs.writeFileSync(source, "Breadboard Windows printing acceptance test\n".repeat(100), "utf8");
  const args = `-Action print -Path ${quote(source)} -PrinterName ${quote(printer.Name)} -OutputPath ${quote(output)}`;
  const preflight = await run(`${args} -CheckOnly`);
  assert.equal(preflight.CanPrint, true);
  assert.equal(preflight.Submitted, false);
  assert.equal(fs.existsSync(output), false);
  const printed = await run(args);
  assert.equal(printed.Status, "output-created");
  assert.equal(printed.Verified, true);
  assert.equal(printed.Path, source);
  const bytes = fs.readFileSync(output);
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert.ok(bytes.length > 500);
  const duplicate = await run(args, { allowFailure: true });
  assert.notEqual(duplicate.exitCode, 0);
  assert.match(duplicate.stderr, /already exists/);
  assert.deepEqual(fs.readFileSync(output), bytes);
  const reprinted = path.join(directory, "reprinted.pdf");
  const pdfArgs = `-Action print -Path ${quote(output)} -PrinterName ${quote(printer.Name)} -OutputPath ${quote(reprinted)}`;
  const pdfPreflight = await run(`${pdfArgs} -CheckOnly`);
  assert.equal(pdfPreflight.Backend, "windows-pdf-driver");
  assert.ok(pdfPreflight.PageCount >= 2, "multi-page text fixture must produce several pages");
  assert.equal(fs.existsSync(reprinted), false);
  const pdfPrinted = await run(pdfArgs);
  assert.equal(pdfPrinted.Verified, true);
  const printedPreflight = await run(`-Action print -Path ${quote(reprinted)} -PrinterName ${quote(printer.Name)} -OutputPath ${quote(path.join(directory, "unused.pdf"))} -CheckOnly`);
  assert.equal(printedPreflight.PageCount, pdfPreflight.PageCount, "printing a PDF must preserve every page");
  const jobs = await run(`-Action print-jobs -PrinterName ${quote(printer.Name)}`);
  assert.ok(Array.isArray(jobs.Jobs));
  assert.equal(jobs.Verified, true);
});
