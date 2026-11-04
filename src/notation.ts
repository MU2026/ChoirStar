import { renderScoreSvg } from "./vendor/openvox/core/music/scoreRenderer";
import { midiToNote } from "./vendor/openvox/core/music/notes";
import { staffYForEvent } from "./vendor/openvox/core/music/scoreModel";
import type { Piece, Part } from "./model";

// The renderer's exported SVG spacing metadata lets
// overlays follow the engraved rhythm rather than assuming uniform spacing.
export function notationBar(
  piece: Piece,
  part: Part,
  index: number,
  width: number,
) {
  const b = piece.bars[index];
  const key = b.key ?? piece.key;
  const octaveChange = part.clefOctaveChange ?? 0;
  const displayPitch = (
    midi: number,
    spelling?: Part["notes"][number]["spelling"],
  ) => ({
    ...(spelling
      ? { ...spelling, octave: spelling.octave - octaveChange }
      : midiToNote(midi - octaveChange * 12, key < 0)),
    midi: midi - octaveChange * 12,
  });
  const clef =
    part.clef ??
    (part.notes.reduce((sum, n) => sum + n.midi, 0) / part.notes.length < 60
      ? "bass"
      : "treble");
  const headerLeft = Math.max(
    176,
    163 +
      Math.min(
        7,
        Math.max(
          Math.abs(piece.key),
          ...piece.bars.map((b) => Math.abs(b.key ?? piece.key)),
        ),
      ) *
        14,
  );
  const left = Math.max(176, 163 + Math.min(7, Math.abs(key)) * 14);
  const fullWidth = width + left + 34;
  // Older MusicXML imports always contain importWarnings (even when empty).
  const midiNotation =
    piece.source === "midi" ||
    (!piece.source && piece.importWarnings === undefined);
  const values = [0.25, 0.375, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
  const onsets = [...new Set(part.notes.map((n) => n.tick))].sort(
    (a, b) => a - b,
  );
  const displayEnd = (n: Part["notes"][number]) => {
    const end = Math.min(n.tick + n.length, b.end);
    if (!midiNotation) return end;
    const start = Math.max(n.tick, b.start);
    const next = Math.min(onsets.find((t) => t > n.tick) ?? b.end, b.end);
    const duration = (end - start) / piece.ppq;
    const target = (next - start) / piece.ppq;
    const gap = target - duration;
    // MIDI exports may release notes 1/6 beat early, or 1/4 beat for longer
    // values. Infer these short gaps only before aligned conventional values.
    // Exact written durations and larger gaps retain their rests.
    const conventional = (v: number) =>
      values.some((x) => Math.abs(x - v) < 0.001);
    if (
      gap > 0 &&
      gap <= Math.min(0.25, target * 0.2) &&
      conventional(target) &&
      !conventional(duration) &&
      Math.abs(
        ((start - b.start) / piece.ppq) * 4 -
          Math.round(((start - b.start) / piece.ppq) * 4),
      ) < 0.001
    )
      return next;
    return end;
  };
  const notes = part.notes
    .filter((n) => n.tick < b.end && n.tick + n.length > b.start)
    .map((n) => ({
      ...displayPitch(n.midi, n.spelling),
      id: n.id,
      start: (Math.max(n.tick, b.start) - b.start) / piece.ppq,
      duration: (displayEnd(n) - Math.max(n.tick, b.start)) / piece.ppq,
      velocity: Math.round(n.velocity * 127),
      confidence: 1,
      tieStop: n.tick < b.start,
      tieStart: n.tick + n.length > b.end,
    }));
  let svg = renderScoreSvg(
    {
      id: part.id,
      title: part.name,
      composer: "",
      tempo: 60,
      timeSignature: b.meter,
      keyFifths: key,
      notes,
      clef,
      minimumMeasures: 1,
      createdAt: 0,
      updatedAt: 0,
    },
    fullWidth,
  );
  const anchors = (
    svg.match(/data-beat-anchors="([^"]+)"/)?.[1] ||
    `0,${(b.end - b.start) / piece.ppq}`
  )
    .split(",")
    .map(Number);
  const positions = (svg.match(/data-beat-positions="([^"]+)"/)?.[1] || "0,1")
    .split(",")
    .map(Number);
  svg = svg.replace(/<text\b[^>]*>[\s\S]*?<\/text>/g, (text) =>
    / y="(?:38|66|93)"/.test(text) ? "" : text,
  );
  // Compact rows can overlap the otherwise empty SVG margins.
  svg = svg.replace('<rect width="100%" height="100%" fill="#fffdf8"/>', "");
  if (octaveChange) {
    // Match the renderer's clef centre; the marker stays inside the header crop.
    svg = svg.replace(
      "</svg>",
      `<text data-clef-octave="${octaveChange}" x="76" y="${octaveChange < 0 ? 172 : 80}" text-anchor="middle" font-family="serif" font-size="12" fill="#19161d">8</text></svg>`,
    );
  }
  const crop = (x: number, w: number) =>
    svg
      .replace(/viewBox="[^"]+"/, `viewBox="${x} 62 ${w} 130"`)
      .replace(/width="[^"]+" height="[^"]+"/, `width="${w}" height="130"`);
  return {
    svg: crop(left, width),
    clef: crop(left - headerLeft + 48, headerLeft - 48),
    x(tick: number) {
      const beat = Math.max(
        0,
        Math.min(anchors[anchors.length - 1], (tick - b.start) / piece.ppq),
      );
      let i = anchors.findIndex(
        (v, i) => i < anchors.length - 1 && beat <= anchors[i + 1],
      );
      if (i < 0) i = anchors.length - 2;
      const ratio = (beat - anchors[i]) / (anchors[i + 1] - anchors[i] || 1);
      return (
        18 +
        (positions[i] + ratio * (positions[i + 1] - positions[i])) *
          Math.max(24, width - 36)
      );
    },
    y(midi: number, tick: number) {
      // Anchor deviations to the target spelling, including sharp/flat notes.
      const target = part.notes.find(
        (n) => n.tick <= tick && n.tick + n.length > tick,
      );
      const base = target?.midi ?? Math.round(midi);
      const event = {
        ...displayPitch(base, target?.spelling),
        id: "trace",
        start: 0,
        duration: 1,
        velocity: 1,
        confidence: 1,
      };
      return staffYForEvent(event, 122, clef) - 62 - (midi - base) * 3.5;
    },
  };
}
