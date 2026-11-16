import { expect, it } from "vitest";
import { demoPiece, defaults } from "../src/model";
import { rehearsalGains } from "../src/rehearsal";
import { parseBackup } from "../src/storage";

it("combines multiple solos, respects mute, and restores saved levels", () => {
  const piece = demoPiece(),
    settings = defaults(piece);
  const [a, b, c] = piece.parts.map((part) => part.id);
  const original = structuredClone(settings.mix);
  settings.mix[a].solo = true;
  settings.mix[b].solo = true;
  expect(rehearsalGains(settings.mix)).toMatchObject({
    [a]: 0.65,
    [b]: 0.65,
    [c]: 0,
  });
  settings.mix[b].mute = true;
  expect(rehearsalGains(settings.mix)[b]).toBe(0);
  settings.mix[a].solo = false;
  settings.mix[b].solo = false;
  settings.mix[b].mute = false;
  expect(rehearsalGains(settings.mix)).toEqual(rehearsalGains(original));
});
it("boosts an audible part far above backing parts without changing slider levels", () => {
  const piece = demoPiece(),
    settings = defaults(piece);
  const [a, b] = piece.parts.map((part) => part.id);
  settings.mix[a].boost = true;
  const levels = rehearsalGains(settings.mix);
  expect(levels[a] / levels[b]).toBeGreaterThan(16);
  expect(settings.mix[a].volume).toBe(0.65);
  settings.mix[a].mute = true;
  expect(rehearsalGains(settings.mix)[b]).toBe(0.65);
  settings.mix[a].mute = false;
  settings.mix[b].solo = true;
  expect(rehearsalGains(settings.mix)).toMatchObject({ [a]: 0, [b]: 0.65 });
});
it("preserves solo and boost state in backups", () => {
  const piece = demoPiece(),
    settings = defaults(piece);
  const part = piece.parts[0].id;
  settings.initialPitches = false;
  settings.metronome = true;
  settings.mix[part].solo = true;
  settings.mix[part].boost = true;
  const restored = parseBackup(
    JSON.stringify({
      format: "ChoirStar backup",
      library: {
        version: 1,
        profiles: [{ id: "profile", name: "Test singer" }],
        pieces: [piece],
        settings: { [`profile:${piece.id}`]: settings },
        attempts: [],
      },
      recordings: {},
    }),
  );
  expect(Object.values(restored.library.settings)[0].initialPitches).toBe(
    false,
  );
  expect(Object.values(restored.library.settings)[0].metronome).toBe(true);
  expect(Object.values(restored.library.settings)[0].mix[part]).toMatchObject({
    solo: true,
    boost: true,
  });
});

it("keeps the loop boundary when seeking before its end and allows seeking beyond it", async () => {
  const { playbackEndTick } = await import("../src/rehearsal");
  const p = demoPiece(),
    s = { ...defaults(p), from: 2, to: 3, loop: true };
  expect(playbackEndTick(p, s, p.bars[2].start + p.ppq / 2)).toBe(
    p.bars[3].end,
  );
  expect(playbackEndTick(p, s, 0)).toBe(p.bars[3].end);
  expect(playbackEndTick(p, s, p.bars[4].start + p.ppq)).toBe(p.end);
  expect(playbackEndTick(p, { ...s, loop: false }, p.bars[2].start)).toBe(
    p.end,
  );
  expect(s).toMatchObject({ from: 2, to: 3, loop: true });
});

it("uses each meter's denominator beats and does not fill a short pickup with clicks", async () => {
  const { metronomeTicks } = await import("../src/rehearsal");
  const p = demoPiece();
  p.ppq = 960;
  p.bars = [
    { start: 0, end: 480, meter: [4, 4] },
    { start: 480, end: 3360, meter: [3, 4] },
    { start: 3360, end: 6240, meter: [6, 8] },
  ];
  const beats = metronomeTicks(p);
  expect(beats.map((beat) => beat.tick)).toEqual([
    0, 480, 1440, 2400, 3360, 3840, 4320, 4800, 5280, 5760,
  ]);
  expect(beats.filter((beat) => beat.accent).map((beat) => beat.tick)).toEqual([
    0, 480, 3360,
  ]);
});
