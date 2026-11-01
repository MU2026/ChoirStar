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
