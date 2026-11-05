import { DOMParser } from "@xmldom/xmldom";
import { expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { importNwc, readNwcText, nwcToMusicXml } from "../src/nwc";
import { readNwcBinary } from "../src/nwc-binary";
import { parseBackup } from "../src/storage";
import { notationBar } from "../src/notation";
const parse = (text: string) =>
  new DOMParser().parseFromString(
    text,
    "application/xml",
  ) as unknown as Document;
const bytes = (text: string) =>
  new TextEncoder().encode(text).buffer as ArrayBuffer;
const score = (commands: string, name = "Test score") =>
  `!NoteWorthyComposer(2.75)\n|SongInfo|Title:"${name}"\n${commands}\n!NoteWorthyComposer-End`;
const staff = (notes: string, name = "Bass") =>
  `|AddStaff|Name:"${name}"\n|Clef|Type:Bass\n|TimeSig|Signature:4/4\n${notes}`;
it("engraves a tenor octave treble clef without changing sounding pitch or feedback alignment", async () => {
  const tenor = await importNwc(
    bytes(
      score(
        '|AddStaff|Name:"Tenor"\n|Clef|Type:Treble|OctaveShift:Octave Down\n|Note|Dur:Whole|Pos:0',
      ),
    ),
    "tenor.nwctxt",
    parse,
  );
  const treble = await importNwc(
    bytes(
      score(
        '|AddStaff|Name:"Treble"\n|Clef|Type:Treble\n|Note|Dur:Whole|Pos:0',
      ),
    ),
    "treble.nwctxt",
    parse,
  );
  const part = tenor.parts[0];
  expect(part.clef).toBe("treble");
  expect(part.clefOctaveChange).toBe(-1);
  expect(part.notes[0].midi).toBe(59);
  const rendered = notationBar(tenor, part, 0, 300);
  const normal = notationBar(treble, treble.parts[0], 0, 300);
  expect(rendered.clef).toContain('data-music-symbol="treble"');
  expect(rendered.clef).toContain('data-clef-octave="-1"');
  expect(rendered.y(59, 0)).toBe(normal.y(71, 0));
  const head = (svg: string) =>
    svg.match(/data-music-symbol="whole"[^>]*transform="([^"]+)"/)?.[1];
  expect(head(rendered.svg)).toBeDefined();
  expect(head(rendered.svg)).toBe(head(normal.svg));
  const restored = parseBackup(
    JSON.stringify({
      format: "ChoirStar backup",
      library: {
        version: 1,
        profiles: [],
        pieces: [tenor],
        settings: {},
        attempts: [],
      },
      recordings: {},
    }),
  ).library.pieces[0];
  expect(restored.parts[0].clefOctaveChange).toBe(-1);
  expect(restored.parts[0].notes[0].midi).toBe(59);
});
it("preserves the initial NWC bass clef through import and engraving", async () => {
  const piece = await importNwc(
    bytes(score(staff("|Note|Dur:Whole|Pos:0"))),
    "bass.nwctxt",
    parse,
  );
  expect(piece.parts[0].clef).toBe("bass");
  expect(piece.parts[0].notes[0].midi).toBe(50);
  expect(piece.importWarnings).not.toContain(
    "Clef changes are displayed using the initial clef.",
  );
  const rendered = notationBar(piece, piece.parts[0], 0, 300);
  expect(rendered.clef).toContain('data-music-symbol="bass"');
  expect(rendered.clef).not.toContain('data-music-symbol="treble"');
});
it("imports NWCTXT locally, preserving transposition, clef octave shifts and lyrics", async () => {
  const text = score(
    staff(
      '|StaffInstrument|Trans:12\n|Lyric1|Text:"Hel-lo"\n|Note|Dur:Half|Pos:0\n|Note|Dur:Half|Pos:1',
    ),
  );
  const p = await importNwc(bytes(text), "study.nwctxt", parse);
  expect(p.source).toBe("nwc");
  expect(p.title).toBe("Test score");
  expect(p.parts[0].notes.map((n) => n.midi)).toEqual([62, 64]);
  expect(p.parts[0].lyrics?.map((l) => [l.text, l.syllabic])).toEqual([
    ["Hel", "begin"],
    ["lo", "end"],
  ]);
  const octave = await importNwc(
    bytes(
      score(
        staff("|Clef|Type:Bass|OctaveShift:Octave Down\n|Note|Dur:Whole|Pos:0"),
      ),
    ),
    "octave.nwc",
    parse,
  );
  expect(octave.parts[0].notes[0].midi).toBe(38);
  expect(
    parseBackup(
      JSON.stringify({
        format: "ChoirStar backup",
        library: {
          version: 1,
          profiles: [],
          pieces: [p],
          settings: {},
          attempts: [],
        },
        recordings: {},
      }),
    ).library.pieces[0].source,
  ).toBe("nwc");
});
it("imports compressed files and embedded NWC 2.75 text", async () => {
  const text = score(staff("|Note|Dur:Whole|Pos:0"));
  const binary = Buffer.concat([
    Buffer.from("[NoteWorthy ArtWare]\0\0\0[NoteWorthy Composer]\0"),
    Buffer.from([0x4b, 2]),
    Buffer.from(text),
  ]);
  const compressed = Buffer.concat([
    Buffer.from("[NWZ]\0"),
    deflateSync(binary),
  ]);
  const p = await importNwc(
    compressed.buffer.slice(
      compressed.byteOffset,
      compressed.byteOffset + compressed.byteLength,
    ) as ArrayBuffer,
    "compressed.nwc",
    parse,
  );
  expect(p.parts[0].notes[0].midi).toBe(50);
  await expect(
    importNwc(bytes("[NWZ]\0bad"), "bad.nwc", parse),
  ).rejects.toThrow("compressed");
});
it("retains rests, key accidentals, ties, tuplets, chords, tempo and simple repeats", async () => {
  const p = await importNwc(
    bytes(
      score(
        staff(
          "|Key|Signature:F#\n|Tempo|Tempo:60|Base:Quarter\n|Bar|Style:MasterRepeatOpen\n|Note|Dur:Half|Pos:#2^\n|Note|Dur:Half|Pos:2\n|Bar\n|Chord|Dur:Half|Pos:0,2\n|Rest|Dur:Half\n|Bar|Style:MasterRepeatClose|Repeat:2",
        ),
      ),
    ),
    "rhythm.nwc",
    parse,
  );
  expect(p.bars).toHaveLength(4);
  expect(p.parts[0].notes[0].length).toBe(3840);
  expect(p.parts[0].notes[0].midi).toBe(54);
  expect(p.tempos[0].bpm).toBe(60);
  const triplet = await importNwc(
    bytes(
      score(
        staff(
          "|Note|Dur:4th,Triplet|Pos:0\n|Note|Dur:4th,Triplet|Pos:1\n|Note|Dur:4th,Triplet|Pos:2",
        ),
      ),
    ),
    "triplet.nwc",
    parse,
  );
  expect(triplet.parts[0].notes.map((n) => n.length)).toEqual([640, 640, 640]);
});
it("supports twelve parts and quoted separators without executing text", async () => {
  const p = await importNwc(
    bytes(
      score(
        Array.from({ length: 12 }, (_, i) =>
          staff("|Note|Dur:Whole|Pos:0", `Voice ${i + 1}`),
        ).join("\n"),
        "A | B & <C>",
      ),
    ),
    "12.nwc",
    parse,
  );
  expect(p.parts).toHaveLength(12);
  expect(p.title).toBe("A | B & <C>");
});
it("rejects incomplete navigation, unequal chord voices and malformed text", async () => {
  for (const command of [
    "|Ending|Endings:1",
    "|Flow|Style:DaCapo",
    "|Chord|Dur:Half|Pos:0|Dur2:4th|Pos2:2",
  ]) {
    await expect(
      importNwc(bytes(score(staff(command))), "bad.nwc", parse),
    ).rejects.toThrow();
  }
  expect(() => readNwcText("not a score")).toThrow();
  expect(() =>
    nwcToMusicXml(
      readNwcText(score(staff("|Note|Dur:Whole|Pos:9999"))),
      "bad.nwc",
    ),
  ).toThrow("position");
});

