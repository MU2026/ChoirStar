export const LATENCY_SIGNALS = 7;
export const LATENCY_GAP = 1.5;
export const LATENCY_WINDOW = 1;
const ANALYSIS_RATE = 8000;

export interface LatencyResult {
  offsetMs: number;
  spreadMs: number;
  verificationMs: number;
  detected: number;
}

/** A short, softly windowed sweep distinguishes our probe from speech/noise. */
export function latencyProbe(rate: number, signal: number) {
  const samples = new Float32Array(Math.round(rate * 0.07));
  const low = 900 + (signal % 3) * 170;
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    const phase = 2 * Math.PI * (low * t + (900 * t * t) / (2 * 0.07));
    samples[i] =
      0.12 * Math.sin(phase) * Math.sin((Math.PI * i) / samples.length) ** 2;
  }
  return samples;
}

function downsample(samples: Float32Array, rate: number) {
  const output = new Float32Array(
    Math.floor((samples.length * ANALYSIS_RATE) / rate),
  );
  for (let i = 0; i < output.length; i++) {
    const from = Math.floor((i * rate) / ANALYSIS_RATE);
    const to = Math.min(
      samples.length,
      Math.floor(((i + 1) * rate) / ANALYSIS_RATE),
    );
    let sum = 0;
    for (let j = from; j < to; j++) sum += samples[j];
    output[i] = sum / Math.max(1, to - from);
  }
  return output;
}
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Match recorded probes on the audio clock, then verify with separate probes. */
export function analyseLatency(
  samples: Float32Array,
  rate: number,
  captureStart: number,
  sent: number[],
): LatencyResult {
  if (
    samples.reduce(
      (count, value) => count + (Math.abs(value) >= 0.99 ? 1 : 0),
      0,
    ) >
    samples.length * 0.001
  )
    throw new Error(
      "The microphone signal is clipping. Reduce the volume or input gain and try again.",
    );
  const audio = downsample(samples, rate);
  const energy = new Float64Array(audio.length + 1);
  for (let i = 0; i < audio.length; i++)
    energy[i + 1] = energy[i] + audio[i] ** 2;
  const delays: (number | null)[] = sent.map((time, signal) => {
    const probe = downsample(latencyProbe(rate, signal), rate);
    const probeEnergy = probe.reduce((sum, v) => sum + v * v, 0);
    const start = Math.round((time - captureStart) * ANALYSIS_RATE);
    const scores: number[] = [];
    let best = 0,
      at = 0;
    for (let lag = 0; lag <= LATENCY_WINDOW * ANALYSIS_RATE; lag++) {
      const index = start + lag;
      if (index < 0 || index + probe.length > audio.length) {
        scores.push(0);
        continue;
      }
      const power = energy[index + probe.length] - energy[index];
      if (power / probe.length < 1e-8) {
        scores.push(0);
        continue;
      }
      let dot = 0;
      for (let j = 0; j < probe.length; j++) dot += audio[index + j] * probe[j];
      const correlation = Math.abs(dot) / Math.sqrt(power * probeEnergy);
      const score =
        correlation >= 0.3 ? Math.abs(dot) / Math.sqrt(probeEnergy) : 0;
      scores.push(score);
      if (score > best) {
        best = score;
        at = lag;
      }
    }
    const rival = Math.max(
      0,
      ...scores.filter((_, i) => Math.abs(i - at) > ANALYSIS_RATE * 0.015),
    );
    if (best === 0 || best < rival * 1.25) return null;
    return (at / ANALYSIS_RATE) * 1000;
  });
  const measured = delays.slice(0, 4).filter((v): v is number => v !== null);
  const verified = delays.slice(4).filter((v): v is number => v !== null);
  if (measured.length < 3 || verified.length < 2)
    throw new Error(
      "Not enough clear test signals. Move the headphone closer to the microphone, keep the room quiet and try again.",
    );
  const all = [...measured, ...verified];
  const spreadMs = Math.max(...all) - Math.min(...all);
  const offsetMs = Math.round(median(measured) / 10) * 10;
  const verificationMs = Math.max(
    ...verified.map((v) => Math.abs(v - offsetMs)),
  );
  if (spreadMs > 15 || verificationMs > 15)
    throw new Error(
      "The delay was not stable enough. Check the audio connection and repeat the measurement. Timing remains unchecked.",
    );
  return {
    offsetMs,
    spreadMs: Math.round(spreadMs),
    verificationMs: Math.round(verificationMs),
    detected: all.length,
  };
}
