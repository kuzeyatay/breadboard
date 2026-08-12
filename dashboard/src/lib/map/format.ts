// Presentation of verified numbers.
//
// The router's metres and seconds are the fact; these are the words for it. The
// formatting happens here, once, so the model quotes a phrase Breadboard
// produced from the router's own value instead of converting the number itself
// — which is where "1834 metres" quietly becomes "about 25 minutes on foot".

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "unknown distance";
  if (meters < 950) return `${Math.round(meters / 10) * 10} m`;
  const kilometres = meters / 1000;
  return `${kilometres < 10 ? kilometres.toFixed(1) : Math.round(kilometres)} km`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "unknown duration";
  const total = Math.round(seconds / 60);
  if (total < 1) return "under a minute";
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

export function formatBearingFreeSummary(input: {
  distanceMeters: number;
  durationSeconds: number;
  mode: string;
}): string {
  const verb =
    input.mode === "walking"
      ? "on foot"
      : input.mode === "cycling"
        ? "by bike"
        : "by car";
  return `${formatDistance(input.distanceMeters)} and ${formatDuration(
    input.durationSeconds,
  )} ${verb}`;
}
