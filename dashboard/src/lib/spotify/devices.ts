export interface SpotifyConnectDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  isRestricted: boolean;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function connectDevice(value: unknown): SpotifyConnectDevice | null {
  const device = objectRecord(value);
  const id = typeof device?.id === "string" ? device.id.trim() : "";
  const name = typeof device?.name === "string" ? device.name.trim() : "";
  const type = typeof device?.type === "string" ? device.type.trim() : "";
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(id) || !name || !type) return null;
  return {
    id,
    name: name.slice(0, 200),
    type: type.toLowerCase(),
    isActive: device?.is_active === true,
    isRestricted: device?.is_restricted === true,
  };
}

export function spotifyConnectDevices(payload: unknown): SpotifyConnectDevice[] {
  const record = objectRecord(payload);
  const devices = Array.isArray(record?.devices) ? record.devices : [];
  return devices.map(connectDevice)
    .filter((device): device is SpotifyConnectDevice => device !== null)
    .filter((device, index, all) => all.findIndex(item => item.id === device.id) === index);
}

/**
 * Pick the phone Spotify can actually control, preferring the currently active
 * phone when an account exposes more than one mobile Connect device.
 */
export function selectSpotifyPhoneDevice(
  payload: unknown,
): SpotifyConnectDevice | null {
  const phones = spotifyConnectDevices(payload)
    .filter(
      (device): device is SpotifyConnectDevice =>
        device !== null &&
        device.type === "smartphone" &&
        !device.isRestricted,
    );
  return phones.find((device) => device.isActive) ?? phones[0] ?? null;
}
