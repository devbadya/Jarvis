/**
 * Loudness of one analyser frame, 0 when the buffer is silence and 1 when it
 * is fully driven. `speechSynthesis` does not report this; the microphone does.
 */
export function levelFromTimeDomain(samples: Uint8Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (const sample of samples) {
    const centered = (sample - 128) / 128
    sum += centered * centered
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * 2.4)
}
