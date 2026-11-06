# Windows Core Audio endpoint control. No key toggles: every write is read back.
# API: https://learn.microsoft.com/en-us/windows/win32/api/endpointvolume/nn-endpointvolume-iaudioendpointvolume
[CmdletBinding()]
param(
    [ValidateSet('status', 'mute', 'unmute', 'set-volume', 'devices')]
    [string]$Action = 'status',
    [ValidateRange(0, 100)]
    [double]$Volume = 0,
    [ValidateSet('output', 'input')]
    [string]$Device = 'output',
    [ValidateSet('console', 'multimedia', 'communications')]
    [string]$Role = 'multimedia',
    [string]$EndpointId = ''
)
$ErrorActionPreference = 'Stop'
if ($Action -eq 'set-volume' -and -not $PSBoundParameters.ContainsKey('Volume')) {
    throw 'set-volume requires -Volume from 0 to 100.'
}

if (-not ('Breadboard.PcAudio' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace Breadboard {
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    internal class DeviceEnumerator {}

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IDeviceEnumerator {
        [PreserveSig] int EnumAudioEndpoints(int flow, uint state, out IDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IDevice device);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IDeviceCollection {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IDevice {
        [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
        [PreserveSig] int OpenPropertyStore(uint access, out IntPtr store);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IEndpointVolume {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr callback);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr callback);
        [PreserveSig] int GetChannelCount(out uint count);
        [PreserveSig] int SetMasterVolumeLevel(float level, IntPtr context);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, IntPtr context);
        [PreserveSig] int GetMasterVolumeLevel(out float level);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint channel, float level, IntPtr context);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, IntPtr context);
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float level);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, IntPtr context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    public class AudioState {
        public string EndpointId;
        public bool Muted;
        public double Volume;
        public bool Verified;
        public string Action;
        public string Device;
        public string Role;
    }

    public static class PcAudio {
        public static string[] Devices(int flow) {
            IDeviceEnumerator enumerator = null;
            IDeviceCollection devices = null;
            try {
                enumerator = (IDeviceEnumerator)new DeviceEnumerator();
                Marshal.ThrowExceptionForHR(enumerator.EnumAudioEndpoints(flow, 1, out devices));
                uint count;
                Marshal.ThrowExceptionForHR(devices.GetCount(out count));
                string[] ids = new string[count];
                for (uint index = 0; index < count; index++) {
                    IDevice device = null;
                    try {
                        Marshal.ThrowExceptionForHR(devices.Item(index, out device));
                        Marshal.ThrowExceptionForHR(device.GetId(out ids[index]));
                    } finally { if (device != null) Marshal.ReleaseComObject(device); }
                }
                return ids;
            } finally {
                if (devices != null) Marshal.ReleaseComObject(devices);
                if (enumerator != null) Marshal.ReleaseComObject(enumerator);
            }
        }

        public static AudioState Run(string action, double volume, int flow, int role, string endpointId) {
            if (action != "status" && action != "mute" && action != "unmute" && action != "set-volume")
                throw new ArgumentException("Unknown audio action.");
            if (double.IsNaN(volume) || double.IsInfinity(volume) || volume < 0 || volume > 100)
                throw new ArgumentOutOfRangeException("volume");
            if (!String.IsNullOrEmpty(endpointId) && Array.IndexOf(Devices(flow), endpointId) < 0)
                throw new ArgumentException("The endpoint is not an active device of the requested input/output kind.");
            IDeviceEnumerator enumerator = null;
            IDevice device = null;
            object endpoint = null;
            try {
                enumerator = (IDeviceEnumerator)new DeviceEnumerator();
                if (String.IsNullOrEmpty(endpointId))
                    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(flow, role, out device));
                else
                    Marshal.ThrowExceptionForHR(enumerator.GetDevice(endpointId, out device));
                string id;
                Marshal.ThrowExceptionForHR(device.GetId(out id));
                Guid iid = typeof(IEndpointVolume).GUID;
                Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out endpoint));
                var audio = (IEndpointVolume)endpoint;
                if (action == "mute" || action == "unmute")
                    Marshal.ThrowExceptionForHR(audio.SetMute(action == "mute", IntPtr.Zero));
                if (action == "set-volume")
                    Marshal.ThrowExceptionForHR(audio.SetMasterVolumeLevelScalar((float)(volume / 100), IntPtr.Zero));
                bool muted;
                float level;
                Marshal.ThrowExceptionForHR(audio.GetMute(out muted));
                Marshal.ThrowExceptionForHR(audio.GetMasterVolumeLevelScalar(out level));
                if ((action == "mute" && !muted) || (action == "unmute" && muted) ||
                    (action == "set-volume" && Math.Abs(level * 100 - volume) > 0.5))
                    throw new InvalidOperationException("Windows audio readback did not match the requested state.");
                return new AudioState { EndpointId = id, Muted = muted,
                    Volume = Math.Round(level * 100, 2), Verified = true, Action = action,
                    Device = flow == 0 ? "output" : "input",
                    Role = new string[] { "console", "multimedia", "communications" }[role] };
            } finally {
                if (endpoint != null) Marshal.ReleaseComObject(endpoint);
                if (device != null) Marshal.ReleaseComObject(device);
                if (enumerator != null) Marshal.ReleaseComObject(enumerator);
            }
        }
    }
}
'@
}
$flow = if ($Device -eq 'input') { 1 } else { 0 }
$roleIndex = @{ console = 0; multimedia = 1; communications = 2 }[$Role]
if ($Action -eq 'devices') {
    @{ Device = $Device; EndpointIds = @([Breadboard.PcAudio]::Devices($flow)); Verified = $true } | ConvertTo-Json -Compress
} else {
    [Breadboard.PcAudio]::Run($Action, $Volume, $flow, $roleIndex, $EndpointId) | ConvertTo-Json -Compress
}
