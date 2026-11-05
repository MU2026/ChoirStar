import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { demoPiece, defaults, type Library, type Piece } from "../src/model";
import { reloadPiece } from "../src/reload-piece";
import { libraryLayout } from "../src/piece-library";
import {
  getRecording,
  load,
  parseBackup,
  persist,
  putRecording,
} from "../src/storage";
function fixture() {
  const p = demoPiece();
  const lib: Library = {
    version: 1,
    profiles: [{ id: "singer", name: "Singer" }],
    pieces: [p],
    settings: {
      [`singer:${p.id}`]: { ...defaults(p), instrument: "choir", speed: 0.6 },
    },
    attempts: [
      {
        id: "attempt",
        session: "session",
        profile: "singer",
        piece: p.id,
        title: p.title,
        part: p.parts[0].id,
        date: 1,
        from: 0,
        to: 0,
        speed: 0.6,
        results: [
          {
            note: p.parts[0].notes[0].id,
            bar: 0,
            cents: 10,
            onset: null,
            samples: 20,
            grade: "Perfect",
          },
        ],
        recording: "recording",
        audioSettings: { device: "", channel: 0, offset: 0, timing: false },
      },
    ],
  };
  lib.layout = libraryLayout(lib);
  const imported: Piece = structuredClone(p);
  imported.id = "imported-piece";
  imported.title = "Fresh file title";
  imported.parts.forEach((part, i) => {
    part.id = `imported-part-${i}`;
    part.notes.forEach((note, j) => {
      note.id = `imported-note-${i}-${j}`;
    });
  });
  return { lib, p, imported };
}
it("refreshes lyrics and clefs without changing library, settings or history identities", () => {
  const { lib, p, imported } = fixture();
  imported.parts[0].lyrics = [
    {
      verse: "2",
      text: "Winter",
      syllabic: "single",
      tick: p.bars[2].start,
      length: 480,
    },
  ];
  imported.parts[0].clef = "treble";
  imported.parts[0].clefOctaveChange = -1;
  const next = reloadPiece(lib, p.id, imported),
    updated = next.pieces[0];
  expect(next.pieces).toHaveLength(1);
  expect(updated.id).toBe(p.id);
  expect(updated.title).toBe(p.title);
  expect(updated.parts[0].lyrics).toEqual(imported.parts[0].lyrics);
  expect(updated.parts[0].clefOctaveChange).toBe(-1);
  expect(updated.parts.flatMap((p) => p.notes.map((n) => n.id))).toEqual(
    p.parts.flatMap((p) => p.notes.map((n) => n.id)),
  );
  expect(next.settings).toBe(lib.settings);
  expect(next.attempts).toBe(lib.attempts);
  expect(next.layout).toBe(lib.layout);
  expect(p.parts[0].lyrics).toBeUndefined();
});
it("matches reordered parts and retains shared website appearances", () => {
  const { lib, p, imported } = fixture();
  p.website = {
    url: "https://example.org/study.mid",
    page: "https://example.org/",
    category: ["Concert"],
  };
  lib.layout!.items.push({
    id: "second-appearance",
    parent: null,
    type: "piece",
    title: "Other concert",
    pieceId: p.id,
  });
  imported.parts.reverse();
  const next = reloadPiece(lib, p.id, imported);
  expect(next.pieces[0].parts.map((p) => p.id)).toEqual(
    p.parts.map((p) => p.id),
  );
  expect(next.pieces[0].website).toEqual(p.website);
  expect(next.layout!.items.filter((i) => i.pieceId === p.id)).toHaveLength(2);
});
it("rejects changed music or a missing target without altering the original library", () => {
  for (const change of [
    (p: Piece) => {
      p.parts[0].notes[0].midi++;
    },
    (p: Piece) => {
      p.parts.pop();
    },
    (p: Piece) => {
      p.tempos[0].bpm++;
    },
    (p: Piece) => {
      p.bars[0].meter = [4, 4];
    },
  ]) {
    const { lib, p, imported } = fixture(),
      before = structuredClone(lib);
    change(imported);
    expect(() => reloadPiece(lib, p.id, imported)).toThrow("Use Import");
    expect(lib).toEqual(before);
  }
  const { lib, imported } = fixture();
  expect(() => reloadPiece(lib, "missing", imported)).toThrow("no longer");
});
it("persists the updated score and keeps backup associations and the recording intact", async () => {
  const { lib, p, imported } = fixture();
  await putRecording(
    "recording",
    new Blob(["synthetic audio"], { type: "audio/webm" }),
  );
  const next = reloadPiece(lib, p.id, imported);
  await persist(next);
  const saved = (await load())!;
  const parsed = parseBackup(
    JSON.stringify({
      format: "ChoirStar backup",
      library: saved,
      recordings: {},
    }),
  );
  expect(parsed.library.attempts[0].results[0].note).toBe(
    p.parts[0].notes[0].id,
  );
  expect(parsed.library.settings[`singer:${p.id}`].instrument).toBe("choir");
  expect(await (await getRecording("recording"))!.text()).toBe(
    "synthetic audio",
  );
});
