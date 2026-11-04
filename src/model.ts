import type { WebsiteCatalogue } from "./website";
import { Midi } from "@tonejs/midi";
export interface Note {
  spelling?: { note: string; octave: number };
  id: string;
  midi: number;
  tick: number;
  length: number;
  velocity: number;
}
export interface Lyric {
  verse: string;
  text: string;
  syllabic: "single" | "begin" | "middle" | "end";
  extend?: "start" | "continue" | "stop";
  tick: number;
  length: number;
}
export interface Part {
  lyrics?: Lyric[];
  clef?: "treble" | "bass";
  clefOctaveChange?: number;
  id: string;
  name: string;
  notes: Note[];
}
export interface Tempo {
  tick: number;
  bpm: number;
}
export interface Bar {
  key?: number;
  start: number;
  end: number;
  meter: [number, number];
}
export interface Piece {
  website?: { url: string; page: string; category: string[] };
  source?: "midi" | "musicxml" | "nwc";
  importWarnings?: string[];
  id: string;
  title: string;
  ppq: number;
  end: number;
  tempos: Tempo[];
  bars: Bar[];
  parts: Part[];
  key: number;
}
export interface Mix {
  volume: number;
  mute: boolean;
  visible: boolean;
}
export interface Settings {
  instrument?: import("./instruments").Instrument;
  speakers?: boolean;
  part: string;
  mix: Record<string, Mix>;
  speed: number;
  from: number;
  to: number;
  loop: boolean;
  device: string;
  channel: number;
  offset: number;
  timing: boolean;
}
export interface Sample {
  time: number;
  midi: number | null;
  confidence: number;
}
export interface NoteResult {
  note: string;
  bar: number;
  cents: number | null;
  onset: number | null;
  samples: number;
}
export interface Attempt {
  id: string;
  session: string;
  profile: string;
  piece: string;
  title: string;
  part: string;
  date: number;
  from: number;
  to: number;
  speed: number;
  results: NoteResult[];
  recording?: string;
  audioSettings: {
    speakers?: boolean;
    device: string;
    channel: number;
    offset: number;
    timing: boolean;
  };
}
export interface Profile {
  id: string;
  name: string;
}
export interface LibraryItem {
  id: string;
  parent: string | null;
  type: "folder" | "piece";
  title: string;
  pieceId?: string;
  sourceKey?: string;
}
export interface LibraryLayout {
  items: LibraryItem[];
  removedSources: string[];
}
export interface Library {
  layout?: LibraryLayout;
  websites?: WebsiteCatalogue[];
  version: 1;
  profiles: Profile[];
  pieces: Piece[];
  settings: Record<string, Settings>;
  attempts: Attempt[];
}
export function uid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // LAN HTTP pages expose getRandomValues, but not randomUUID.
  // Preserve UUID v4 format and randomness for existing backup associations.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function secondsAt(piece: Piece, tick: number): number {
  let last = 0,
    bpm = 120,
    sec = 0;
  for (const t of piece.tempos) {
    if (t.tick > tick) break;
    sec += (((t.tick - last) / piece.ppq) * 60) / bpm;
    last = t.tick;
    bpm = t.bpm;
  }
  return sec + (((tick - last) / piece.ppq) * 60) / bpm;
}
export function tickAt(piece: Piece, sec: number): number {
  let last = 0,
    bpm = 120,
    elapsed = 0;
  for (const t of piece.tempos) {
    const next = elapsed + (((t.tick - last) / piece.ppq) * 60) / bpm;
    if (next > sec) return last + ((sec - elapsed) * piece.ppq * bpm) / 60;
    elapsed = next;
    last = t.tick;
    bpm = t.bpm;
  }
  return last + ((sec - elapsed) * piece.ppq * bpm) / 60;
}
export function barAt(piece: Piece, tick: number) {
  return Math.max(
    0,
    piece.bars.findIndex((b) => tick >= b.start && tick < b.end),
  );
}
export function importMidi(data: ArrayBuffer, filename: string): Piece {
  const bytes = new Uint8Array(data);
  if (bytes.length < 14 || String.fromCharCode(...bytes.slice(0, 4)) !== "MThd")
    throw new Error("This is not a Standard MIDI file.");
  if (bytes[8] !== 0 || bytes[9] > 1)
    throw new Error("Only MIDI format 0 and 1 are supported.");
  if (bytes[12] & 128)
    throw new Error("SMPTE time-based MIDI is not supported.");
  const midi = new Midi(data),
    ppq = midi.header.ppq;
  const parts = midi.tracks
    .filter((t) => t.notes.length)
    .map((t, i) => ({
      id: uid(),
      name: t.name.trim() || `Part ${i + 1}`,
      notes: t.notes
        .map((n) => ({
          id: uid(),
          midi: n.midi,
          tick: n.ticks,
          length: n.durationTicks,
          velocity: n.velocity,
        }))
        .sort((a, b) => a.tick - b.tick),
    }));
  if (!parts.length) throw new Error("No pitched notes were found.");
  if (parts.length > 64)
    throw new Error("This version supports up to 64 tracks.");
  if (parts.some((p) => p.notes.length > 100000))
    throw new Error("A track exceeds the 100,000-note import limit.");
  const end = Math.max(
    ...midi.tracks.map((t) => t.endOfTrackTicks || 0),
    ...parts.map((p) =>
      p.notes.reduce((m, n) => Math.max(m, n.tick + n.length), 0),
    ),
  );
  const meters = midi.header.timeSignatures
    .map((t) => ({ tick: t.ticks, meter: t.timeSignature as [number, number] }))
    .sort((a, b) => a.tick - b.tick);
  const bars: Bar[] = [];
  let cursor = 0,
    index = 0,
    meter: [number, number] = [4, 4];
  while (cursor < end) {
    while (index < meters.length && meters[index].tick <= cursor) {
      meter = meters[index++].meter;
    }
    if (meter[0] <= 0 || meter[1] <= 0)
      throw new Error("Invalid time signature.");
    const next = Math.min(
      cursor + (ppq * meter[0] * 4) / meter[1],
      meters[index]?.tick ?? Infinity,
    );
    if (next <= cursor || bars.length > 20000)
      throw new Error("Invalid or excessively long score.");
    bars.push({ start: cursor, end: next, meter });
    cursor = next;
  }
  const major = [
    "Cb",
    "Gb",
    "Db",
    "Ab",
    "Eb",
    "Bb",
    "F",
    "C",
    "G",
    "D",
    "A",
    "E",
    "B",
    "F#",
    "C#",
  ];
  const minor = [
    "Ab",
    "Eb",
    "Bb",
    "F",
    "C",
    "G",
    "D",
    "A",
    "E",
    "B",
    "F#",
    "C#",
    "G#",
    "D#",
    "A#",
  ];
  const key = midi.header.keySignatures[0];
  const keys = key?.scale === "minor" ? minor : major;
  return {
    id: uid(),
    source: "midi",
    title: midi.name || filename.replace(/\.mid[i]?$/i, ""),
    ppq,
    end,
    parts,
    bars,
    key: key ? Math.max(-7, keys.indexOf(key.key) - 7) : 0,
    tempos: midi.header.tempos
      .map((t) => ({ tick: t.ticks, bpm: t.bpm }))
      .sort((a, b) => a.tick - b.tick),
  };
}
export function defaults(p: Piece): Settings {
  return {
    part: p.parts[0].id,
    mix: Object.fromEntries(
      p.parts.map((t) => [t.id, { volume: 0.65, mute: false, visible: true }]),
    ),
    instrument: "piano",
    speed: 0.8,
    from: 0,
    to: p.bars.length - 1,
    loop: false,
    device: "",
    channel: 0,
    offset: 0,
    timing: false,
  };
}
export function demoPiece(): Piece {
  const midi = new Midi();
  midi.name = "First Light · 12-part study";
  midi.header.setTempo(84);
  midi.header.timeSignatures = [
    { ticks: 0, timeSignature: [3, 4], measures: 0 },
  ];
  const pitches = [72, 69, 67, 65, 64, 62, 60, 57, 55, 53, 50, 48];
  pitches.forEach((pitch, i) => {
    const t = midi.addTrack();
    t.name =
      ["Soprano", "Alto", "Tenor", "Bass"][Math.floor(i / 3)] +
      " " +
      ((i % 3) + 1);
    for (let bar = 0; bar < 8; bar++) {
      [0, 2, 4].forEach((delta, j) =>
        t.addNote({
          midi: pitch + delta - (bar % 2 ? 2 : 0),
          ticks: (bar * 3 + j) * midi.header.ppq,
          durationTicks: midi.header.ppq,
          velocity: 0.7,
        }),
      );
    }
  });
  return importMidi(midi.toArray().buffer as ArrayBuffer, "First Light.mid");
}
export function assess(
  piece: Piece,
  part: Part,
  samples: Sample[],
  from: number,
  to: number,
  timing: boolean,
): NoteResult[] {
  return part.notes
    .filter(
      (n) => n.tick >= piece.bars[from].start && n.tick < piece.bars[to].end,
    )
    .map((n, i, notes) => {
      const start = secondsAt(piece, n.tick),
        end = secondsAt(piece, n.tick + n.length);
      const frames = samples.filter(
        (s) =>
          s.time >= start + 0.06 &&
          s.time < end &&
          s.midi !== null &&
          s.confidence >= 0.85,
      );
      const deviations = frames
        .map((s) => Math.abs(s.midi! - n.midi) * 100)
        .sort((a, b) => a - b);
      const prev = notes[i - 1];
      const repeated =
        prev &&
        prev.midi === n.midi &&
        secondsAt(piece, prev.tick + prev.length) > start - 0.15;
      const next = notes[i + 1];
      const onsetEnd = Math.min(
        start + 0.45,
        end,
        next ? secondsAt(piece, next.tick) : Infinity,
      );
      const onsetFrame =
        !repeated && timing
          ? samples.find(
              (s) =>
                s.time >= start - 0.35 &&
                s.time < onsetEnd &&
                s.midi !== null &&
                Math.abs(s.midi - n.midi) < 0.6 &&
                s.confidence >= 0.85,
            )
          : undefined;
      return {
        note: n.id,
        bar: barAt(piece, n.tick),
        cents:
          deviations.length >= 3
            ? deviations[Math.floor(deviations.length / 2)]
            : null,
        onset: onsetFrame ? (onsetFrame.time - start) * 1000 : null,
        samples: frames.length,
      };
    });
}
export function suggestions(results: NoteResult[]) {
  const bars = new Map<
    number,
    { bar: number; pitch: number; timing: number; unknown: number }
  >();
  for (const n of results) {
    const b = bars.get(n.bar) || {
      bar: n.bar,
      pitch: 0,
      timing: 0,
      unknown: 0,
    };
    if (n.cents === null) b.unknown++;
    else if (n.cents > 50) b.pitch++;
    if (n.onset !== null && Math.abs(n.onset) > 150) b.timing++;
    bars.set(n.bar, b);
  }
  return [...bars.values()]
    .sort(
      (a, b) =>
        b.pitch + b.timing - (a.pitch + a.timing) || b.unknown - a.unknown,
    )
    .filter((b) => b.pitch || b.timing || b.unknown);
}