function binaryStudy(
  version = 0x14b,
  count = 1,
  extra: number[][] = [],
  clef?: number,
  lyricVerses: string[][] = [],
) {
  const u16 = (n: number) => Buffer.from([n & 255, (n >> 8) & 255]);
  const str = (s = "") => Buffer.from(s + "\0");
  const zero = (n: number) => Buffer.alloc(n);
  const modern = version >= 0x200;
  const header = [
    Buffer.from("[NoteWorthy ArtWare]\0\0\0[NoteWorthy Composer]\0"),
    u16(version),
    zero(4),
    str("qa"),
    str(),
    zero(10),
    str("Binary study"),
    str(),
    ...(modern ? [str()] : []),
    str(),
    str(),
    str(),
    zero(9),
    u16(1),
    str("0 0 0 0"),
    zero(3),
    zero(33),
    ...(modern ? [str()] : []),
    u16(24),
    Buffer.from([1, 1]),
    ...Array.from({ length: 12 }, () =>
      Buffer.concat([str("Times"), Buffer.from([0, 12, 0, 0])]),
    ),
    zero(4),
    ...(modern ? [zero(1)] : []),
    u16(count),
  ];
  const note = Buffer.concat([
    u16(8),
    zero(1),
    Buffer.from([0, 0, 0, 0, 0, 0, 0, 5]),
  ]);
  const staffs = Array.from({ length: count }, (_, i) =>
    Buffer.concat([
      str(`Voice ${i + 1}`),
      ...(modern ? [str(), str()] : []),
      str(),
      ...(modern
        ? [zero(27), Buffer.from([5]), u16(0), u16(12), zero(5)]
        : [zero(22), Buffer.from([12]), zero(6)]),
      u16(0),
      u16(lyricVerses.length),
      ...(lyricVerses.length
        ? [
            zero(4),
            ...lyricVerses.map((slots) => {
              const data = Buffer.concat([u16(0), ...slots.map(str), str()]);
              return Buffer.concat([u16(data.length), u16(0), data]);
            }),
            u16(0),
          ]
        : []),
      u16(0),
      u16(3 + extra.length + (clef === undefined ? 0 : 1)),
      ...(clef === undefined
        ? []
        : [Buffer.concat([u16(0), zero(1), u16(clef), u16(0)])]),
      note,
      ...extra.map((event) => Buffer.from(event)),
    ]),
  );
  const buffer = Buffer.concat([...header, ...staffs]);
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.length,
  ) as ArrayBuffer;
}
it("preserves blank binary lyric slots so later verses start in the third bar", async () => {
  const note = [8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5];
  const bar = [2, 0, 0, 0, 0];
  for (const version of [0x14b, 0x200, 0x201]) {
    const data = binaryStudy(
      version,
      1,
      [bar, note, bar, note, bar, note],
      undefined,
      [
        ["Hum", " hum", " Win", "-ter"],
        [" ", "  ", "\rSing", "-ing"],
        [" ", "  ", " Soft", "-ly"],
      ],
    );
    const commands = readNwcBinary(new Uint8Array(data));
    expect(commands.find((c) => c.name === "Lyric2")?.lyricSyllables).toEqual([
      " ",
      "  ",
      "\rSing",
      "-ing",
    ]);
    const piece = await importNwc(data, "verse-study.nwc", parse);
    const lyrics = piece.parts[0].lyrics!;
    for (const verse of ["2", "3"]) {
      const events = lyrics.filter((lyric) => lyric.verse === verse);
      expect(events).toHaveLength(2);
      expect(events.map((lyric) => lyric.tick)).toEqual([
        piece.bars[2].start,
        piece.bars[3].start,
      ]);
      expect(events.map((lyric) => lyric.syllabic)).toEqual(["begin", "end"]);
    }
    expect(lyrics.filter((l) => l.verse === "1").map((l) => l.tick)).toEqual(
      piece.bars.map((bar) => bar.start),
    );
  }
});
it("preserves binary NWC bass clefs for every supported binary version", async () => {
  for (const version of [0x14b, 0x200, 0x201]) {
    const piece = await importNwc(
      binaryStudy(version, 1, [], 1),
      "bass.nwc",
      parse,
    );
    expect(piece.parts[0].clef).toBe("bass");
    expect(piece.parts[0].notes[0].midi).toBe(62);
    expect(piece.importWarnings).not.toContain(
      "Clef changes are displayed using the initial clef.",
    );
  }
});
it("keeps the default treble clef when no clef precedes the music", async () => {
  const piece = await importNwc(
    bytes(
      score(
        '|AddStaff|Name:"Voice"\n|Note|Dur:Whole|Pos:0\n|Bar\n|Clef|Type:Bass\n|Note|Dur:Whole|Pos:0',
      ),
    ),
    "change.nwctxt",
    parse,
  );
  expect(piece.parts[0].clef).toBe("treble");
  expect(piece.parts[0].notes.map((note) => note.midi)).toEqual([71, 50]);
  expect(piece.importWarnings).toContain(
    "Clef changes are displayed using the initial clef.",
  );
});
it("imports bounded binary 1.75, 2.0 and 2.01 scores with twelve staves", async () => {
  for (const version of [0x14b, 0x200, 0x201]) {
    const piece = await importNwc(
      binaryStudy(version, 12),
      "binary.nwc",
      parse,
    );
    expect(piece.parts).toHaveLength(12);
    expect(piece.parts[0].notes[0].midi).toBe(83);
  }
  await expect(
    importNwc(binaryStudy().slice(0, 100), "truncated.nwc", parse),
  ).rejects.toThrow("Truncated");
});
it("rejects decompression overflow without allocating an unbounded output", async () => {
  const compressed = Buffer.concat([
    Buffer.from("[NWZ]\0"),
    deflateSync(Buffer.alloc(20 * 1024 * 1024 + 1, 65)),
  ]);
  await expect(
    importNwc(
      compressed.buffer.slice(
        compressed.byteOffset,
        compressed.byteOffset + compressed.length,
      ) as ArrayBuffer,
      "large.nwc",
      parse,
    ),
  ).rejects.toThrow("20 MB");
});

