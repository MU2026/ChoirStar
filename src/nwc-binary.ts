// Binary field reader adapted from music21 10.5.2 noteworthy/binaryTranslate.py.
// Copyright (c) 2006-2026 Michael Scott Asato Cuthbert. BSD-3-Clause;
// see vendor/music21/LICENSE. Modified for ChoirStar, 2026-11-04:
// TypeScript port, bounded reads, explicit version/feature errors, lyrics and
// transposition retained, and neutral commands rather than music21 objects.
export interface NwcCommand {
  name: string;
  fields: Record<string, string>;
}
export const nwcDecode = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
};
class Reader {
  pos = 0;
  constructor(readonly bytes: Uint8Array) {}
  take(n: number) {
    if (!Number.isInteger(n) || n < 0 || this.pos + n > this.bytes.length)
      throw new Error("Truncated NWC file.");
    const result = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return result;
  }
  skip(n: number) {
    this.take(n);
  }
  u8() {
    return this.take(1)[0];
  }
  i8() {
    const n = this.u8();
    return n > 127 ? n - 256 : n;
  }
  u16() {
    const b = this.take(2);
    return b[0] + b[1] * 256;
  }
  i16() {
    const n = this.u16();
    return n > 32767 ? n - 65536 : n;
  }
  string() {
    const start = this.pos;
    while (this.pos < this.bytes.length && this.bytes[this.pos]) this.pos++;
    const text = nwcDecode(this.bytes.subarray(start, this.pos));
    this.skip(1);
    return text;
  }
}
export function readNwcBinary(bytes: Uint8Array): NwcCommand[] {
  const r = new Reader(bytes);
  const header = "[NoteWorthy ArtWare]\0\0\0[NoteWorthy Composer]\0";
  if (nwcDecode(r.take(header.length)) !== header)
    throw new Error("This is not a NoteWorthy Composer file.");
  const version = r.u16();
  if (![0x14b, 0x200, 0x201].includes(version))
    throw new Error(
      `NWC binary version 0x${version.toString(16)} is not supported. Export NWCTXT or MusicXML from the source application.`,
    );
  const modern = version >= 0x200;
  r.skip(4);
  r.string();
  r.string();
  r.skip(10);
  const title = r.string();
  r.string();
  if (modern) r.string();
  r.string();
  r.string();
  r.string();
  r.skip(9);
  r.u16();
  r.string();
  r.skip(3);
  r.skip(33);
  if (modern) r.string();
  r.u16();
  while (r.bytes[r.pos] === 0 && r.pos < bytes.length) r.skip(1);
  r.skip(2);
  for (let i = 0; i < (version > 0x146 ? 12 : 10); i++) {
    r.string();
    r.skip(4);
  }
  r.skip(4);
  if (modern) r.skip(1);
  const count = r.u16();
  if (count < 1 || count > 64)
    throw new Error("NWC must contain between 1 and 64 staves.");
  const commands: NwcCommand[] = [
    { name: "SongInfo", fields: { Title: title } },
  ];
  const emit = (name: string, fields: Record<string, string> = {}) =>
    commands.push({ name, fields });
  const durations = ["Whole", "Half", "4th", "8th", "16th", "32nd", "64th"];
  let objectCount = 0;
  function object(nesting = 0): NwcCommand | null {
    if (++objectCount > 100000 || nesting > 8)
      throw new Error("NWC contains too many notation objects.");
    const type = r.u16();
    r.u8();
    if (type === 0) {
      const clef = r.u16(),
        octave = r.u16();
      return {
        name: "Clef",
        fields: {
          Type: ["Treble", "Bass", "Alto", "Tenor"][clef] || "Unsupported",
          OctaveShift:
            ["", "Octave Up", "Octave Down"][octave] ?? "Unsupported",
        },
      };
    }
    if (type === 1) {
      const flat = r.u8();
      r.skip(1);
      const sharp = r.u8();
      r.skip(7);
      if (flat && sharp)
        throw new Error("Custom NWC key signatures are not supported.");
      const mask = flat || sharp;
      const masks = flat
        ? [0, 2, 18, 19, 27, 91, 95, 127]
        : [0, 32, 36, 100, 108, 109, 125, 127];
      const fifths = masks.indexOf(mask) * (flat ? -1 : 1);
      if (!masks.includes(mask))
        throw new Error("Custom NWC key signatures are not supported.");
      return { name: "Key", fields: { Fifths: String(fifths) } };
    }
    if (type === 2) {
      const style = r.u8() & 15,
        times = r.u8();
      return {
        name: "Bar",
        fields: {
          Style:
            [
              "Single",
              "Double",
              "SectionOpen",
              "SectionClose",
              "LocalRepeatOpen",
              "LocalRepeatClose",
              "MasterRepeatOpen",
              "MasterRepeatClose",
              "Hidden",
            ][style] || "Single",
          Repeat: String(times),
        },
      };
    }
    if (type === 3) {
      const mask = r.u8();
      r.skip(1);
      if (mask & 128 && mask !== 128)
        throw new Error(
          "Combined NWC default and numbered endings are not supported.",
        );
      const endings = Array.from({ length: 7 }, (_, i) => i + 1).filter(
        (n) => mask & (1 << (n - 1)),
      );
      return {
        name: "Ending",
        fields: { Endings: mask === 128 ? "D" : endings.join(",") },
      };
    }
    if (type === 4) {
      r.skip(8);
      throw new Error(
        "Mid-score NWC instrument changes are not supported. Export MusicXML.",
      );
    }
    if (type === 5) {
      const n = r.u16(),
        bits = r.u16();
      r.skip(2);
      return { name: "TimeSig", fields: { Signature: `${n}/${2 ** bits}` } };
    }
    if (type === 6) {
      r.skip(2);
      const bpm = r.u16(),
        base = r.u8();
      const text = r.string();
      return {
        name: "Tempo",
        fields: {
          Tempo: String(bpm),
          Base:
            [
              "Half",
              "Half,Dotted",
              "Quarter",
              "Quarter,Dotted",
              "Eighth",
              "Eighth,Dotted",
            ][base] || "Quarter",
          Text: text,
        },
      };
    }
    if (type === 8 || type === 9) {
      const duration = r.u8();
      if (!durations[duration]) throw new Error("Invalid NWC note duration.");
      const data = r.take(type === 8 ? 3 : 5);
      let dots: number,
        grace = false,
        tie = false,
        pos = "",
        attr = 0;
      if (type === 8) {
        dots = r.u8();
        const extra = r.u8();
        grace = !!(extra & 32);
        tie = !!(dots & 16);
        const pitch = -r.i8();
        attr = r.u8();
        pos =
          (["#", "b", "n", "x", "v", ""][attr & 7] ?? "") +
          pitch +
          (tie ? "^" : "");
        if (version <= 0x146) r.skip(2);
        if (modern && attr & 64) r.skip(1);
      } else {
        dots = data[3];
        r.skip(2);
      }
      return {
        name: type === 8 ? "Note" : "Rest",
        fields: {
          Dur:
            durations[duration] +
            (dots & 1 ? ",DblDotted" : dots & 4 ? ",Dotted" : "") +
            (data[1] & 12 ? ",Triplet" : "") +
            (grace ? ",Grace" : ""),
          Pos: pos,
        },
      };
    }
    if (type === 10) {
      if (version !== 0x14b)
        throw new Error(
          "Chords in this NWC binary version require a NWCTXT or MusicXML export.",
        );
      const data = r.take(10),
        notes: NwcCommand[] = [];
      for (let i = 0; i < data[8]; i++) {
        const note = object(nesting + 1);
        if (!note || note.name !== "Note")
          throw new Error("Unsupported NWC chord.");
        notes.push(note);
      }
      if (
        !notes.length ||
        notes.some((n) => n.fields.Dur !== notes[0].fields.Dur)
      )
        throw new Error(
          "NWC chords with unequal voice durations require MusicXML export.",
        );
      return {
        name: "Chord",
        fields: {
          Dur: notes[0].fields.Dur,
          Pos: notes.map((n) => n.fields.Pos).join(","),
        },
      };
    }
    if (type === 7) r.skip(7);
    else if (type === 11) r.skip(3);
    else if (type === 12) {
      r.skip(2);
      const style = [
        "Coda",
        "Segno",
        "Fine",
        "ToCoda",
        "DaCapo",
        "DCalCoda",
        "DCalFine",
        "DalSegno",
        "DSalCoda",
        "DSalFine",
      ][r.u16()];
      if (!style) throw new Error("Unknown NWC navigation instruction.");
      return { name: "Flow", fields: { Style: style } };
    } else if (type === 13) {
      r.skip(version === 0x14b ? 34 : 33);
    } else if (type === 14) {
      r.skip(4);
      return { name: "TempoVariance", fields: {} };
    } else if (type === 15 || type === 16) r.skip(3);
    else if (type === 17) {
      r.skip(3);
      r.string();
    } else
      throw new Error(
        `Unsupported NWC notation object ${type}. Export NWCTXT or MusicXML.`,
      );
    return null;
  }
  for (let staff = 0; staff < count; staff++) {
    const name = r.string();
    let label = "";
    if (modern) {
      label = r.string();
      r.string();
    }
    r.string();
    let transpose: number, verses: number;
    if (modern) {
      r.skip(27);
      r.u8();
      r.u16();
      transpose = r.i16();
      r.skip(5);
      r.u16();
      verses = r.u16();
    } else {
      r.skip(22);
      transpose = r.i8();
      r.skip(6);
      r.u16();
      verses = r.u16();
    }
    if (verses < 0 || verses > 16) throw new Error("Invalid NWC lyric count.");
    emit("AddStaff", { Name: label || name || `Part ${staff + 1}` });
    emit("StaffInstrument", { Trans: String(transpose) });
    if (verses) r.skip(4);
    for (let verse = 0; verse < verses; verse++) {
      const length = r.u16();
      if (length) {
        r.u16();
        const end = r.pos + length;
        r.u16();
        const syllables: string[] = [];
        while (r.pos < end) {
          const word = r.string();
          if (!word) break;
          syllables.push(word);
        }
        if (r.pos > end || end > bytes.length)
          throw new Error("Invalid NWC lyric block.");
        r.pos = end;
        emit(`Lyric${verse + 1}`, { Text: syllables.join(" ") });
      }
    }
    if (verses) r.u16();
    r.u16();
    const objects = r.u16() - 2;
    if (objects < 0 || objects > 100000)
      throw new Error("Invalid NWC object count.");
    for (let i = 0; i < objects; i++) {
      const command = object();
      if (command) commands.push(command);
    }
  }
  return commands;
}
