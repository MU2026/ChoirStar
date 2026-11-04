import {
  addLibraryFolder,
  libraryLayout,
  moveLibraryItem,
  removeLibraryFolder,
  validateLibraryLayout,
} from "../src/piece-library";
import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import { demoPiece, defaults, type Library } from "../src/model";
import {
  persist,
  load,
  putRecording,
  getRecording,
  deleteRecording,
  deletePiece,
  deleteLibraryAppearance,
  restore,
  parseBackup,
} from "../src/storage";
function fixture(): Library {
  const p = demoPiece();
  return {
    version: 1,
    profiles: [{ id: "bass", name: "Bass" }],
    pieces: [p],
    settings: { ["bass:" + p.id]: defaults(p) },
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
        recording: "r",
        audioSettings: { device: "old", channel: 0, offset: 100, timing: true },
      },
    ],
  };
}
describe("local library and backups", () => {
  it("persists the library and keeps recording deletion independent of results", async () => {
    const l = fixture();
    await persist(l);
    await putRecording("r", new Blob(["voice"], { type: "audio/webm" }));
    expect((await load())?.attempts[0].id).toBe("a");
    expect((await getRecording("r"))?.size).toBe(5);
    await deleteRecording("r");
    expect(await getRecording("r")).toBeUndefined();
    expect((await load())?.attempts).toHaveLength(1);
  });
  it("restores new identities without replacing current profiles and keeps ownership associations", async () => {
    const l = fixture();
    const text = JSON.stringify({
      format: "ChoirStar backup",
      library: l,
      recordings: { r: { type: "audio/webm", data: btoa("voice") } },
    });
    const next = await restore(text, l);
    expect(next.profiles).toHaveLength(2);
    expect(next.pieces).toHaveLength(2);
    const a = next.attempts[1];
    expect(a.profile).toBe(next.profiles[1].id);
    expect(a.piece).toBe(next.pieces[1].id);
    expect(a.part).toBe(next.pieces[1].parts[0].id);
    expect(a.recording).not.toBe("r");
    expect((await getRecording(a.recording!))?.size).toBe(5);
    expect(Object.values(next.settings)[1].timing).toBe(false);
  });
  it("rejects invalid schemas and broken associations before restoring", () => {
    expect(() => parseBackup("{}")).toThrow();
    const l = fixture();
    l.attempts[0].profile = "missing";
    expect(() =>
      parseBackup(
        JSON.stringify({
          format: "ChoirStar backup",
          library: l,
          recordings: {},
        }),
      ),
    ).toThrow("associations");
  });
});

it("rejects incomplete mixes and duplicate identities before import", () => {
  const l = fixture();
  const encode = () =>
    JSON.stringify({ format: "ChoirStar backup", library: l, recordings: {} });
  const s = Object.values(l.settings)[0];
  delete s.mix[l.pieces[0].parts[0].id];
  expect(() => parseBackup(encode())).toThrow("settings associations");
  l.settings = {};
  l.profiles.push({ ...l.profiles[0] });
  expect(() => parseBackup(encode())).toThrow("Duplicate");
});

it("deletes a piece across singers while preserving other pieces and recordings", async () => {
  const l = fixture();
  const removed = l.pieces[0];
  const kept = { ...demoPiece(), id: "kept" };
  l.pieces.push(kept);
  l.profiles.push({ id: "alto", name: "Alto" });
  l.settings[`alto:${removed.id}`] = defaults(removed);
  l.settings[`bass:${kept.id}`] = defaults(kept);
  l.attempts.push({
    ...l.attempts[0],
    id: "b",
    profile: "alto",
    recording: "r2",
  });
  l.attempts.push({
    ...l.attempts[0],
    id: "c",
    piece: kept.id,
    recording: "keep",
  });
  await persist(l);
  for (const id of ["r", "r2", "keep"]) await putRecording(id, new Blob([id]));
  const next = await deletePiece(l, removed.id);
  expect(next.pieces.map((p) => p.id)).toEqual([kept.id]);
  expect(next.profiles).toEqual(l.profiles);
  expect(Object.keys(next.settings)).toEqual([`bass:${kept.id}`]);
  expect(next.attempts.map((a) => a.id)).toEqual(["c"]);
  expect(await getRecording("r")).toBeUndefined();
  expect(await getRecording("r2")).toBeUndefined();
  expect((await getRecording("keep"))?.size).toBe(4);
  expect(await load()).toEqual(next);
  const empty = await deletePiece(next, kept.id);
  expect(empty.pieces).toEqual([]);
  expect(empty.attempts).toEqual([]);
  expect(empty.settings).toEqual({});
  expect(() =>
    parseBackup(
      JSON.stringify({
        format: "ChoirStar backup",
        library: empty,
        recordings: {},
      }),
    ),
  ).not.toThrow();
});

