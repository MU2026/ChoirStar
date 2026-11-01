import { DOMParser } from "@xmldom/xmldom";
import { expect, it } from "vitest";
import { importMusicXml } from "../src/musicxml";
import { secondsAt, defaults, type Library } from "../src/model";
import { parseBackup } from "../src/storage";
const parse = (xml: string) =>
  importMusicXml(
    xml,
    "Score.musicxml",
    new DOMParser().parseFromString(
      xml,
      "application/xml",
    ) as unknown as Document,
  );
const score = (bars: string, second = "") =>
  `<score-partwise><work><work-title>Test choir</work-title></work><part-list><score-part id="P1"><part-name>Alto</part-name></score-part></part-list><part id="P1">${bars}</part>${second}</score-partwise>`;
const attr =
  "<attributes><divisions>4</divisions><time><beats>3</beats><beat-type>4</beat-type></time><key><fifths>-1</fifths></key><clef><sign>G</sign><line>2</line></clef></attributes>";
const note = (
  duration = 4,
  extra = "",
  pitch = "<step>B</step><alter>-1</alter><octave>3</octave>",
) =>
  `<note><pitch>${pitch}</pitch><duration>${duration}</duration>${extra}</note>`;
it("preserves pickups, tempo changes, rests, ties, and spelling", () => {
  const p = parse(
    score(
      `<measure implicit="yes">${attr}<direction><sound tempo="60"/></direction>${note(4, '<tie type="start"/>')}</measure><measure>${note(8, '<tie type="stop"/>')}<note><rest/><duration>4</duration></note></measure><measure><direction><sound tempo="120"/></direction>${note(12)}</measure>`,
    ),
  );
  expect(p.title).toBe("Test choir");
  expect(p.parts[0].name).toBe("Alto");
  expect(p.parts[0].clef).toBe("treble");
  expect(p.parts[0].notes).toHaveLength(2);
  expect(p.parts[0].notes[0]).toMatchObject({
    midi: 58,
    tick: 0,
    length: 2880,
    spelling: { note: "B♭", octave: 3 },
  });
  expect(p.bars.map((b) => b.end - b.start)).toEqual([960, 2880, 2880]);
  expect(secondsAt(p, p.end)).toBe(5.5);
});
it("separates concurrent voices, retains chords and forwards, applies transposition", () => {
  const p = parse(
    score(
      `<measure>${attr}<attributes><transpose><chromatic>-2</chromatic></transpose></attributes>${note(4, "<voice>1</voice>")}<note><chord/><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note><forward><duration>8</duration></forward><backup><duration>12</duration></backup>${note(12, "<voice>2</voice>")}</measure>`,
    ),
  );
  expect(p.parts).toHaveLength(2);
  expect(p.parts[0].notes.map((n) => [n.tick, n.midi])).toEqual([
    [0, 56],
    [0, 60],
  ]);
  expect(p.parts[1].notes[0].tick).toBe(0);
  expect(p.bars[0].end).toBe(2880);
});
it("unfolds repeat counts with unique notes and restores tempo on return", () => {
  const p = parse(
    score(
      `<measure>${attr}<direction><sound tempo="60"/></direction>${note(12)}</measure><measure><barline><repeat direction="forward"/></barline>${note(12)}</measure><measure><direction><sound tempo="120"/></direction>${note(12)}<barline><repeat direction="backward" times="3"/></barline></measure>`,
    ),
  );
  expect(p.bars).toHaveLength(7);
  expect(p.tempos.map((t) => [t.tick / 960, t.bpm])).toEqual([
    [0, 60],
    [6, 120],
    [9, 60],
    [12, 120],
    [15, 60],
    [18, 120],
  ]);
  expect(new Set(p.parts[0].notes.map((n) => n.id)).size).toBe(7);
  expect(defaults(p).to).toBe(6);
});
it("rejects unsupported navigation, bad durations, microtones, and entity declarations", () => {
  expect(() =>
    parse(
      score(
        `<measure>${attr}<barline><ending number="1" type="start"/></barline>${note()}</measure>`,
      ),
    ),
  ).toThrow(/endings/);
  expect(() => parse(score(`<measure>${attr}${note(-4)}</measure>`))).toThrow(
    /duration/,
  );
  expect(() =>
    parse(
      score(
        `<measure>${attr}${note(4, "", "<step>C</step><alter>0.5</alter><octave>4</octave>")}</measure>`,
      ),
    ),
  ).toThrow(/microtones/);
  expect(() => importMusicXml('<!ENTITY x "bad">', "bad.xml")).toThrow(
    /entity/,
  );
  expect(() => parse("<score-timewise/>")).toThrow(/partwise/);
});
it("preserves MusicXML metadata in backups", () => {
  const p = parse(score(`<measure>${attr}${note(12)}</measure>`));
  const library: Library = {
    version: 1,
    profiles: [],
    pieces: [p],
    settings: {},
    attempts: [],
  };
  const restored = parseBackup(
    JSON.stringify({ format: "ChoirStar backup", library, recordings: {} }),
  ).library.pieces[0];
  expect(restored).toEqual(p);
});
it("imports lyric verses, syllables and elisions, repeats them and retains tied-note lyric positions", () => {
  const lyrics =
    '<lyric number="1"><syllabic>begin</syllabic><text>Win</text></lyric><lyric number="2"><text>Snow &amp; light</text></lyric><lyric number="3"><text></text></lyric>';
  const p = parse(
    score(
      `<measure>${attr}<barline><repeat direction="forward"/></barline>${note(4, lyrics + '<tie type="start"/>')}${note(4, '<tie type="stop"/><lyric number="1"><syllabic>end</syllabic><text>ter</text></lyric>')}${note(4, '<lyric number="1"><text>sing</text><elision>‿</elision><text>on</text><extend type="start"/></lyric>')}<barline><repeat direction="backward"/></barline></measure>`,
    ),
  );
  expect(p.parts[0].notes).toHaveLength(4);
  expect(p.parts[0].lyrics?.map((l) => [l.verse, l.text, l.tick])).toEqual([
    ["1", "Win", 0],
    ["2", "Snow & light", 0],
    ["1", "ter", 960],
    ["1", "sing‿on", 1920],
    ["1", "Win", 2880],
    ["2", "Snow & light", 2880],
    ["1", "ter", 3840],
    ["1", "sing‿on", 4800],
  ]);
  const library: Library = {
    version: 1,
    profiles: [],
    pieces: [p],
    settings: {},
    attempts: [],
  };
  expect(
    parseBackup(
      JSON.stringify({ format: "ChoirStar backup", library, recordings: {} }),
    ).library.pieces[0],
  ).toEqual(p);
});
it("preserves melisma markers without empty lyric rows and honors print flags", () => {
  const p = parse(
    score(
      `<measure>${attr}${note(4, '<lyric number="1"><text>Ah</text><extend type="start"/></lyric>')}${note(4, '<lyric number="1"><extend type="continue"/></lyric><lyric number="2" print-object="no"><text>Hidden</text></lyric>')}${note(4, '<lyric number="1"><extend type="stop"/></lyric>')}</measure>`,
    ),
  );
  expect(p.parts[0].lyrics?.map((l) => l.extend)).toEqual([
    "start",
    "continue",
    "stop",
  ]);
});
