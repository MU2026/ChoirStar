import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { Midi } from "@tonejs/midi";
import { demoPiece, defaults, type Library, type Piece } from "../src/model";
import { importPiece } from "../src/import-piece";
import { importScore } from "../src/score-import";
import { libraryLayout } from "../src/piece-library";
import { load, parseBackup, persist, restore } from "../src/storage";

function fixture(): Library {
  const piece = demoPiece();
  return {
    version: 1,
    profiles: [{ id: "singer", name: "Singer" }],
    pieces: [piece],
    settings: { [`singer:${piece.id}`]: defaults(piece) },
    attempts: [],
  };
}
function reimport(piece: Piece) {
  const copy = structuredClone(piece);
  copy.id = "new-piece";
  copy.parts.forEach((part, i) => {
    part.id = `new-part-${i}`;
    part.notes.forEach((note, j) => {
      note.id = `new-note-${i}-${j}`;
    });
  });
  return copy;
}

it("skips a legacy score with new identities and filename, preserving the library", () => {
  const lib = fixture();
  lib.layout = libraryLayout(lib);
  const imported = reimport(lib.pieces[0]);
  imported.title = "Renamed score";
  imported.importWarnings = ["New parser notice"];
  const result = importPiece(lib, imported);
  expect(result.duplicate).toBe(true);
  expect(result.library).toBe(lib);
  expect(result.piece).toBe(lib.pieces[0]);
});

it("recognizes the same file bytes even after parser metadata changes", () => {
  const lib = fixture();
  lib.pieces[0].fileHash = "a".repeat(64);
  const imported = reimport(lib.pieces[0]);
  imported.parts[0].name = "Updated parser label";
  expect(importPiece(lib, imported).duplicate).toBe(true);
});

it("recognizes matching content from a different website without replacing provenance", () => {
  const lib = fixture();
  lib.pieces[0].website = {
    url: "https://example.org/a.mid",
    page: "https://example.org",
    category: ["Concert"],
  };
  const imported = reimport(lib.pieces[0]);
  imported.website = {
    url: "https://other.example/b.mid",
    page: "https://other.example",
    category: [],
  };
  expect(importPiece(lib, imported).library).toBe(lib);
});

it.each(["pitch", "timing", "tempo", "lyrics", "part"])(
  "keeps a changed %s score as a new piece even with the same title",
  (change) => {
    const lib = fixture();
    const imported = reimport(lib.pieces[0]);
    if (change === "pitch") imported.parts[0].notes[0].midi++;
    if (change === "timing") imported.parts[0].notes[0].length++;
    if (change === "tempo") imported.tempos[0].bpm++;
    if (change === "lyrics")
      imported.parts[0].lyrics = [
        {
          verse: "1",
          text: "Different",
          syllabic: "single",
          tick: 0,
          length: 1,
        },
      ];
    if (change === "part") imported.parts[0].name += " changed";
    const result = importPiece(lib, imported);
    expect(result.duplicate).toBe(false);
    expect(result.library.pieces).toEqual([lib.pieces[0], imported]);
  },
);

it("repeated sequential imports add only one copy", () => {
  const lib = fixture();
  const score = reimport(lib.pieces[0]);
  score.parts[0].notes[0].midi++;
  const first = importPiece(lib, score);
  const second = importPiece(first.library, reimport(score));
  expect(second.duplicate).toBe(true);
  expect(second.library.pieces).toHaveLength(2);
});

it("allows duplicate detection at the library limit but rejects a new score", () => {
  const lib = fixture();
  lib.pieces = Array.from({ length: 200 }, (_, i) => ({
    ...lib.pieces[0],
    id: `piece-${i}`,
  }));
  expect(importPiece(lib, reimport(lib.pieces[0])).duplicate).toBe(true);
  const changed = reimport(lib.pieces[0]);
  changed.parts[0].notes[0].midi++;
  expect(() => importPiece(lib, changed)).toThrow("200 pieces");
});

it("hashes actual file bytes independent of its name and preserves hashes in storage and backups", async () => {
  const midi = new Midi();
  midi.addTrack().addNote({ midi: 60, ticks: 0, durationTicks: 480 });
  const bytes = Uint8Array.from(midi.toArray());
  const a = await importScore(new File([bytes], "original.mid"));
  const b = await importScore(new File([bytes], "renamed.midi"));
  expect(a.fileHash).toMatch(/^[a-f0-9]{64}$/);
  expect(b.fileHash).toBe(a.fileHash);
  const lib = fixture();
  lib.pieces = [a];
  lib.settings = {};
  await persist(lib);
  const stored = await load();
  expect(importPiece(stored!, b).duplicate).toBe(true);
  const backup = parseBackup(
    JSON.stringify({
      format: "ChoirStar backup",
      library: lib,
      recordings: {},
    }),
  );
  expect(backup.library.pieces[0].fileHash).toBe(a.fileHash);
  const restored = await restore(
    JSON.stringify({
      format: "ChoirStar backup",
      library: lib,
      recordings: {},
    }),
    { ...lib, pieces: [], profiles: [] },
  );
  expect(restored.pieces[0].id).not.toBe(a.id);
  expect(importPiece(restored, b).duplicate).toBe(true);
});
