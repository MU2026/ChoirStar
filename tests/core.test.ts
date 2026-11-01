import { describe, it, expect } from "vitest";
import { Midi } from "@tonejs/midi";
import {
  assess,
  defaults,
  demoPiece,
  importMidi,
  secondsAt,
  tickAt,
  suggestions,
} from "../src/model";
import { detectPitchYin } from "../src/vendor/openvox/core/audio/pitchDetector";
import { renderScoreSvg } from "../src/vendor/openvox/core/music/scoreRenderer";

describe("MIDI and tempo maps", () => {
  it("preserves twelve independently named tracks and excludes metadata", () => {
    const p = demoPiece();
    expect(p.parts).toHaveLength(12);
    expect(p.parts[11].name).toBe("Bass 3");
    expect(p.bars).toHaveLength(8);
    expect(Object.keys(defaults(p).mix)).toHaveLength(12);
  });
  it("handles changing tempo in both directions, including a note crossing a tempo event", () => {
    const m = new Midi();
    m.header.tempos = [
      { ticks: 0, bpm: 120 },
      { ticks: 480, bpm: 60 },
      { ticks: 1440, bpm: 90 },
    ];
    m.header.update();
    m.addTrack().addNote({ midi: 38, ticks: 0, durationTicks: 1920 });
    const p = importMidi(m.toArray().buffer as ArrayBuffer, "test.mid");
    expect(secondsAt(p, 480)).toBeCloseTo(0.5);
    expect(secondsAt(p, 1440)).toBeCloseTo(2.5);
    for (const t of [0, 100, 480, 900, 1440, 1700])
      expect(tickAt(p, secondsAt(p, t))).toBeCloseTo(t);
    expect(p.parts[0].notes[0].length).toBe(1920);
  });
  it("supports meter changes and named parts beyond SATB", () => {
    const m = new Midi();
    m.header.timeSignatures = [
      { ticks: 0, timeSignature: [3, 4], measures: 0 },
      { ticks: 1440, timeSignature: [5, 8], measures: 1 },
    ];
    const t = m.addTrack();
    t.name = "Divisi 9";
    t.addNote({ midi: 60, ticks: 0, durationTicks: 2640 });
    const p = importMidi(m.toArray().buffer as ArrayBuffer, "meters.mid");
    expect(p.bars.map((b) => [b.start, b.end])).toEqual([
      [0, 1440],
      [1440, 2640],
    ]);
    expect(p.parts[0].name).toBe("Divisi 9");
  });
  it("rejects invalid and empty MIDI", () => {
    expect(() => importMidi(new ArrayBuffer(3), "bad")).toThrow();
    const m = new Midi();
    expect(() =>
      importMidi(m.toArray().buffer as ArrayBuffer, "empty"),
    ).toThrow("No pitched notes");
  });
});
describe("pitch detection", () => {
  for (const f of [73.4162, 87.307, 110, 220, 493.883, 587.33])
    it(`detects a ${f} Hz tone (including low bass)`, () => {
      const buffer = Float32Array.from(
        { length: 4096 },
        (_, i) =>
          0.15 * Math.sin((2 * Math.PI * f * i) / 48000) +
          0.06 * Math.sin((4 * Math.PI * f * i) / 48000),
      );
      const p = detectPitchYin(buffer, 48000);
      expect(p).not.toBeNull();
      expect(Math.abs(1200 * Math.log2(p!.frequency / f))).toBeLessThan(10);
      expect(p!.confidence).toBeGreaterThan(0.85);
    });
  it("does not treat silence as pitch", () =>
    expect(detectPitchYin(new Float32Array(4096), 48000)).toBeNull());
});
describe("assessment", () => {
  it("does not score absent or uncertain input as incorrect notes", () => {
    const p = demoPiece(),
      part = p.parts[0];
    const result = assess(
      p,
      part,
      [{ time: 0.1, midi: 90, confidence: 0.1 }],
      0,
      0,
      false,
    );
    expect(result.every((n) => n.cents === null && n.onset === null)).toBe(
      true,
    );
    expect(suggestions(result)[0].pitch).toBe(0);
  });
  it("distinguishes pitch errors from unavailable timing", () => {
    const p = demoPiece(),
      part = p.parts[0];
    const frames = Array.from({ length: 5 }, (_, i) => ({
      time: 0.1 + i * 0.05,
      midi: part.notes[0].midi + 1,
      confidence: 1,
    }));
    const r = assess(p, part, frames, 0, 0, false);
    expect(r[0].cents).toBe(100);
    expect(r[0].onset).toBeNull();
    expect(suggestions(r)[0].pitch).toBe(1);
  });
  it("does not pretend to identify repeated same-pitch syllables", () => {
    const p = demoPiece(),
      part = p.parts[0];
    part.notes[1].midi = part.notes[0].midi;
    const frames = Array.from({ length: 50 }, (_, i) => ({
      time: i * 0.04,
      midi: part.notes[0].midi,
      confidence: 1,
    }));
    expect(assess(p, part, frames, 0, 0, true)[1].onset).toBeNull();
  });
});
it("escapes score titles in imported SVG output", () => {
  const svg = renderScoreSvg({
    id: "x",
    title: "<script>bad()</script>",
    composer: "",
    tempo: 60,
    timeSignature: [3, 4],
    keyFifths: 0,
    notes: [],
    createdAt: 0,
    updatedAt: 0,
  });
  expect(svg).not.toContain("<script>");
  expect(svg).toContain("&lt;script&gt;");
});

for (const count of [8, 12]) {
  it(`imports all ${count} MIDI tracks with independent mix controls`, () => {
    const midi = new Midi();
    for (let i = 0; i < count; i++) {
      const track = midi.addTrack();
      track.name = `Voice ${i + 1}`;
      track.addNote({ midi: 48 + i, ticks: 0, durationTicks: 480 });
    }
    const piece = importMidi(
      midi.toArray().buffer as ArrayBuffer,
      "voices.mid",
    );
    expect(piece.parts).toHaveLength(count);
    expect(Object.keys(defaults(piece).mix)).toHaveLength(count);
    expect(piece.parts[count - 1].name).toBe(`Voice ${count}`);
  });
}
