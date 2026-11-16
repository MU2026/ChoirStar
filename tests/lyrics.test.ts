import { expect, it } from "vitest";
import { demoPiece } from "../src/model";
import { lyricLayout } from "../src/lyrics";
it("allocates stable verse rows, connects melismas, and adds space only to parts with lyrics", () => {
  const part = demoPiece().parts[0];
  expect(lyricLayout(part).height).toBe(100);
  part.lyrics = [
    { verse: "2", text: "Winter", syllabic: "single", tick: 0, length: 480 },
    {
      verse: "1",
      text: "Ah",
      syllabic: "single",
      extend: "start",
      tick: 0,
      length: 480,
    },
    {
      verse: "1",
      text: "",
      syllabic: "single",
      extend: "continue",
      tick: 480,
      length: 480,
    },
    {
      verse: "1",
      text: "",
      syllabic: "single",
      extend: "stop",
      tick: 960,
      length: 480,
    },
    { verse: "1", text: "Light", syllabic: "single", tick: 1440, length: 480 },
  ];
  const result = lyricLayout(part);
  expect(result.verses).toEqual(["1", "2"]);
  expect(result.lines[0][0]).toMatchObject({
    text: "Ah",
    end: 1440,
    next: 1440,
  });
  expect(result.height).toBeGreaterThanOrEqual(146);
});

it("selects verses by repeat visit, with manual overrides and introductory fallback", async () => {
  const { highlightedVerse } = await import("../src/lyrics");
  const part = demoPiece().parts[0];
  part.lyrics = [
    { verse: "1", text: "Intro", syllabic: "single", tick: 0, length: 480 },
    ...["1", "2", "3"].map((verse) => ({
      verse,
      text: "Words",
      syllabic: "single" as const,
      tick: 480,
      length: 480,
    })),
  ];
  const layout = lyricLayout(part);
  const bar = { start: 480, end: 960, meter: [1, 4] as [number, number] };
  for (const pass of [1, 2, 3])
    expect(highlightedVerse(layout, { ...bar, lyricPass: pass })).toBe(
      String(pass),
    );
  expect(highlightedVerse(layout, { ...bar, lyricPass: 2 }, "3")).toBe("3");
  expect(highlightedVerse(layout, { ...bar, lyricPass: 4 })).toBe("3");
  expect(
    highlightedVerse(layout, { ...bar, start: 0, end: 480, lyricPass: 2 }),
  ).toBe("1");
  expect(
    highlightedVerse(layout, { ...bar, start: 960, end: 1440 }),
  ).toBeUndefined();
  expect(highlightedVerse(layout, bar)).toBe("1");
});

it("spaces octave-clef lyrics below written notes rather than sounding notes", () => {
  const part = demoPiece().parts[0];
  part.clef = "treble";
  part.notes = [
    {
      id: "tenor",
      midi: 48,
      spelling: { note: "C", octave: 3 },
      tick: 0,
      length: 480,
      velocity: 0.7,
    },
  ];
  part.lyrics = [
    { verse: "1", text: "Ah", syllabic: "single", tick: 0, length: 480 },
  ];
  const ordinary = lyricLayout(part);
  part.clefOctaveChange = -1;
  const tenor = lyricLayout(part);
  expect(tenor.top).toBeLessThan(ordinary.top);
  part.notes[0].midi += 12;
  part.notes[0].spelling!.octave += 1;
  part.clefOctaveChange = 0;
  expect(lyricLayout(part).top).toBe(tenor.top);
});
