import { expect, it } from "vitest";
import { analyseLatency, latencyProbe, LATENCY_GAP } from "../src/latency";
const sent = Array.from({ length: 7 }, (_, i) => 0.6 + i * LATENCY_GAP);
function capture(
  rate = 48000,
  delays = Array(7).fill(137) as (number | null)[],
  gain = 0.3,
  echo = 0,
) {
  const start = 0.123;
  const samples = new Float32Array(Math.ceil(12 * rate));
  let seed = 123;
  for (let i = 0; i < samples.length; i++) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    samples[i] = (seed / 2 ** 32 - 0.5) * 0.0008;
  }
  delays.forEach((delay, index) => {
    if (delay === null) return;
    const probe = latencyProbe(rate, index);
    const at = Math.round((sent[index] + delay / 1000 - start) * rate);
    for (let i = 0; i < probe.length; i++) {
      samples[at + i] += probe[i] * gain;
      if (echo)
        samples[at + i + Math.round(0.12 * rate)] += probe[i] * gain * echo;
    }
  });
  return { samples, start };
}
it.each([44100, 48000])(
  "measures and independently verifies a noisy inverted signal at %s Hz",
  (rate) => {
    const input = capture(rate, undefined, -0.3);
    const result = analyseLatency(input.samples, rate, input.start, sent);
    expect(result.offsetMs).toBe(140);
    expect(result.detected).toBe(7);
    expect(result.verificationMs).toBeLessThanOrEqual(4);
    expect(result.spreadMs).toBeLessThanOrEqual(1);
  },
);
it("tolerates one missed signal in each phase and weak echoes", () => {
  const input = capture(
    48000,
    [137, 138, null, 136, 137, null, 138],
    0.3,
    0.08,
  );
  expect(analyseLatency(input.samples, 48000, input.start, sent)).toMatchObject(
    { offsetMs: 140, detected: 5 },
  );
});
it("rejects silence, unrelated noise, and missing verification instead of enabling timing", () => {
  for (const delays of [
    Array(7).fill(null),
    [137, 137, 137, 137, null, null, null],
  ]) {
    const input = capture(48000, delays);
    expect(() =>
      analyseLatency(input.samples, 48000, input.start, sent),
    ).toThrow(/Not enough clear/);
  }
});
it("rejects unstable delay and a repeatable but different verification delay", () => {
  for (const delays of [
    [110, 140, 130, 170, 140, 140, 140],
    [137, 137, 137, 137, 190, 190, 190],
  ]) {
    const input = capture(48000, delays);
    expect(() =>
      analyseLatency(input.samples, 48000, input.start, sent),
    ).toThrow(/not stable/);
  }
});
it("rejects competing strong echoes and clipped input", () => {
  const echo = capture(48000, undefined, 0.3, 0.95);
  expect(() => analyseLatency(echo.samples, 48000, echo.start, sent)).toThrow(
    /Not enough clear/,
  );
  const clipped = new Float32Array(48000).fill(1);
  expect(() => analyseLatency(clipped, 48000, 0, sent)).toThrow(/clipping/);
});
it("handles a long Bluetooth-like delay without accepting signals beyond the measurement range", () => {
  const long = capture(48000, Array(7).fill(780));
  expect(analyseLatency(long.samples, 48000, long.start, sent).offsetMs).toBe(
    780,
  );
  const outside = capture(48000, Array(7).fill(1150));
  expect(() =>
    analyseLatency(outside.samples, 48000, outside.start, sent),
  ).toThrow(/Not enough clear/);
});