it("rolls back the library when recording deletion fails", async () => {
  const l = fixture();
  await persist(l);
  await putRecording("r", new Blob(["voice"]));
  const original = IDBObjectStore.prototype.delete;
  const fail = vi
    .spyOn(IDBObjectStore.prototype, "delete")
    .mockImplementation(function (this: IDBObjectStore, key) {
      if (this.name === "recordings")
        throw new Error("Simulated storage failure");
      return original.call(this, key);
    });
  try {
    await expect(deletePiece(l, l.pieces[0].id)).rejects.toThrow(
      "Simulated storage failure",
    );
  } finally {
    fail.mockRestore();
  }
  expect(await load()).toEqual(l);
  expect((await getRecording("r"))?.size).toBe(5);
});

it("preserves website catalogues and score provenance through backup restoration", async () => {
  const lib = fixture();
  lib.websites = [
    {
      url: "https://choir.example/repertoire/",
      title: "Season",
      entries: [
        {
          url: "https://choir.example/one.mid",
          title: "One",
          filename: "one.mid",
          format: "midi",
          category: ["Winter"],
        },
      ],
    },
  ];
  lib.pieces[0].website = {
    url: lib.websites[0].entries[0].url,
    page: lib.websites[0].url,
    category: ["Winter"],
  };
  const encoded = JSON.stringify({
    format: "ChoirStar backup",
    library: lib,
    recordings: {},
  });
  expect(parseBackup(encoded).library.websites).toEqual(lib.websites);
  const restored = await restore(encoded, {
    version: 1,
    profiles: [],
    pieces: [],
    settings: {},
    attempts: [],
  });
  expect(restored.websites).toEqual(lib.websites);
  expect(restored.pieces[0].website).toEqual(lib.pieces[0].website);
  expect((await load())?.websites).toEqual(lib.websites);
});

it("preserves custom folders and order through persistence, restore and piece deletion", async () => {
  const lib = fixture();
  lib.pieces.push(demoPiece());
  let layout = addLibraryFolder(libraryLayout(lib), "My concert", null);
  const folder = layout.items.at(-1)!;
  const second = layout.items.find((n) => n.pieceId === lib.pieces[1].id)!;
  const first = layout.items.find((n) => n.pieceId === lib.pieces[0].id)!;
  layout = moveLibraryItem(layout, second.id, folder.id);
  layout = moveLibraryItem(layout, first.id, folder.id);
  lib.layout = layout;
  await persist(lib);
  expect((await load())?.layout).toEqual(layout);
  const encoded = JSON.stringify({
    format: "ChoirStar backup",
    library: lib,
    recordings: {},
  });
  expect(parseBackup(encoded).library.layout).toEqual(layout);
  const next = await restore(encoded, lib);
  const restoredFolders = next.layout!.items.filter(
    (n) => n.title === "My concert",
  );
  expect(restoredFolders).toHaveLength(2);
  expect(restoredFolders[0].id).not.toBe(restoredFolders[1].id);
  const restoredChildren = next.layout!.items.filter(
    (n) => n.parent === restoredFolders[1].id,
  );
  expect(restoredChildren.map((n) => n.pieceId)).toEqual([
    next.pieces[3].id,
    next.pieces[2].id,
  ]);
  expect(libraryLayout(next)).toEqual(next.layout);
  validateLibraryLayout(next.layout!, new Set(next.pieces.map((p) => p.id)));
  const deleted = await deletePiece(next, next.pieces[2].id);
  expect(
    deleted.layout!.items.some((n) => n.pieceId === next.pieces[2].id),
  ).toBe(false);
  expect(
    deleted.layout!.items.some((n) => n.id === restoredFolders[1].id),
  ).toBe(true);
});

