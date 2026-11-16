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
  createPeriodicWave = vi.fn((real: Float32Array, imag: Float32Array) => ({
    real,
    imag,
  }));
  createOscillator = () => {
    const o = {
      ...node(),
      type: "",
      setPeriodicWave: vi.fn(),
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
it("plays each part's first pitch for one second, highest first, before the count-in", async () => {
  const p = demoPiece(),
    s = defaults(p),
    e = new AudioSession();
  // Deliberately scramble staff order and mute every part: preparation still
  // includes every voice and sorts by sounding pitch.
  p.parts.reverse();
  Object.values(s.mix).forEach((mix) => {
    mix.mute = true;
  });
  await e.play(p, s, vi.fn());
  const ctx = e.context as unknown as Context;
  const preparation = ctx.oscillators.filter((o) => o.type !== "sine");
  expect(preparation).toHaveLength(p.parts.length);
  const pitches = p.parts.map((p) => p.notes[0].midi).sort((a, b) => b - a);
  preparation.forEach((o, i) => {
    expect(o.frequency.value).toBeCloseTo(440 * 2 ** ((pitches[i] - 69) / 12));
    expect(o.start.mock.calls[0][0]).toBeCloseTo(10.15 + i);
    expect(o.stop.mock.calls[0][0] - o.start.mock.calls[0][0]).toBeCloseTo(
      1.01,
    );
  });
  const clicks = ctx.oscillators.filter((o) => o.type === "sine");
  expect(clicks).toHaveLength(p.bars[0].meter[0]);
  expect(clicks[0].start.mock.calls[0][0]).toBeCloseTo(10.15 + p.parts.length);
  expect(e.startTime).toBeGreaterThan(clicks.at(-1).start.mock.calls[0][0]);
  await e.close();
});
it("omits preparation and count-in from passage loops when starting pitches are off", async () => {
  const p = demoPiece(),
    s = { ...defaults(p), from: 1, to: 1, loop: true, initialPitches: false },
    e = new AudioSession();
  for (let cycle = 0; cycle < 2; cycle++) {
    await e.play(p, s, vi.fn());
    const ctx = e.context as unknown as Context;
    expect(e.startTime).toBeCloseTo(ctx.currentTime + 0.15);
    expect(ctx.oscillators.every((o) => o.type !== "sine")).toBe(true);
    const before = ctx.oscillators.length;
    await e.previewNote(99);
    expect(ctx.oscillators).toHaveLength(before);
    expect(e.running).toBe(true);
    e.stopPlayback();
  }
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

it("previews a clicked sounding note without opening a microphone", async () => {
  const p = demoPiece(),
    s = defaults(p),
    e = new AudioSession();
  s.part = p.parts[11].id;
  s.from = 2;
  s.to = 3;
  await e.previewNote(50, s.instrument);
  const ctx = e.context as unknown as Context;
  expect(ctx.oscillators).toHaveLength(1);
  expect(ctx.oscillators[0].frequency.value).toBeCloseTo(
    440 * 2 ** ((50 - 69) / 12),
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

it.each(["piano", "choir", "organ", "strings"] as const)(
  "uses the %s timbre for starting notes and playback while keeping count-in separate",
  async (instrument) => {
    const p = demoPiece(),
      s = { ...defaults(p), instrument },
      e = new AudioSession();
    await e.previewNote(p.parts[0].notes[0].midi, instrument);
    const ctx = e.context as unknown as Context;
    expect(ctx.oscillators[0].setPeriodicWave).toHaveBeenCalledOnce();
    const previewHarmonics = ctx.createPeriodicWave.mock.calls[0][1];
    await e.play(p, s, vi.fn());
    const countIn = ctx.oscillators.slice(1).filter((o) => o.type === "sine");
    expect(countIn.every((o) => o.type === "sine")).toBe(true);
    ctx.currentTime = e.startTime;
    vi.advanceTimersByTime(25);
    expect(ctx.createPeriodicWave.mock.calls.length).toBeGreaterThan(1);
    expect(ctx.createPeriodicWave.mock.calls[1][1]).toEqual(previewHarmonics);
    expect(ctx.oscillators.at(-1).frequency.value).toBeGreaterThan(0);
    e.stopPlayback();
    expect(ctx.oscillators.every((o) => o.stop.mock.calls.length >= 2)).toBe(
      true,
    );
    await e.close();
  },
);

it("restores the requested monitoring level after leaving echo-reduction mode", async () => {
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [{ getSettings: () => ({ channelCount: 1 }) }],
        getTracks: () => [{ stop: vi.fn() }],
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
  const monitor = node();
  (e.context as unknown as Context).createGain = () => monitor;
  await e.microphone("built-in", 0, () => {}, true);
  e.releaseMic();
  // The user enables monitoring while preparing a headphone round.
  e.setMonitoring(true, 0.65);
  await e.microphone("built-in", 0, () => {}, false);
  expect(monitor.gain.value).toBe(0.65);
  await e.close();
});

it("extends a playing loop to the full piece without moving its clock and can shorten it again", async () => {
  const p = demoPiece(),
    s = {
      ...defaults(p),
      speed: 1,
      from: 1,
      to: 1,
      loop: true,
      initialPitches: false,
    },
    e = new AudioSession(),
    end = vi.fn();
  await e.play(p, s, end);
  const ctx = e.context as unknown as Context;
  ctx.currentTime = e.startTime + 0.4;
  const position = e.position(),
    startTime = e.startTime;
  e.setPassageEnd(p, p.bars.length - 1);
  expect(e.position()).toBe(position);
  expect(e.startTime).toBe(startTime);
  expect(e.endSeconds).toBe(secondsAt(p, p.end));
  ctx.currentTime =
    e.startTime +
    (secondsAt(p, p.bars[2].start) - e.startSeconds) / s.speed +
    0.001;
  vi.advanceTimersByTime(25);
  expect(end).not.toHaveBeenCalled();
  expect(
    ctx.oscillators.some(
      (o) =>
        o.start.mock.calls[0][0] >=
        e.startTime + secondsAt(p, p.bars[2].start) - e.startSeconds,
    ),
  ).toBe(true);
  e.setPassageEnd(p, 1);
  vi.advanceTimersByTime(25);
  expect(end).toHaveBeenCalledOnce();
  await e.close();
});

it("applies solo and boost gains both at start and while playing", async () => {
  const p = demoPiece(),
    s = { ...defaults(p), loop: true, initialPitches: false },
    e = new AudioSession();
  const ctx = (await e.ready()) as unknown as Context;
  const gains: ReturnType<typeof node>[] = [];
  ctx.createGain = () => {
    const gain = node();
    gains.push(gain);
    return gain;
  };
  const [a, b, c] = p.parts.map((p) => p.id);
  s.mix[a].solo = true;
  s.mix[b].solo = true;
  await e.play(p, s, vi.fn());
  expect(gains[1].gain.value).toBe(0.65);
  expect(gains[2].gain.value).toBe(0.65);
  expect(gains[3].gain.value).toBe(0);
  s.mix[a].boost = true;
  e.setMix(s.mix);
  expect(gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(
    0.65 * 2,
    ctx.currentTime,
    0.02,
  );
  expect(gains[2].gain.setTargetAtTime).toHaveBeenLastCalledWith(
    0.65 * 0.12,
    ctx.currentTime,
    0.02,
  );
  expect(s.mix[c].volume).toBe(0.65);
  await e.close();
});

it("seeks forward and backward on the shared clock, cancels queued voices, and resumes a held note", async () => {
  const p = demoPiece(),
    s = { ...defaults(p), speed: 0.5, loop: true, initialPitches: false },
    e = new AudioSession(),
    end = vi.fn();
  p.parts[0].notes = [
    { id: "held", tick: 0, length: p.end, midi: 48, velocity: 0.7 },
  ];
  await e.play(p, s, end);
  const ctx = e.context as unknown as Context;
  const original = [...ctx.oscillators];
  const target = p.bars[2].start + p.ppq / 2;
  e.seek(target, p.end);
  expect(original.every((o) => o.stop.mock.calls.length >= 2)).toBe(true);
  expect(e.startSeconds).toBeCloseTo(secondsAt(p, target));
  expect(e.endSeconds).toBeCloseTo(secondsAt(p, p.end));
  const newVoices = ctx.oscillators.slice(original.length);
  expect(
    newVoices.some((o) => o.frequency.value === 440 * 2 ** ((48 - 69) / 12)),
  ).toBe(true);
  ctx.currentTime = e.startTime + 1;
  expect(e.position()).toBeCloseTo(secondsAt(p, target) + 0.5);
  e.seek(p.ppq / 4, p.bars[1].end);
  expect(e.startSeconds).toBeCloseTo(secondsAt(p, p.ppq / 4));
  ctx.currentTime =
    e.startTime + (e.endSeconds - e.startSeconds) / s.speed + 0.01;
  vi.advanceTimersByTime(50);
  expect(end).toHaveBeenCalledOnce();
  expect(e.running).toBe(false);
  const afterStop = e.startTime;
  e.seek(0, p.end);
  expect(e.startTime).toBe(afterStop);
  await e.close();
});

it("starts at an exact cursor tick with count-in and preserves the requested end", async () => {
  const p = demoPiece(),
    s = { ...defaults(p), from: 1, to: 2 },
    e = new AudioSession();
  const target = p.bars[1].start + p.ppq * 0.75;
  await e.play(p, s, vi.fn(), target);
  expect(e.startSeconds).toBeCloseTo(secondsAt(p, target));
  expect(e.endSeconds).toBeCloseTo(secondsAt(p, p.bars[2].end));
  const ctx = e.context as unknown as Context;
  expect(e.startTime).toBeGreaterThan(ctx.currentTime);
  await e.close();
});

it("schedules metronome beats on the score clock through tempo, meter, and speed changes", async () => {
  const p = demoPiece();
  p.ppq = 960;
  p.bars = [
    { start: 0, end: 2880, meter: [3, 4] },
    { start: 2880, end: 5760, meter: [6, 8] },
  ];
  p.end = 5760;
  p.tempos = [
    { tick: 0, bpm: 120 },
    { tick: 2880, bpm: 60 },
  ];
  p.parts.forEach((part) => (part.notes = []));
  const s = {
      ...defaults(p),
      speed: 0.5,
      loop: true,
      initialPitches: false,
      metronome: true,
    },
    e = new AudioSession(),
    end = vi.fn();
  await e.play(p, s, end);
  const ctx = e.context as unknown as Context;
  const ticks = [0, 960, 1920, 2880, 3360, 3840, 4320, 4800, 5280];
  for (const tick of ticks) {
    ctx.currentTime = e.startTime + secondsAt(p, tick) / s.speed;
    vi.advanceTimersByTime(25);
  }
  const clicks = ctx.oscillators.filter((o) => o.type === "sine");
  expect(clicks).toHaveLength(9);
  clicks.forEach((click, i) => {
    expect(click.start.mock.calls[0][0]).toBeCloseTo(
      e.startTime + secondsAt(p, ticks[i]) / s.speed,
    );
    expect(click.frequency.value).toBe(i === 0 || i === 3 ? 1200 : 800);
  });
  ctx.currentTime = e.startTime + secondsAt(p, p.end) / s.speed;
  vi.advanceTimersByTime(50);
  expect(end).toHaveBeenCalledOnce();
  expect(ctx.oscillators.filter((o) => o.type === "sine")).toHaveLength(9);
  await e.close();
});

it("toggles clicks live without stopping notes, and seeks to the next real beat", async () => {
  const p = demoPiece(),
    s = {
      ...defaults(p),
      speed: 1,
      loop: true,
      initialPitches: false,
      metronome: true,
    },
    e = new AudioSession();
  await e.play(p, s, vi.fn());
  const ctx = e.context as unknown as Context;
  const notes = ctx.oscillators.filter((o) => o.type !== "sine");
  const clicks = ctx.oscillators.filter((o) => o.type === "sine");
  expect(clicks).toHaveLength(1);
  e.setMetronome(false);
  expect(clicks[0].stop.mock.calls).toHaveLength(2);
  expect(notes.every((o) => o.stop.mock.calls.length === 1)).toBe(true);
  expect(e.running).toBe(true);
  ctx.currentTime = e.startTime + secondsAt(p, p.ppq * 0.5);
  e.setMetronome(true);
  expect(ctx.oscillators.filter((o) => o.type === "sine")).toHaveLength(1);
  ctx.currentTime = e.startTime + secondsAt(p, p.ppq);
  vi.advanceTimersByTime(25);
  expect(
    ctx.oscillators.filter((o) => o.type === "sine").at(-1).frequency.value,
  ).toBe(800);
  const before = ctx.oscillators.length;
  const tick = p.bars[2].start + p.ppq * 0.25;
  e.seek(tick, p.end);
  expect(
    ctx.oscillators.slice(before).filter((o) => o.type === "sine"),
  ).toHaveLength(0);
  const nextBeat = p.bars[2].start + p.ppq;
  ctx.currentTime = e.startTime + (secondsAt(p, nextBeat) - e.startSeconds);
  vi.advanceTimersByTime(25);
  const next = ctx.oscillators.slice(before).filter((o) => o.type === "sine");
  expect(next).toHaveLength(1);
  expect(next[0].frequency.value).toBe(800);
  e.stopPlayback();
  const count = ctx.oscillators.length;
  e.setMetronome(true);
  vi.advanceTimersByTime(100);
  expect(ctx.oscillators).toHaveLength(count);
  await e.close();
});

it("keeps preparation clicks separate and starts each loop with a metronome accent", async () => {
  const p = demoPiece(),
    s = { ...defaults(p), metronome: true },
    e = new AudioSession();
  await e.play(p, s, vi.fn());
  const ctx = e.context as unknown as Context;
  expect(ctx.oscillators.filter((o) => o.type === "sine")).toHaveLength(
    p.bars[0].meter[0],
  );
  expect(
    ctx.oscillators.filter((o) => o.frequency.value === 1200),
  ).toHaveLength(0);
  ctx.currentTime = e.startTime - 0.1;
  vi.advanceTimersByTime(25);
  expect(
    ctx.oscillators.filter((o) => o.frequency.value === 1200),
  ).toHaveLength(1);
  for (let i = 0; i < 2; i++) {
    const before = ctx.oscillators.length;
    await e.play(p, { ...s, loop: true, initialPitches: false }, vi.fn());
    const clicks = ctx.oscillators
      .slice(before)
      .filter((o) => o.type === "sine");
    expect(clicks).toHaveLength(1);
    expect(clicks[0].frequency.value).toBe(1200);
    expect(clicks[0].start.mock.calls[0][0]).toBeCloseTo(e.startTime);
  }
  await e.close();
});

it.each([false, true])(
  "lets the starting-pitch switch control preparation with loop=%s at any cursor",
  async (loop) => {
    const p = demoPiece(),
      e = new AudioSession();
    const target = p.bars[1].start + p.ppq / 2;
    for (const enabled of [false, true, true]) {
      const s = {
        ...defaults(p),
        from: 1,
        to: 2,
        loop,
        initialPitches: enabled,
      };
      const ctx = (await e.ready()) as unknown as Context;
      const before = ctx.oscillators.length;
      await e.play(p, s, vi.fn(), target);
      const preparation = ctx.oscillators
        .slice(before)
        .filter(
          (o) =>
            o.type !== "sine" && o.start.mock.calls[0][0] < e.startTime - 1e-6,
        );
      const pitches = p.parts
        .flatMap((part) => {
          const n = part.notes.find(
            (n) => n.tick + n.length > target && n.tick < p.bars[2].end,
          );
          return n ? [n.midi] : [];
        })
        .sort((a, b) => b - a);
      expect(preparation).toHaveLength(enabled ? pitches.length : 0);
      preparation.forEach((o, i) =>
        expect(o.frequency.value).toBeCloseTo(
          440 * 2 ** ((pitches[i] - 69) / 12),
        ),
      );
      e.stopPlayback();
    }
    await e.close();
  },
);

it("changes tempo live without moving score position or altering pitch, and retimes clicks", async () => {
  const p = demoPiece(),
    s = {
      ...defaults(p),
      speed: 1,
      loop: true,
      initialPitches: false,
      metronome: true,
    },
    e = new AudioSession(),
    end = vi.fn();
  p.parts[0].notes = [
    { id: "held", tick: 0, length: p.end, midi: 48, velocity: 0.7 },
  ];
  await e.play(p, s, end);
  const ctx = e.context as unknown as Context;
  ctx.currentTime = e.startTime + secondsAt(p, p.ppq * 0.5);
  const position = e.position(),
    old = [...ctx.oscillators];
  e.setSpeed(0.5);
  expect(e.position()).toBeCloseTo(position);
  expect(old.every((o) => o.stop.mock.calls.length >= 2)).toBe(true);
  expect(
    ctx.oscillators
      .slice(old.length)
      .some((o) => o.frequency.value === 440 * 2 ** ((48 - 69) / 12)),
  ).toBe(true);
  const nextTime = e.startTime + (secondsAt(p, p.ppq) - position) / 0.5;
  ctx.currentTime = nextTime;
  vi.advanceTimersByTime(25);
  const click = ctx.oscillators.filter((o) => o.type === "sine").at(-1);
  expect(click.start.mock.calls[0][0]).toBeCloseTo(nextTime);
  const before = e.position();
  e.setSpeed(2);
  expect(e.position()).toBeCloseTo(before);
  ctx.currentTime = e.startTime + 1;
  expect(e.position()).toBeCloseTo(before + 2);
  ctx.currentTime =
    e.startTime + (e.endSeconds - e.startSeconds) / e.speed + 0.01;
  vi.advanceTimersByTime(50);
  expect(end).toHaveBeenCalledOnce();
  await e.close();
});

it("preserves starting pitches when tempo changes during preparation and retimes the count-in", async () => {
  const p = demoPiece(),
    s = { ...defaults(p), speed: 1, initialPitches: true },
    e = new AudioSession();
  await e.play(p, s, vi.fn());
  const ctx = e.context as unknown as Context;
  const prep = ctx.oscillators.filter((o) => o.type !== "sine");
  const oldStart = e.startTime;
  e.setSpeed(0.5);
  expect(prep.every((o) => o.stop.mock.calls.length === 1)).toBe(true);
  expect(e.startTime).toBeGreaterThan(oldStart);
  ctx.currentTime = e.startTime - 0.3;
  const before = e.startTime - ctx.currentTime;
  e.setSpeed(1);
  expect(e.startTime - ctx.currentTime).toBeCloseTo(before / 2);
  expect(e.startSeconds).toBe(0);
  await e.close();
});
