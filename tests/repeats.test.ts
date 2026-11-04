import { expect, it } from "vitest";
import { unfold, type Navigation } from "../src/repeats";
const bar = (data: Partial<Navigation> = {}): Navigation => ({
  forward: false,
  repeat: 1,
  endings: [],
  sounds: [],
  ...data,
});
const ending = (type: string, passes: number[]) => ({ type, passes });
it("unfolds nested repeats and resets the inner pass for each outer pass", () => {
  expect(
    unfold([
      bar({ forward: true }),
      bar({ forward: true }),
      bar({ repeat: 2 }),
      bar({ repeat: 2 }),
    ]),
  ).toEqual([0, 1, 2, 1, 2, 3, 0, 1, 2, 1, 2, 3]);
});
it("uses multi-bar first endings and shared first/second endings before the final ending", () => {
  expect(
    unfold([
      bar({ forward: true }),
      bar({ endings: [ending("start", [1, 2])] }),
      bar({ endings: [ending("stop", [1, 2])], repeat: 3 }),
      bar({ endings: [ending("start", [3]), ending("discontinue", [3])] }),
      bar(),
    ]),
  ).toEqual([0, 1, 2, 0, 1, 2, 0, 3, 4]);
});
it("honors Fine only after D.C. and omits ordinary repeats on the return", () => {
  expect(
    unfold([
      bar({ forward: true }),
      bar({ repeat: 2, sounds: [{ fine: "yes" }] }),
      bar({ sounds: [{ dacapo: "yes" }] }),
    ]),
  ).toEqual([0, 1, 0, 1, 2, 0, 1]);
});
it("follows named D.S. and Coda markers", () => {
  expect(
    unfold([
      bar(),
      bar({ sounds: [{ segno: "s" }] }),
      bar({ sounds: [{ tocoda: "c" }] }),
      bar({ sounds: [{ dalsegno: "s" }] }),
      bar(),
      bar({ sounds: [{ coda: "c" }] }),
      bar(),
    ]),
  ).toEqual([0, 1, 2, 3, 1, 2, 5, 6]);
});
it("honors time-only on a jump inside a repeat", () => {
  expect(
    unfold([
      bar({ forward: true }),
      bar({ sounds: [{ fine: "yes" }] }),
      bar({ repeat: 2, sounds: [{ dacapo: "yes", "time-only": "2" }] }),
    ]),
  ).toEqual([0, 1, 2, 0, 1, 2, 0, 1]);
});
it("rejects missing markers, unmatched endings, and excessive expansion", () => {
  expect(() => unfold([bar({ sounds: [{ dalsegno: "missing" }] })])).toThrow(
    /segno/,
  );
  expect(() => unfold([bar({ endings: [ending("start", [1])] })])).toThrow(
    /endings/,
  );
  expect(() => unfold(Array.from({ length: 20001 }, () => bar()))).toThrow(
    /limit/,
  );
});
it("handles successive backward barlines in a three-ending section", () => {
  expect(
    unfold([
      bar({ forward: true }),
      bar({ endings: [ending("start", [1]), ending("stop", [1])], repeat: 2 }),
      bar({ endings: [ending("start", [2]), ending("stop", [2])], repeat: 2 }),
      bar({ endings: [ending("start", [3]), ending("stop", [3])] }),
      bar(),
    ]),
  ).toEqual([0, 1, 0, 2, 0, 3, 4]);
});

it("uses the second traversal for time-only Coda directions on return", () => {
  expect(
    unfold([
      bar({ sounds: [{ segno: "s" }] }),
      bar({ sounds: [{ tocoda: "c", "time-only": "2" }] }),
      bar({ sounds: [{ dalsegno: "s" }] }),
      bar({ sounds: [{ coda: "c" }] }),
    ]),
  ).toEqual([0, 1, 2, 0, 1, 3]);
});
