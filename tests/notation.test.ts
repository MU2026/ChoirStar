import { it, expect } from "vitest";
import { demoPiece } from "../src/model";
import { notationBar } from "../src/notation";
it("preserves accidentals and aligns pitch overlays with engraved note heads", () => {
  const p = demoPiece();
  p.key = 2;
  const part = p.parts[0];
  const bar = notationBar(p, part, 0, 300);
  const n = part.notes[0];
  const ellipse = bar.svg.match(/<ellipse cx="([^"]+)" cy="([^"]+)"/)!;
  expect(ellipse).not.toBeNull();
  const left = Math.max(176, 163 + 28);
  expect(bar.x(n.tick)).toBeCloseTo(Number(ellipse[1]) - left);
  expect(bar.y(n.midi, n.tick)).toBeCloseTo(Number(ellipse[2]) - 62);
  expect(bar.y(n.midi + 0.5, n.tick)).toBeLessThan(bar.y(n.midi, n.tick));
  expect(bar.clef).toContain("♯");
  expect(bar.svg).not.toContain('fill="#9a929d"');
  expect(bar.x(p.bars[0].end)).toBeGreaterThan(bar.x(n.tick));
});

it("keeps note positions aligned when MusicXML key signatures change", () => {
  const p = demoPiece();
  p.key = 0;
  p.bars[1].key = 7;
  for (const index of [0, 1]) {
    const cell = notationBar(p, p.parts[0], index, 300);
    const ellipse = cell.svg.match(/<ellipse cx="([^"]+)" cy="([^"]+)"/)!;
    const left = Math.max(176, 163 + Math.abs(p.bars[index].key ?? p.key) * 14);
    expect(cell.x(p.bars[index].start)).toBeCloseTo(Number(ellipse[1]) - left);
    expect(cell.clef).toContain('width="213" height="130"');
  }
});

it("engraves two shortened MIDI dotted quarters as a full 6/8 bar without changing playback", () => {
  const p = demoPiece();
  p.ppq = 192;
  p.bars = [{ start: 0, end: 576, meter: [6, 8] }];
  p.end = 576;
  const part = p.parts[0];
  part.notes = [0, 288].map((tick, i) => ({
    id: `note-${i}`,
    midi: 69 - i * 2,
    tick,
    length: 256,
    velocity: 0.7,
  }));
  const original = structuredClone(part.notes);
  const cell = notationBar(p, part, 0, 300);
  expect(cell.svg).not.toContain('data-event-kind="rest"');
  expect(cell.svg.match(/<ellipse /g) || []).toHaveLength(2);
  expect(part.notes).toEqual(original);
  // Persisted MIDI imports from before source metadata receive the same fix.
  delete p.source;
  expect(notationBar(p, part, 0, 300).svg).not.toContain(
    'data-event-kind="rest"',
  );
  // MusicXML durations are explicit; never infer away their rests.
  p.source = "musicxml";
  expect(notationBar(p, part, 0, 300).svg).toContain('data-event-kind="rest"');
  delete p.source;
  p.importWarnings = [];
  expect(notationBar(p, part, 0, 300).svg).toContain('data-event-kind="rest"');
});
it("retains genuine rests after exact or substantially shorter MIDI notes", () => {
  const p = demoPiece();
  p.ppq = 192;
  p.bars = [{ start: 0, end: 576, meter: [6, 8] }];
  p.end = 576;
  const part = p.parts[0];
  for (const length of [192, 240, 48]) {
    part.notes = [0, 288].map((tick, i) => ({
      id: `note-${i}`,
      midi: 69,
      tick,
      length,
      velocity: 0.7,
    }));
    expect(notationBar(p, part, 0, 300).svg).toContain(
      'data-event-kind="rest"',
    );
  }
});

