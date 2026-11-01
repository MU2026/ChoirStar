import { afterEach, expect, it, vi } from "vitest";
import { demoPiece, defaults, uid, type Library } from "../src/model";
import { parseBackup } from "../src/storage";
const realCrypto = globalThis.crypto;
afterEach(() => vi.unstubAllGlobals());
it("uses native randomUUID when available", () => {
  const native = vi.fn(() => "f315074c-7414-48db-895b-ae2f496a79ae");
  vi.stubGlobal("crypto", { randomUUID: native });
  expect(uid()).toBe("f315074c-7414-48db-895b-ae2f496a79ae");
  expect(native).toHaveBeenCalledOnce();
});
it("imports MIDI and preserves backup associations without randomUUID on LAN HTTP", () => {
  vi.stubGlobal("crypto", {
    getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
  });
  const p = demoPiece(); // Creates and imports a real synthetic MIDI.
  const profile = { id: uid(), name: "Test singer" };
  const ids = [
    profile.id,
    p.id,
    ...p.parts.flatMap((t) => [t.id, ...t.notes.map((n) => n.id)]),
  ];
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids)
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  const library: Library = {
    version: 1,
    profiles: [profile],
    pieces: [p],
    settings: { [`${profile.id}:${p.id}`]: defaults(p) },
    attempts: [],
  };
  expect(
    parseBackup(
      JSON.stringify({ format: "ChoirStar backup", library, recordings: {} }),
    ).library,
  ).toEqual(library);
});