it("preserves tied accidentals across a bar boundary", async () => {
  const piece = await importNwc(
    bytes(score(staff("|Note|Dur:Whole|Pos:#2^\n|Bar\n|Note|Dur:Whole|Pos:2"))),
    "tie.nwc",
    parse,
  );
  expect(piece.parts[0].notes).toHaveLength(1);
  expect(piece.parts[0].notes[0].midi).toBe(54);
  expect(piece.parts[0].notes[0].length).toBe(7680);
});

it("unfolds NWC alternate endings through the shared MusicXML timeline", async () => {
  const p = await importNwc(
    bytes(
      score(
        staff(
          [
            "|Bar|Style:MasterRepeatOpen",
            "|Note|Dur:Whole|Pos:0",
            "|Bar",
            "|Ending|Endings:1",
            "|Note|Dur:Whole|Pos:1",
            "|Bar|Style:MasterRepeatClose",
            "|Ending|Endings:2",
            "|Note|Dur:Whole|Pos:2",
          ].join("\n"),
        ),
      ),
    ),
    "endings.nwctxt",
    parse,
  );
  expect(p.parts[0].notes.map((n) => n.midi)).toEqual([50, 52, 50, 53]);
});
it("unfolds NWC D.S. al Coda and D.C. al Fine", async () => {
  const p = await importNwc(
    bytes(
      score(
        staff(
          [
            "|Note|Dur:Whole|Pos:0",
            "|Bar",
            "|Flow|Style:Segno",
            "|Note|Dur:Whole|Pos:1",
            "|Bar",
            "|Note|Dur:Whole|Pos:2",
            "|Flow|Style:ToCoda",
            "|Bar",
            "|Note|Dur:Whole|Pos:3",
            "|Flow|Style:DSalCoda",
            "|Bar",
            "|Note|Dur:Whole|Pos:4",
            "|Bar",
            "|Flow|Style:Coda",
            "|Note|Dur:Whole|Pos:5",
          ].join("\n"),
        ),
      ),
    ),
    "coda.nwc",
    parse,
  );
  expect(p.parts[0].notes.map((n) => n.midi)).toEqual([
    50, 52, 53, 55, 52, 53, 59,
  ]);
  const fine = await importNwc(
    bytes(
      score(
        staff(
          "|Note|Dur:Whole|Pos:0\n|Flow|Style:Fine\n|Bar\n|Note|Dur:Whole|Pos:1\n|Flow|Style:DCalFine",
        ),
      ),
    ),
    "fine.nwc",
    parse,
  );
  expect(fine.parts[0].notes.map((n) => n.midi)).toEqual([50, 52, 50]);
});
it("uses the NWC default ending after a D.C. return", async () => {
  const p = await importNwc(
    bytes(
      score(
        staff(
          [
            "|Bar|Style:MasterRepeatOpen",
            "|Note|Dur:Whole|Pos:0",
            "|Bar",
            "|Ending|Endings:1",
            "|Note|Dur:Whole|Pos:1",
            "|Bar|Style:MasterRepeatClose",
            "|Ending|Endings:2",
            "|Note|Dur:Whole|Pos:2",
            "|Bar|Style:SectionClose",
            "|Ending|Endings:D",
            "|Note|Dur:Whole|Pos:3",
            "|Flow|Style:Fine",
            "|Bar|Style:SectionClose",
            "|Note|Dur:Whole|Pos:4",
            "|Flow|Style:DCalFine",
          ].join("\n"),
        ),
      ),
    ),
    "default.nwc",
    parse,
  );
  expect(p.parts[0].notes.map((n) => n.midi)).toEqual([
    50, 52, 50, 53, 57, 50, 55,
  ]);
});

