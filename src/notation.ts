import { renderScoreSvg } from "./vendor/openvox/core/music/scoreRenderer";
import { midiToNote } from "./vendor/openvox/core/music/notes";
import { musicTimeNumber } from "./vendor/bravura/symbols";
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
  const meterChanged =
    index > 0 && b.meter.join("/") !== piece.bars[index - 1].meter.join("/");
  const signatureWidth = meterChanged ? 30 : 0;
  const noteWidth = width - signatureWidth;
  const padding = 34;
  const fullWidth = noteWidth + left + 34;
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
    .map((n) => {
      const start = (Math.max(n.tick, b.start) - b.start) / piece.ppq;
      const duration = (displayEnd(n) - Math.max(n.tick, b.start)) / piece.ppq;
      // Older imports lost triplet metadata. Recover exact thirds only for
      // written scores; MIDI articulation gaps must keep their own handling.
      const onGrid = (v: number) =>
        Math.abs(v * 16 - Math.round(v * 16)) < 1e-6;
      const triplet =
        !midiNotation && !onGrid(duration) && onGrid(duration * 1.5);
      const actual = n.tupletActual ?? (triplet ? 3 : undefined);
      const normal = n.tupletNormal ?? (triplet ? 2 : undefined);
      return {
        ...displayPitch(n.midi, n.spelling),
        id: n.id,
        slurStart: n.slurStart && n.tick >= b.start,
        slurStop: n.slurStop && n.tick + n.length <= b.end,
        start,
        duration,
        ...(actual && normal
          ? {
              tupletActual: actual,
              tupletNormal: normal,
              tupletGroupId: `tuplet-${Math.round(duration * piece.ppq)}-${Math.floor((start + 1e-6) / (duration * actual))}`,
            }
          : {}),
        velocity: Math.round(n.velocity * 127),
        confidence: 1,
        tieStop: n.tick < b.start,
        tieStart: n.tick + n.length > b.end,
      };
    });
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
    { measurePadding: padding },
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
  const octaveMarker = octaveChange
    ? `<text data-clef-octave="${octaveChange}" x="76" y="${octaveChange < 0 ? 172 : 80}" text-anchor="middle" font-family="serif" font-size="12" fill="#19161d">8</text>`
    : "";
  if (octaveChange) {
    // Match the renderer's clef centre; the marker stays inside the header crop.
    svg = svg.replace("</svg>", `${octaveMarker}</svg>`);
  }
  const crop = (x: number, w: number) =>
    svg
      .replace(/viewBox="[^"]+"/, `viewBox="${x} 62 ${w} 130"`)
      .replace(/width="[^"]+" height="[^"]+"/, `width="${w}" height="130"`);
  const xAtTick = (tick: number) => {
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
      signatureWidth +
      padding +
      (positions[i] + ratio * (positions[i + 1] - positions[i])) *
        Math.max(24, noteWidth - padding * 2)
    );
  };
  let body = crop(left - signatureWidth, width).replace(
    /<path data-music-symbol="digit\d"[^>]*\/>/g,
    "",
  );
  if (meterChanged) {
    // The signature occupies the beginning of this bar, after its opening line.
    const boundary = left - signatureWidth;
    body = body.replace(
      `<line x1="${left}" y1="102" x2="${left}" y2="142"`,
      `<line x1="${boundary}" y1="102" x2="${boundary}" y2="142"`,
    );
    const signature =
      musicTimeNumber(b.meter[0], left - signatureWidth / 2, 112) +
      musicTimeNumber(b.meter[1], left - signatureWidth / 2, 132);
    body = body.replace("</svg>", `${signature}</svg>`);
  }
  // Each bar owns its half of a tie. Boundary endpoints have a horizontal
  // tangent, so adjacent SVGs join cleanly and either half survives scrolling.
  const ties = notes.flatMap((note) => {
    const y = staffYForEvent(note, 122, clef);
    const direction = y > 162 ? -1 : 1;
    const near = y + direction * 9;
    const far = y + direction * 20;
    const noteX =
      left - signatureWidth + xAtTick(b.start + note.start * piece.ppq);
    const boundaryLeft = left - signatureWidth;
    const boundaryRight = boundaryLeft + width;
    const half = (edge: "start" | "end") => {
      const incoming = edge === "start";
      const x1 = incoming ? boundaryLeft : noteX + 7;
      const x2 = incoming ? noteX - 7 : boundaryRight;
      const span = x2 - x1;
      return `<path data-score-tie="true" data-tie-edge="${edge}" d="M ${x1} ${incoming ? far : near} C ${x1 + span / 3} ${far} ${x2 - span / 3} ${far} ${x2} ${incoming ? near : far}" fill="none" stroke="#19161d" stroke-width="1.5" stroke-linecap="round"/>`;
    };
    return [
      ...(note.tieStop ? [half("start")] : []),
      ...(note.tieStart ? [half("end")] : []),
    ];
  });
  body = body.replace("</svg>", `${ties.join("")}</svg>`);
  return {
    svg: body,
    clef: crop(left - headerLeft + 48, headerLeft - 48).replace(
      /<rect [^>]*data-score-hitbox=[\s\S]*<\/svg>/,
      `${octaveMarker}</svg>`,
    ),
    x: xAtTick,
    tickAtX(x: number) {
      const position = Math.max(
        0,
        Math.min(
          1,
          (x - signatureWidth - padding) /
            Math.max(24, noteWidth - padding * 2),
        ),
      );
      let i = positions.findIndex(
        (value, i) => i < positions.length - 1 && position <= positions[i + 1],
      );
      if (i < 0) i = positions.length - 2;
      const ratio =
        (position - positions[i]) / (positions[i + 1] - positions[i] || 1);
      return Math.min(
        b.end,
        b.start +
          (anchors[i] + ratio * (anchors[i + 1] - anchors[i])) * piece.ppq,
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
