import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { measureLatency } from "../src/latency-audio";
import { latencyProbe, LATENCY_GAP } from "../src/latency";

const nodes: any[] = [];
const makeNode = () => {
  const node = {
    connect: vi.fn(function (destination: any) {
      return destination;
    }),
    disconnect: vi.fn(),
  };
  nodes.push(node);
  return node;
};
class Context {
  static last: Context;
  currentTime = 0;
  sampleRate = 48000;
  destination = {};
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  audioWorklet = { addModule: vi.fn(async () => {}) };
  createMediaStreamSource = () => makeNode();
  createChannelSplitter = () => makeNode();
  createDynamicsCompressor = () => makeNode();
  createBuffer = (_channels: number, length: number) => ({
    copyToChannel: vi.fn(),
    length,
  });
  createBufferSource = () =>
    Object.assign(makeNode(), { buffer: null, start: vi.fn(), stop: vi.fn() });
  constructor() {
    Context.last = this;
  }
}
class Worklet {
  static last: Worklet | undefined;
  port = { onmessage: null as any, close: vi.fn(), postMessage: vi.fn() };
  onprocessorerror: null | (() => void) = null;
  connect = vi.fn();
  disconnect = vi.fn();
  constructor() {
    Worklet.last = this;
    nodes.push(this);
  }
}
let track: any, stream: any, getUserMedia: any;
beforeEach(() => {
  vi.useFakeTimers();
  nodes.length = 0;
  Worklet.last = undefined;
  track = {
    getSettings: () => ({ channelCount: 2 }),
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal("AudioWorkletNode", Worklet);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function prepared() {
  for (let i = 0; i < 20 && !Worklet.last; i++) await Promise.resolve();
  expect(Worklet.last).toBeDefined();
  return Worklet.last!;
}
it("measures a complete captured probe sequence and releases every temporary resource", async () => {
  const progress = vi.fn();
  const pending = measureLatency(
    "mic",
    1,
    new AbortController().signal,
    progress,
  );
  const worklet = await prepared();
  const rate = 48000,
    samples = new Float32Array(rate * 12);
  for (let signal = 0; signal < 7; signal++) {
    const at = Math.round((0.6 + signal * LATENCY_GAP + 0.14) * rate);
    const probe = latencyProbe(rate, signal);
    samples.set(probe, at);
  }
  for (
    let frame = 0;
    frame + 2048 <= samples.length && worklet.port.onmessage;
    frame += 2048
  )
    worklet.port.onmessage({
      data: { frame, samples: samples.slice(frame, frame + 2048) },
    });
  expect(await pending).toMatchObject({ offsetMs: 140, detected: 7 });
  expect(getUserMedia).toHaveBeenCalledWith({
    audio: {
      deviceId: { exact: "mic" },
      channelCount: { ideal: 2 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  expect(nodes[1].connect).toHaveBeenCalledWith(worklet, 1, 0);
  expect(track.stop).toHaveBeenCalledOnce();
  expect(
    nodes
      .filter((node) => node.start)
      .every((node) => node.stop.mock.calls.length === 1),
  ).toBe(true);
  expect(nodes.every((node) => node.disconnect.mock.calls.length === 1)).toBe(
    true,
  );
  expect(worklet.port.postMessage).toHaveBeenCalledWith({ stop: true });
  expect(worklet.port.close).toHaveBeenCalledOnce();
  expect(Context.last.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("cancels capture and scheduled probes while retaining the shared playback context", async () => {
  const controller = new AbortController(),
    ctx = new Context();
  const pending = measureLatency(
    "mic",
    0,
    controller.signal,
    vi.fn(),
    ctx as unknown as AudioContext,
  );
  const worklet = await prepared();
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(track.stop).toHaveBeenCalledOnce();
  expect(worklet.disconnect).toHaveBeenCalledOnce();
  expect(ctx.close).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("cancels an unresolved permission request and releases a stream that arrives later", async () => {
  let grant!: (input: any) => void;
  getUserMedia.mockImplementation(
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  );
  const controller = new AbortController();
  const pending = measureLatency("mic", 0, controller.signal, vi.fn());
  for (let i = 0; i < 10 && !grant; i++) await Promise.resolve();
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(Context.last.close).toHaveBeenCalledOnce();
  grant(stream);
  await Promise.resolve();
  expect(track.stop).toHaveBeenCalledOnce();
  expect(Worklet.last).toBeUndefined();
});
it("rejects an unavailable input channel and releases capture", async () => {
  await expect(
    measureLatency("mic", 2, new AbortController().signal, vi.fn()),
  ).rejects.toThrow(/available channel/);
  expect(track.stop).toHaveBeenCalledOnce();
  expect(Context.last.close).toHaveBeenCalledOnce();
});
it.each(["gap", "processor", "timeout"])(
  "cleans up after %s capture failure",
  async (failure) => {
    const pending = measureLatency(
      "mic",
      0,
      new AbortController().signal,
      vi.fn(),
    );
    const rejection = expect(pending).rejects.toThrow(
      /interrupted|capture failed|timed out/,
    );
    const worklet = await prepared();
    if (failure === "gap") {
      worklet.port.onmessage({
        data: { frame: 24000, samples: new Float32Array(2048) },
      });
      worklet.port.onmessage({
        data: { frame: 28096, samples: new Float32Array(2048) },
      });
    } else if (failure === "processor") worklet.onprocessorerror!();
    else await vi.advanceTimersByTimeAsync(20001);
    await rejection;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(Context.last.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  },
);
it("does not request a microphone for an off device or an already cancelled test", async () => {
  await expect(
    measureLatency("off", 0, new AbortController().signal, vi.fn()),
  ).rejects.toThrow(/Choose a microphone/);
  const controller = new AbortController();
  controller.abort();
  await expect(
    measureLatency("mic", 0, controller.signal, vi.fn()),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(getUserMedia).not.toHaveBeenCalled();
});

it("handles denied microphone permission without leaving an audio context open", async () => {
  getUserMedia.mockRejectedValueOnce(
    new DOMException("Microphone denied", "NotAllowedError"),
  );
  await expect(
    measureLatency("mic", 0, new AbortController().signal, vi.fn()),
  ).rejects.toMatchObject({ name: "NotAllowedError" });
  expect(Context.last.close).toHaveBeenCalledOnce();
  expect(Worklet.last).toBeUndefined();
});
it("cleans up capture when the worklet module cannot load", async () => {
  const ctx = new Context();
  ctx.audioWorklet.addModule.mockRejectedValueOnce(
    new Error("Module unavailable"),
  );
  await expect(
    measureLatency(
      "mic",
      0,
      new AbortController().signal,
      vi.fn(),
      ctx as unknown as AudioContext,
    ),
  ).rejects.toThrow("Module unavailable");
  expect(track.stop).toHaveBeenCalledOnce();
  expect(Worklet.last).toBeUndefined();
  expect(ctx.close).not.toHaveBeenCalled();
});

it("releases a stream when cancellation races with permission resolution", async () => {
  const controller = new AbortController();
  getUserMedia.mockImplementation(() => {
    const permission = Promise.resolve(stream);
    permission.then(() => queueMicrotask(() => controller.abort()));
    return permission;
  });
  const pending = measureLatency("mic", 0, controller.signal, vi.fn());
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(track.stop).toHaveBeenCalledOnce();
  expect(Worklet.last).toBeUndefined();
});
