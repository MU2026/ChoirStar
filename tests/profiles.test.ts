import { it, expect } from "vitest";
import { removeUnusedDefaultSingers } from "../src/profiles";
import { demoPiece, defaults, type Library } from "../src/model";
import { parseBackup } from "../src/storage";
it("removes unused presets and their settings but preserves repertoire and custom singers", () => {
  const p = demoPiece();
  const l: Library = {
    version: 1,
    profiles: [
      { id: "bass", name: "Bass singer" },
      { id: "alto", name: "Alto singer" },
      { id: "custom", name: "Bass singer" },
    ],
    pieces: [p],
    attempts: [],
    settings: { ["bass:" + p.id]: defaults(p) },
  };
  const next = removeUnusedDefaultSingers(l);
  expect(next.profiles).toEqual([{ id: "custom", name: "Bass singer" }]);
  expect(next.settings).toEqual({});
  expect(next.pieces).toEqual([p]);
  expect(l.profiles).toHaveLength(3);
});
it("preserves a preset that owns practice history", () => {
  const p = demoPiece();
  const l: Library = {
    version: 1,
    profiles: [{ id: "bass", name: "Bass singer" }],
    pieces: [p],
    settings: {},
    attempts: [
      {
        id: "a",
        session: "s",
        profile: "bass",
        piece: p.id,
        title: p.title,
        part: p.parts[0].id,
        date: 1,
        from: 0,
        to: 0,
        speed: 1,
        results: [],
        audioSettings: { device: "", channel: 0, offset: 0, timing: false },
      },
    ],
  };
  expect(removeUnusedDefaultSingers(l)).toBe(l);
});
it("accepts a backup with no singers or attempts", () => {
  const library = {
    version: 1,
    profiles: [],
    pieces: [],
    settings: {},
    attempts: [],
  };
  expect(
    parseBackup(
      JSON.stringify({ format: "ChoirStar backup", library, recordings: {} }),
    ).library.profiles,
  ).toEqual([]);
});
