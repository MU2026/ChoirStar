import { analysePitch } from "./pitch-analysis";
self.onmessage = (
  e: MessageEvent<{ buffer: Float32Array; rate: number; time: number }>,
) => {
  const { buffer, rate, time } = e.data;
  self.postMessage(analysePitch(buffer, rate, time));
};
