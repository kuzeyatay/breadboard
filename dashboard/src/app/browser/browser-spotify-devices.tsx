"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, Laptop, MonitorSpeaker, RefreshCw, Smartphone, Speaker, Tablet, Tv, X } from "lucide-react";
import type { SpotifyConnectDevice } from "@/lib/spotify/devices";

function DeviceIcon({ type }: { type: string }) {
  const Icon = type === "smartphone" ? Smartphone : type === "tablet" ? Tablet
    : type === "tv" ? Tv : type === "speaker" ? Speaker
      : type === "computer" ? Laptop : MonitorSpeaker;
  return <Icon aria-hidden="true" />;
}

export function BrowserSpotifyDevices({ activeDeviceId, localDeviceId, busy, error, onSelect, onBack, onClose }: {
  activeDeviceId: string | null;
  localDeviceId: string | null;
  busy: boolean;
  error: string;
  onSelect: (device: SpotifyConnectDevice) => Promise<boolean>;
  onBack: () => void;
  onClose: () => void;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  const [devices, setDevices] = useState<SpotifyConnectDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => { backRef.current?.focus(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/browser/spotify?view=devices", {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || "Could not load Spotify devices.");
        if (!cancelled) { setDevices(payload.devices ?? []); setLoadError(""); }
      } catch (reason) {
        if (!cancelled) setLoadError(reason instanceof Error ? reason.message : "Could not load Spotify devices.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; controller.abort(); };
  }, [revision]);

  const refresh = () => { setLoading(true); setLoadError(""); setRevision(value => value + 1); };
  const select = async (device: SpotifyConnectDevice) => {
    setPendingId(device.id);
    setNotice("");
    try {
      if (await onSelect(device)) setNotice(`Selected ${device.name}.`);
    } finally { setPendingId(null); }
  };

  return (
    <div className="browser-spotify-devices">
      <header className="browser-spotify-devices-header">
        <button ref={backRef} type="button" onClick={onBack} aria-label="Back to Spotify player"><ChevronLeft aria-hidden="true" /></button>
        <div><h2>Listen on</h2><p>Choose a Spotify device</p></div>
        <button type="button" onClick={onClose} aria-label="Close Spotify"><X aria-hidden="true" /></button>
      </header>
      <div className="browser-spotify-device-list" aria-label="Available Spotify devices" aria-busy={loading}>
        {devices.map(device => {
          const active = activeDeviceId ? device.id === activeDeviceId : device.isActive;
          const name = device.id === localDeviceId ? "Breadboard" : device.name;
          return (
            <button key={device.id} type="button" className="browser-spotify-device-option" aria-pressed={active}
              disabled={busy || pendingId !== null || device.isRestricted} onClick={() => { if (!active) void select({ ...device, name }); }}>
              <DeviceIcon type={device.type} />
              <span><strong>{name}</strong><small>{pendingId === device.id ? "Connecting…" : device.isRestricted ? "Unavailable for control" : active ? "Current device" : device.id === localDeviceId ? "This computer" : "Spotify Connect"}</small></span>
              {active ? <Check aria-hidden="true" /> : null}
            </button>
          );
        })}
        {loading ? <p className="browser-spotify-device-status" role="status">Finding devices…</p> : !devices.length && !loadError ? <p className="browser-spotify-device-status">No devices found yet.</p> : null}
      </div>
      <footer className="browser-spotify-devices-footer">
        {loadError || error ? <p role="alert">{loadError || error}</p> : null}
        <span className="sr-only" role="status">{notice}</span>
        <p>Open Spotify on your phone, TV, or speaker and sign in to the same account. Then refresh to find it here.</p>
        <button type="button" disabled={loading || busy || pendingId !== null} onClick={refresh}><RefreshCw aria-hidden="true" />{loadError ? "Try again" : "Refresh devices"}</button>
      </footer>
    </div>
  );
}
