import { it, expect } from "vitest";
import { demoPiece } from "../src/model";
import { notationBar } from "../src/notation";
import { glyphs } from "../src/vendor/bravura/glyphs";

function firstNotehead(svg: string) {
  const match = svg.match(
    /data-music-symbol="(black|half|whole)"[^>]*transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+) ([-\d.]+)\)"/,
  )!;
  expect(match).not.toBeNull();
  const [left, , right] = glyphs[match[1] as "black" | "half" | "whole"].bounds;
  return {
    x: Number(match[2]) + ((left + right) / 2) * Number(match[4]),
    y: Number(match[3]),
  };
}

it("preserves accidentals and aligns pitch overlays with engraved note heads", () => {
  const p = demoPiece();
  p.key = 2;
  const part = p.parts[0];
  const bar = notationBar(p, part, 0, 300);
  const n = part.notes[0];
  const head = firstNotehead(bar.svg);
  const left = Math.max(176, 163 + 28);
  expect(bar.x(n.tick)).toBeCloseTo(head.x - left);
  expect(bar.y(n.midi, n.tick)).toBeCloseTo(head.y - 62);
  expect(bar.y(n.midi + 0.5, n.tick)).toBeLessThan(bar.y(n.midi, n.tick));
  expect(bar.clef).toContain('data-music-symbol="sharp"');
  expect(bar.svg).not.toContain('fill="#9a929d"');
  expect(bar.x(p.bars[0].end)).toBeGreaterThan(bar.x(n.tick));
});

it("keeps note positions aligned when MusicXML key signatures change", () => {
  const p = demoPiece();
  p.key = 0;
  p.bars[1].key = 7;
  for (const index of [0, 1]) {
    const cell = notationBar(p, p.parts[0], index, 300);
    const head = firstNotehead(cell.svg);
    const left = Math.max(176, 163 + Math.abs(p.bars[index].key ?? p.key) * 14);
    expect(cell.x(p.bars[index].start)).toBeCloseTo(head.x - left);
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
  expect(
    cell.svg.match(/data-music-symbol="(?:black|half|whole)"/g) || [],
  ).toHaveLength(2);
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
  for (const length of [192, 224, 48]) {
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

it("uses traditional symbols without changing the piece", () => {
  const piece = demoPiece();
  piece.key = -2;
  const part = piece.parts[0];
  part.notes = [
    { id: "whole", midi: 60, tick: 0, length: piece.ppq * 4, velocity: 0.7 },
    {
      id: "half",
      midi: 61,
      tick: piece.ppq * 4,
      length: piece.ppq * 2,
      velocity: 0.7,
    },
    {
      id: "short",
      midi: 63,
      tick: piece.ppq * 6,
      length: piece.ppq / 2,
      velocity: 0.7,
    },
  ];
  const before = structuredClone(piece);
  for (let i = 0; i < 3; i++) {
    const traditional = notationBar(piece, part, i, 300);
    expect(traditional.svg).toContain("data-music-symbol=");
    expect(traditional.svg).not.toContain("<ellipse");
    expect(traditional.clef).toContain(
      `data-music-symbol="${part.clef ?? "treble"}"`,
    );
    expect(traditional.clef).toContain('data-music-symbol="flat"');
    expect(traditional.clef).toContain('data-music-symbol="digit4"');
  }
  expect(piece).toEqual(before);
});

it("sizes the treble clef to the staff and centres time signatures", () => {
  const piece = demoPiece();
  const part = piece.parts[0];
  part.clef = "treble";
  // Work in the header SVG's coordinate system: staff lines are at 102–142.

  for (const meter of [
    [4, 4],
    [6, 8],
    [12, 8],
  ] as [number, number][]) {
    piece.bars[0].meter = meter;
    const header = notationBar(piece, part, 0, 300).clef;
    const symbols = [
      ...header.matchAll(
        /data-music-symbol="([^"]+)"[^>]*transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+) ([-\d.]+)\)"/g,
      ),
    ];
    const clef = symbols.find((match) => match[1] === "treble")!;
    expect(clef).toBeDefined();
    expect(Number(clef[3])).toBe(132); // G line, second from the bottom.
    // Bravura's treble outline spans -658 to 1098 font units. Its visible
    // height must be about seven staff spaces, extending above and below.
    const top = Number(clef[3]) + 1098 * Number(clef[5]);
    const bottom = Number(clef[3]) - 658 * Number(clef[5]);
    expect(bottom - top).toBeCloseTo(70.24);
    expect(top).toBeLessThan(102);
    expect(bottom).toBeGreaterThan(142);
    const digits = symbols.filter((match) => match[1].startsWith("digit"));
    expect(digits.map((match) => Number(match[3]))).toEqual(
      [...String(meter[0])]
        .map(() => 112)
        .concat([...String(meter[1])].map(() => 132)),
    );
    expect(header).not.toContain("𝄞"); // No platform-dependent font fallback.
  }
});

it("uses beams without tails on joined notes and retains flags on isolated eighths", () => {
  const piece = demoPiece();
  piece.source = "musicxml"; // Written durations must not be inferred from MIDI gaps.
  const part = piece.parts[0];
  part.clef = "treble";

  for (const midi of [60, 84]) {
    // Exercise both stem directions.
    for (const secondDuration of [0.5, 0.25]) {
      part.notes = [
        { id: "first", midi, tick: 0, length: piece.ppq / 2, velocity: 0.7 },
        {
          id: "second",
          midi: midi + 2,
          tick: piece.ppq / 2,
          length: piece.ppq * secondDuration,
          velocity: 0.7,
        },
      ];
      const svg = notationBar(piece, part, 0, 300).svg;
      const noteGroups = [
        ...svg.matchAll(/<g [^>]*data-event-kind="note"[^>]*>([\s\S]*?)<\/g>/g),
      ];
      expect(noteGroups).toHaveLength(2);
      for (const note of noteGroups) {
        expect(note[1]).not.toContain('data-music-symbol="flag');
        expect(note[1]).not.toContain('stroke-width="2"');
      }
      expect(svg.match(/data-score-beam="1"/g)).toHaveLength(1);
      expect(svg.match(/data-score-beam="2"/g) ?? []).toHaveLength(
        secondDuration === 0.25 ? 1 : 0,
      );
    }
    part.notes = [
      { id: "alone", midi, tick: 0, length: piece.ppq / 2, velocity: 0.7 },
    ];
    const alone = notationBar(piece, part, 0, 300).svg;
    expect(alone).not.toContain("data-score-beam=");
    expect(alone).toContain('data-music-symbol="flag1');
  }
});

it("omits MIDI articulation gaps of a sixth beat or a quarter beat without changing playback", () => {
  for (const [span, release] of [
    [192, 32],
    [384, 48],
    [768, 48],
  ]) {
    const piece = demoPiece();
    piece.ppq = 192;
    piece.source = "midi";
    piece.bars = [{ start: 0, end: span * 2, meter: [(span * 2) / 192, 4] }];
    piece.end = span * 2;
    const part = piece.parts[0];
    part.notes = [0, span].map((tick, i) => ({
      id: `release-${i}`,
      midi: 60,
      tick,
      length: span - release,
      velocity: 0.7,
    }));
    const before = structuredClone(part.notes);
    expect(notationBar(piece, part, 0, 300).svg).not.toContain(
      'data-event-kind="rest"',
    );
    expect(part.notes).toEqual(before);
    piece.source = "musicxml";
    expect(notationBar(piece, part, 0, 300).svg).toContain(
      'data-event-kind="rest"',
    );
  }
});