it("decodes binary ending bitmasks and flow styles without losing byte alignment", () => {
  const events = [
    [3, 0, 0, 5, 0],
    [12, 0, 0, 0, 0, 8, 0],
    [3, 0, 0, 128, 0],
  ];
  for (const version of [0x14b, 0x200, 0x201]) {
    const commands = readNwcBinary(
      new Uint8Array(binaryStudy(version, 1, events)),
    );
    expect(commands.filter((c) => ["Ending", "Flow"].includes(c.name))).toEqual(
      [
        { name: "Ending", fields: { Endings: "1,3" } },
        { name: "Flow", fields: { Style: "DSalCoda" } },
        { name: "Ending", fields: { Endings: "D" } },
      ],
    );
  }
});

it("keeps a slurred syllable across a bar and repeats the following lyric at the correct note", async () => {
  const note = (slur = 0) => [8, 0, 0, 0, 0, 0, 0, 0, slur, 0, 5];
  const bar = [2, 0, 0, 0, 0];
  for (const version of [0x14b, 0x200, 0x201]) {
    const data = binaryStudy(
      version,
      1,
      [
        bar,
        [2, 0, 0, 6, 0],
        note(1),
        bar,
        note(2),
        bar,
        note(),
        [2, 0, 0, 7, 2],
      ],
      undefined,
      [["Intro", " Sing", " Next"]],
    );
    const p = await importNwc(data, "slur-study.nwc", parse);
    const lyrics = p.parts[0].lyrics!;
    expect(p.bars).toHaveLength(7);
    expect(lyrics.filter((l) => l.text).map((l) => [l.text, l.tick])).toEqual([
      ["Intro", p.bars[0].start],
      ["Sing", p.bars[1].start],
      ["Next", p.bars[3].start],
      ["Sing", p.bars[4].start],
      ["Next", p.bars[6].start],
    ]);
    expect(lyrics.find((l) => l.tick === p.bars[1].start)?.extend).toBe(
      "start",
    );
    expect(lyrics.find((l) => l.tick === p.bars[2].start)).toMatchObject({
      text: "",
      extend: "stop",
    });
  }
});
it("honors explicit binary lyric Always/Never overrides", async () => {
  const never = [8, 0, 0, 0, 0, 0, 1, 0, 0, 0, 5];
  const alwaysEnd = [8, 0, 0, 0, 0, 128, 0, 0, 2, 0, 5];
  const normal = [8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5];
  for (const version of [0x14b, 0x200, 0x201]) {
    const data = binaryStudy(
      version,
      1,
      [never, alwaysEnd, normal],
      undefined,
      [["First", " Second", " Third"]],
    );
    const commands = readNwcBinary(new Uint8Array(data)).filter(
      (c) => c.name === "Note",
    );
    expect(commands[1].fields.Opts).toBe("Lyric=Never");
    expect(commands[2].fields.Opts).toBe("Lyric=Always");
    const p = await importNwc(data, "overrides.nwc", parse);
    expect(p.parts[0].lyrics!.filter((l) => l.text).map((l) => l.tick)).toEqual(
      [0, 7680, 11520],
    );
  }
});
it("uses NWCTXT slur continuation without consuming another lyric token", async () => {
  const p = await importNwc(
    bytes(
      score(
        staff(
          '|Lyric1|Text:"Sing next"\n|Note|Dur:Whole,Slur|Pos:0\n|Bar\n|Note|Dur:Whole|Pos:1\n|Bar\n|Note|Dur:Whole|Pos:2',
        ),
      ),
    ),
    "text-slur.nwctxt",
    parse,
  );
  expect(
    p.parts[0].lyrics!.filter((l) => l.text).map((l) => [l.text, l.tick]),
  ).toEqual([
    ["Sing", 0],
    ["next", 7680],
  ]);
});
