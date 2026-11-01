import { it, expect } from "vitest";
import {
  analysePitch,
  pitchWindowSize,
  PITCH_POLL_MS,
} from "../src/pitch-analysis";
import { PitchStability } from "../src/pitch-stability";

for (const rate of [44100, 48000, 96000]) {
  for (const pitches of [
    [38, 45, 40],
    [60, 67, 62],
  ]) {
    it(`tracks 120 ms ${pitches[0] === 38 ? "bass" : "alto"} notes at ${rate} Hz`, () => {
      const window = pitchWindowSize(rate),
        filter = new PitchStability();
      const firstSeen = pitches.map(() => Infinity);
      const start = 0.1,
        duration = 0.12;
      for (let now = 0.02; now < 0.5; now += PITCH_POLL_MS / 1000) {
        const buffer = Float32Array.from({ length: window }, (_, i) => {
          const t = now - (window - 1 - i) / rate;
          const index = Math.floor((t - start) / duration);
          if (index < 0 || index >= pitches.length) return 0;
          const f = 440 * 2 ** ((pitches[index] - 69) / 12);
          const phase = t - start - index * duration;
          const envelope = Math.min(1, phase / 0.008);
          return (
            envelope *
            (0.15 * Math.sin(2 * Math.PI * f * phase) +
              0.05 * Math.sin(4 * Math.PI * f * phase))
          );
        });
        const result = filter.filter(
          analysePitch(buffer, rate, now - window / (2 * rate)),
          true,
        );
        const current = Math.floor((now - start) / duration);
        if (
          current >= 0 &&
          current < pitches.length &&
          result.midi !== null &&
          Math.abs(result.midi - pitches[current]) < 0.15
        )
          firstSeen[current] = Math.min(
            firstSeen[current],
            now - (start + current * duration),
          );
      }
      // Includes the analysis window and stability gate, excludes browser AEC,
      // microphone/hardware latency, worker delivery and UI rendering.
      firstSeen.forEach((delay) => expect(delay).toBeLessThan(0.1));
    });
  }
}
it("does not detect pitch in a short silent window", () => {
  const result = analysePitch(
    new Float32Array(pitchWindowSize(48000)),
    48000,
    0,
  );
  expect(result.midi).toBeNull();
});
