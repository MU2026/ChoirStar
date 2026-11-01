import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { AudioSession } from "../src/audio";
import { demoPiece, defaults, secondsAt } from "../src/model";
const param = () => ({
  value: 0,
  setValueAtTime: vi.fn(),
  linearRampToValueAtTime: vi.fn(),
  setTargetAtTime: vi.fn(),
});
const node = () => ({
  connect: vi.fn(function (destination: any) {
    return destination;
  }),
  disconnect: vi.fn(),
  gain: param(),
});
class Context {
  currentTime = 10;
  state = "running";
  sampleRate = 48000;
  destination = node();
  oscillators: any[] = [];
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {
    this.state = "closed";
  });
  createGain = () => node();
  createDynamicsCompressor = () => node();
  createOscillator = () => {
    const o = {
      ...node(),
      type: "",
      frequency: { value: 0 },
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    };
    this.oscillators.push(o);
    return o;
  };
  createMediaStreamSource = () => node();
  createChannelSplitter = () => node();
  createAnalyser = () => ({
    ...node(),
    fftSize: 4096,
    smoothingTimeConstant: 0,
    getFloatTimeDomainData: vi.fn(),
  });
  createMediaStreamDestination = () => ({ ...node(), stream: {} });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("AudioContext", Context);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("uses the shared audio clock, scales passage duration, and ends once", async () => {
  const p = demoPiece(),
    s = defaults(p);
  s.from = 1;
  s.to = 1;
  s.speed = 0.5;
  const e = new AudioSession(),
    end = vi.fn();
  await e.play(p, s, end);
  const ctx = e.context as unknown as Context;
  expect(e.startSeconds).toBeCloseTo(secondsAt(p, p.bars[1].start));
  ctx.currentTime = e.startTime + 1;
  expect(e.position()).toBeCloseTo(e.startSeconds + 0.5);
  vi.advanceTimersByTime(25);
  expect(
    ctx.oscillators.some(
      (o) =>
        o.frequency.value === 440 * 2 ** ((p.parts[0].notes[3].midi - 69) / 12),
    ),
  ).toBe(true);
  ctx.currentTime =
    e.startTime + (e.endSeconds - e.startSeconds) / s.speed + 0.1;
  vi.advanceTimersByTime(100);
  expect(end).toHaveBeenCalledTimes(1);
  expect(e.running).toBe(false);
  await e.close();
});
it("stops scheduled voices and timers before starting a new passage", async () => {
  const p = demoPiece(),
    s = defaults(p),
    e = new AudioSession(),
    end = vi.fn();
  await e.play(p, s, end);
  const ctx = e.context as unknown as Context;
  const voices = [...ctx.oscillators];
  e.stopPlayback();
  expect(voices.every((o) => o.stop.mock.calls.length >= 2)).toBe(true);
  ctx.currentTime = 1000;
  vi.advanceTimersByTime(500);
  expect(end).not.toHaveBeenCalled();
  await e.close();
});
it("releases the microphone when an unavailable input channel is selected", async () => {
  const stop = vi.fn();
  const stream = {
    getAudioTracks: () => [{ getSettings: () => ({ channelCount: 1 }) }],
    getTracks: () => [{ stop }],
  };
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: vi.fn(async () => stream) },
  });
  const e = new AudioSession();
  await expect(e.microphone("", 1, () => {})).rejects.toThrow(
    "1 input channel",
  );
  expect(stop).toHaveBeenCalled();
  expect(e.stream).toBeNull();
  await e.close();
});

it("plays the selected passage's first sounding note without opening a microphone", async () => {
  const p = demoPiece(),
    s = defaults(p),
    e = new AudioSession();
  s.part = p.parts[11].id;
  s.from = 2;
  s.to = 3;
  await e.startingNote(p, s);
  const note = p.parts[11].notes.find(
    (n) => n.tick + n.length > p.bars[2].start,
  )!;
  const ctx = e.context as unknown as Context;
  expect(ctx.oscillators).toHaveLength(1);
  expect(ctx.oscillators[0].frequency.value).toBeCloseTo(
    440 * 2 ** ((note.midi - 69) / 12),
  );
  expect(e.stream).toBeNull();
  expect(e.running).toBe(false);
  await e.close();
});

it("keeps monitoring silent until enabled and disconnects it when capture ends", async () => {
  const stop = vi.fn();
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [{ getSettings: () => ({ channelCount: 2 }) }],
        getTracks: () => [{ stop }],
      }),
    },
  });
  vi.stubGlobal(
    "Worker",
    class {
      terminate = vi.fn();
    },
  );
  const e = new AudioSession();
  await e.ready();
  const ctx = e.context as unknown as Context;
  const monitor = node();
  ctx.createGain = () => monitor;
  await e.microphone("", 1, () => {});
  expect(monitor.gain.value).toBe(0);
  expect(monitor.connect).toHaveBeenCalledWith(ctx.destination);
  e.setMonitoring(true, 0.4);
  expect(monitor.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.4, 10, 0.02);
  e.setMonitoring(false, 0.4);
  expect(monitor.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 10, 0.02);
  e.releaseMic();
  expect(monitor.disconnect).toHaveBeenCalled();
  expect(stop).toHaveBeenCalled();
  await e.close();
});

it("requests echo reduction for speakers and blocks microphone feedback even if monitoring is toggled", async () => {
  const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => ({
    getAudioTracks: () => [
      { getSettings: () => ({ channelCount: 1, echoCancellation: true }) },
    ],
    getTracks: () => [{ stop: vi.fn() }],
  }));
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal(
    "Worker",
    class {
      terminate = vi.fn();
    },
  );
  const e = new AudioSession();
  await e.ready();
  const monitor = node();
  (e.context as unknown as Context).createGain = () => monitor;
  e.setMonitoring(true, 0.5);
  const result = await e.microphone("", 0, () => {}, true);
  expect(getUserMedia.mock.calls[0][0]).toMatchObject({
    audio: {
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 1 },
    },
  });
  expect(result.echoCancellation).toBe(true);
  expect(monitor.gain.value).toBe(0);
  e.setMonitoring(true, 0.8);
  expect(monitor.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 10, 0.02);
  await e.close();
});
