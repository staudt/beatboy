/** MIDI velocity (1..127) → linear gain with a gentle power curve. */
export function velocityToGain(vel: number): number {
  const v = Math.min(127, Math.max(1, vel));
  return (v / 127) ** 1.6;
}