it("keeps removed source folders removed when restoring, and rejects cyclic backup folders", async () => {
  const lib = fixture();
  lib.pieces[0].website = {
    url: "https://choir.example/a.mid",
    page: "https://choir.example/list",
    category: ["Concert"],
  };
  lib.layout = libraryLayout(lib);
  const source = lib.layout.items.find((n) => n.parent === null)!;
  lib.layout = removeLibraryFolder(lib.layout, source.id);
  const encoded = () =>
    JSON.stringify({
      format: "ChoirStar backup",
      library: lib,
      recordings: {},
    });
  const restored = await restore(encoded(), {
    version: 1,
    profiles: [],
    pieces: [],
    settings: {},
    attempts: [],
  });
  expect(libraryLayout(restored)).toEqual(restored.layout);
  expect(
    restored
      .layout!.items.filter((n) => n.type === "folder")
      .map((n) => n.title),
  ).toEqual(["Concert"]);
  const folder = lib.layout.items.find((n) => n.type === "folder")!;
  folder.parent = folder.id;
  expect(() => parseBackup(encoded())).toThrow("hierarchy");
});

it("removes only one concert reference, retains shared data through reload and restore, and collects the last reference", async () => {
  const lib = fixture();
  const piece = lib.pieces[0];
  piece.website = {
    url: "https://choir.example/shared.mid",
    page: "https://choir.example/list",
    category: ["First concert"],
  };
  lib.websites = [
    {
      url: piece.website.page,
      title: "Choir",
      entries: ["First concert", "Second concert"].map((category) => ({
        url: piece.website!.url,
        title: category + " song",
        filename: "shared.mid",
        format: "midi" as const,
        category: [category],
      })),
    },
  ];
  lib.layout = libraryLayout(lib);
  const [first, second] = lib.layout.items.filter(
    (n) => n.pieceId === piece.id,
  );
  await putRecording("r", new Blob(["voice"], { type: "audio/webm" }));
  const next = await deleteLibraryAppearance(lib, first.id);
  expect(next.pieces).toEqual(lib.pieces);
  expect(next.settings).toEqual(lib.settings);
  expect(next.attempts).toEqual(lib.attempts);
  expect((await getRecording("r"))?.size).toBe(5);
  expect(
    next.layout!.items.filter((n) => n.pieceId === piece.id).map((n) => n.id),
  ).toEqual([second.id]);
  expect(libraryLayout((await load())!)).toEqual(next.layout);
  const restored = await restore(
    JSON.stringify({
      format: "ChoirStar backup",
      library: next,
      recordings: {},
    }),
    { version: 1, profiles: [], pieces: [], settings: {}, attempts: [] },
  );
  expect(libraryLayout(restored)).toEqual(restored.layout);
  expect(restored.layout!.items.filter((n) => n.type === "piece")).toHaveLength(
    1,
  );
  expect(restored.layout!.items.some((n) => n.title === first.title)).toBe(
    false,
  );
  const final = await deleteLibraryAppearance(next, second.id);
  expect(final.pieces).toEqual([]);
  expect(final.settings).toEqual({});
  expect(final.attempts).toEqual([]);
  expect(await getRecording("r")).toBeUndefined();
  expect(await load()).toEqual(final);
});

it("does not change stored data if deleting the last appearance fails", async () => {
  const lib = fixture();
  lib.layout = libraryLayout(lib);
  await persist(lib);
  await putRecording("r", new Blob(["voice"]));
  const original = IDBObjectStore.prototype.delete;
  const fail = vi
    .spyOn(IDBObjectStore.prototype, "delete")
    .mockImplementation(function (this: IDBObjectStore, key) {
      if (this.name === "recordings")
        throw new Error("Simulated appearance deletion failure");
      return original.call(this, key);
    });
  try {
    await expect(
      deleteLibraryAppearance(
        lib,
        lib.layout.items.find((n) => n.type === "piece")!.id,
      ),
    ).rejects.toThrow("Simulated appearance deletion failure");
  } finally {
    fail.mockRestore();
  }
  expect(await load()).toEqual(lib);
  expect((await getRecording("r"))?.size).toBe(5);
});

it("preserves playback instruments through local storage and backup restoration, accepting older settings", async () => {
  const lib = fixture();
  const key = Object.keys(lib.settings)[0];
  lib.settings[key].instrument = "choir";
  await persist(lib);
  expect((await load())?.settings[key].instrument).toBe("choir");
  const encode = () =>
    JSON.stringify({
      format: "ChoirStar backup",
      library: lib,
      recordings: {},
    });
  const restored = await restore(encode(), {
    version: 1,
    profiles: [],
    pieces: [],
    settings: {},
    attempts: [],
  });
  expect(Object.values(restored.settings)[0].instrument).toBe("choir");
  delete lib.settings[key].instrument;
  expect(
    parseBackup(encode()).library.settings[key].instrument,
  ).toBeUndefined();
});
