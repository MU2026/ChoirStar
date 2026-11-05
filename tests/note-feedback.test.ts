import { expect, it } from "vitest";
import { completedFeedback, feedbackDelaySeconds } from "../src/note-feedback";
import { defaults, type Piece, type Sample } from "../src/model";
import { parseBackup } from "../src/storage";

const piece = (): Piece => ({
  id: "piece",
  title: "Synthetic grading study",
  ppq: 1000,
  key: 0,
  end: 4000,
  tempos: [{ tick: 0, bpm: 60 }],
  bars: [{ start: 0, end: 4000, meter: [4, 4] }],
  parts: [
    {
      id: "part",
      name: "Voice",
      notes: [
        { id: "note", tick: 1000, length: 1000, midi: 60, velocity: 0.7 },
      ],
    },
  ],
});
function frames(speed = 1, cents = 0, delay = 0): Sample[] {
  return Array.from(
    { length: Math.floor((1 / speed - delay) / 0.02) },
    (_, i) => ({
      time: 1 + (delay + i * 0.02) * speed,
      midi: 60 + cents / 100,
      confidence: 1,
      rms: 0.1,
    }),
  );
}
it.each([
  [20, "Perfect"],
  [40, "Great"],
  [80, "OK"],
  [150, "Poor"],
] as const)(
  "grades %s cents as %s only after the complete note",
  (cents, grade) => {
    const p = piece(),
      s = defaults(p),
      samples = frames(1, cents);
    expect(completedFeedback(p, p.parts[0], samples, s, 1.99)).toEqual([]);
    expect(completedFeedback(p, p.parts[0], samples, s, 2)[0].grade).toBe(
      grade,
    );
  },
);
it.each([0.5, 1, 2])(
  "combines pitch and real onset milliseconds at %s speed",
  (speed) => {
    const p = piece(),
      s = { ...defaults(p), speed, timing: true };
    const result = completedFeedback(
      p,
      p.parts[0],
      frames(speed, 20, 0.18),
      s,
      2,
    )[0];
    expect(result.onset).toBeCloseTo(180);
    expect(result.grade).toBe("OK");
  },
);
it("uses the worse of pitch and timing and explains uncalibrated timing", () => {
  const p = piece(),
    s = { ...defaults(p), timing: true };
  expect(completedFeedback(p, p.parts[0], frames(1, 150), s, 2)[0].grade).toBe(
    "Poor",
  );
  const result = completedFeedback(
    p,
    p.parts[0],
    frames(1, 20, 0.18),
    { ...s, timing: false },
    2,
  )[0];
  expect(result.grade).toBe("Perfect");
  expect(result.detail).toContain("pitch grade only");
});
it("grades confidently late entries as Poor rather than dropping their onset", () => {
  const p = piece(),
    s = { ...defaults(p), timing: true, speed: 1 };
  const result = completedFeedback(p, p.parts[0], frames(1, 0, 0.6), s, 2)[0];
  expect(result.onset).toBeCloseTo(600);
  expect(result.grade).toBe("Poor");
});
it("waits for buffered capture and positive compensation before finalizing notes", () => {
  expect(feedbackDelaySeconds({ offset: 300 })).toBeCloseTo(0.42);
  expect(feedbackDelaySeconds({ offset: -300 })).toBeCloseTo(0.12);
});
it("distinguishes observed silence from uncertain, missing and sparse capture", () => {
  const p = piece(),
    s = defaults(p);
  const silence = frames().map((f) => ({
    ...f,
    midi: null,
    confidence: 0,
    rms: 0,
  }));
  expect(completedFeedback(p, p.parts[0], silence, s, 2)[0].grade).toBe(
    "Missed",
  );
  for (const samples of [
    [],
    frames().map((f) => ({ ...f, confidence: 0.1 })),
    frames().slice(0, 4),
    silence.slice(0, 4),
  ]) {
    expect(completedFeedback(p, p.parts[0], samples, s, 2)[0].grade).toBeNull();
  }
});
it("does not revise completed feedback, grade future notes or carry results into a fresh loop", () => {
  const p = piece(),
    s = defaults(p);
  const first = completedFeedback(p, p.parts[0], frames(), s, 2);
  expect(completedFeedback(p, p.parts[0], [], s, 3, first)).toBe(first);
  expect(completedFeedback(p, p.parts[0], [], s, 1)).toEqual([]);
  expect(completedFeedback(p, p.parts[0], frames(1, 150), s, 2)[0].grade).toBe(
    "Poor",
  );
});
it("does not grade a note cut short by a passage boundary", () => {
  const p = piece();
  p.parts[0].notes[0].length = 4000;
  expect(completedFeedback(p, p.parts[0], frames(), defaults(p), 4)).toEqual(
    [],
  );
});
it("retains note grades and details through backup restoration", () => {
  const p = piece(),
    s = defaults(p);
  const results = completedFeedback(p, p.parts[0], frames(), s, 2);
  const attempt = {
    id: "attempt",
    session: "session",
    profile: "singer",
    piece: p.id,
    title: p.title,
    part: "part",
    date: 1,
    from: 0,
    to: 0,
    speed: 1,
    results,
    audioSettings: { device: "", channel: 0, offset: 0, timing: false },
  };
  const restored = parseBackup(
    JSON.stringify({
      format: "ChoirStar backup",
      library: {
        version: 1,
        profiles: [{ id: "singer", name: "Singer" }],
        pieces: [p],
        settings: {},
        attempts: [attempt],
      },
      recordings: {},
    }),
  );
  expect(restored.library.attempts[0].results).toEqual(results);
});
