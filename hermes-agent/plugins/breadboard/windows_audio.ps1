# Windows Core Audio endpoint control. No key toggles: every write is read back.
# API: https://learn.microsoft.com/en-us/windows/win32/api/endpointvolume/nn-endpointvolume-iaudioendpointvolume
[CmdletBinding()]
param(
    [ValidateSet('status', 'mute', 'unmute', 'set-volume')]
    [string]$Action = 'status',
    [ValidateRange(0, 100)]
    [double]$Volume = 0
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
        [PreserveSig] int EnumAudioEndpoints(int flow, uint state, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IDevice device);
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
    }

    public static class PcAudio {
        public static AudioState Run(string action, double volume) {
            if (action != "status" && action != "mute" && action != "unmute" && action != "set-volume")
                throw new ArgumentException("Unknown audio action.");
            if (double.IsNaN(volume) || double.IsInfinity(volume) || volume < 0 || volume > 100)
                throw new ArgumentOutOfRangeException("volume");
            IDeviceEnumerator enumerator = null;
            IDevice device = null;
            object endpoint = null;
            try {
                enumerator = (IDeviceEnumerator)new DeviceEnumerator();
                // eRender, eMultimedia: the PC's default playback endpoint.
                Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
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
                    Volume = Math.Round(level * 100, 2), Verified = true, Action = action };
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
[Breadboard.PcAudio]::Run($Action, $Volume) | ConvertTo-Json -Compress
