/** Conservative starting point from room noise and the weakest deliberate impulse. */
export function suggestedClapSensitivity(noise: number, impulse: number, current: number): number {
  if (!Number.isFinite(noise) || !Number.isFinite(impulse) || impulse <= 0) return current;
  for (let step = 4; step <= 18; step++) {
    const sensitivity = step / 20;
    if (Math.max(.002 + (1 - sensitivity) * .016, noise * (8 - sensitivity * 5)) <= impulse * .4) return sensitivity;
  }
  return .9;
}
