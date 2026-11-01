import { it, expect } from "vitest";
import { PitchStability } from "../src/pitch-stability";
const frame = (
  midi: number | null,
  time: number,
  confidence = 0.99,
  rms = 0.02,
) => ({ midi, time, confidence, rms });
it("rejects isolated octave spikes but accepts a sustained real leap", () => {
  const filter = new PitchStability();
  expect(filter.filter(frame(48, 0), true).midi).toBeNull();
  expect(filter.filter(frame(48, 0.02), true).midi).toBe(48);
  expect(filter.filter(frame(48, 0.11), true).midi).toBe(48);
  expect(filter.filter(frame(60, 0.165), true).midi).toBeNull();
  expect(filter.filter(frame(48, 0.22), true).midi).toBe(48);
  expect(filter.filter(frame(60, 0.275), true).midi).toBeNull();
  expect(filter.filter(frame(60, 0.33), true).midi).toBe(60);
  expect(filter.filter(frame(60, 0.385), true).midi).toBe(60);
});
it("preserves vibrato and off-target pitches without correcting them", () => {
  const filter = new PitchStability();
  [0, 0.055, 0.11].forEach((t) => filter.filter(frame(49, t), true));
  expect(filter.filter(frame(49.4, 0.165), true).midi).toBe(49.4);
  expect(filter.filter(frame(48.7, 0.22), true).midi).toBe(48.7);
});
it("leaves weak, unstable and low-confidence samples unassessed", () => {
  const filter = new PitchStability();
  const inputs = [
    frame(48, 0, 0.7),
    frame(48, 0.055, 0.99, 0.001),
    frame(48, 0.11),
    frame(60, 0.165),
    frame(53, 0.22),
    frame(null, 0.275),
  ];
  expect(inputs.every((f) => filter.filter(f, true).midi === null)).toBe(true);
});
it("leaves headphone capture unchanged", () => {
  const f = frame(48, 0);
  expect(new PitchStability().filter(f, false)).toBe(f);
});

it("recovers immediately after a brief uncertain consonant without retaining stale pitch during silence", () => {
  const filter = new PitchStability();
  filter.filter(frame(48, 0), true);
  filter.filter(frame(48, 0.02), true);
  expect(filter.filter(frame(null, 0.04), true).midi).toBeNull();
  expect(filter.filter(frame(48, 0.06), true).midi).toBe(48);
  filter.filter(frame(null, 0.3), true);
  expect(filter.filter(frame(48, 0.32), true).midi).toBeNull();
  expect(filter.filter(frame(48, 0.34), true).midi).toBe(48);
});

it("does not confirm a new pitch using a stale candidate after a capture gap", () => {
  const filter = new PitchStability();
  expect(filter.filter(frame(48, 0), true).midi).toBeNull();
  expect(filter.filter(frame(48, 1), true).midi).toBeNull();
  expect(filter.filter(frame(48, 1.02), true).midi).toBe(48);
});
