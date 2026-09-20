export function formatDuration(minutes: number, locale = "en-US"): string {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours.toLocaleString(locale)} hr`)
  if (remainder > 0 || hours === 0) parts.push(`${remainder.toLocaleString(locale)} min`)
  return parts.join(" ")
}
