import { detectPitchYin } from "./vendor/openvox/core/audio/pitchDetector";

export const PITCH_POLL_MS = 20;
// About 43–46 ms at common audio rates, still >2 periods of low A1.
export function pitchWindowSize(rate: number) {
  return Math.min(
    32768,
    Math.max(2048, 2 ** Math.ceil(Math.log2(rate * 0.042))),
  );
}
export function analysePitch(buffer: Float32Array, rate: number, time: number) {
  let power = 0;
  for (const x of buffer) power += x * x;
  const rms = Math.sqrt(power / buffer.length);
  const pitch = detectPitchYin(buffer, rate);
  return {
    time,
    rms,
    midi: pitch ? 69 + 12 * Math.log2(pitch.frequency / 440) : null,
    confidence: pitch?.confidence || 0,
  };
}
