import { expect, it } from "vitest";
import {
  addLibraryFolder,
  defaultLayout,
  libraryLayout,
  moveLibraryItem,
  removeLibraryFolder,
  validateLibraryLayout,
} from "../src/piece-library";
import { demoPiece, type Library, type LibraryLayout } from "../src/model";
import type { WebsiteCatalogue } from "../src/website";

function fixture() {
  const one = demoPiece(),
    two = demoPiece(),
    local = demoPiece();
  const page = "https://choir.example/repertoire";
  one.website = {
    url: "https://choir.example/one.mid",
    page,
    category: ["Earlier concert"],
  };
  two.website = {
    url: "https://choir.example/two.mid",
    page,
    category: ["Winter"],
  };
  const entry = {
    url: one.website.url,
    title: "One",
    filename: "one.mid",
    format: "midi" as const,
    category: ["Earlier concert"],
  };
  const catalogue: WebsiteCatalogue = {
    url: page,
    title: "Example choir",
    entries: [
      entry,
      {
        ...entry,
        url: two.website.url,
        title: "2. Two",
        category: ["Concerts", "Winter"],
      },
      { ...entry, title: "3. One", category: ["Concerts", "Winter"] },
      { ...entry, title: "3. One", category: ["Concerts", "Winter"] },
      { ...entry, title: "Encore", category: [] },
    ],
  };
  const lib: Library = {
    version: 1,
    profiles: [],
    pieces: [local, one, two],
    websites: [catalogue],
    settings: {},
    attempts: [],
  };
  return { one, two, local, catalogue, lib };
}

it("uses each concert's source order and titles even when shared scores were imported earlier", () => {
  const { one, two, local, lib } = fixture();
  const layout = libraryLayout(lib);
  expect(
    layout.items.filter((n) => n.parent === null).map((n) => n.title),
  ).toEqual([local.title, "Example choir"]);
  const winter = layout.items.find((n) => n.title === "Winter")!;
  expect(
    layout.items
      .filter((n) => n.parent === winter.id)
      .map((n) => [n.title, n.pieceId]),
  ).toEqual([
    ["2. Two", two.id],
    ["3. One", one.id],
  ]);
  expect(layout.items.filter((n) => n.title === "3. One")).toHaveLength(1);
  expect(one.title).not.toBe("3. One");
  expect(lib.pieces).toHaveLength(3);
});

it("falls back to provenance and separates websites with identical titles", () => {
  const { one, two } = fixture();
  two.website!.page = "https://other.example/list";
  const layout = defaultLayout([one, two], []);
  expect(
    layout.items.filter((n) => n.parent === null).map((n) => n.title),
  ).toEqual(["choir.example", "other.example"]);
  const catalogues = [one, two].map((p) => ({
    url: p.website!.page,
    title: "Repertoire",
    entries: [],
  }));
  expect(
    defaultLayout([one, two], catalogues).items.filter(
      (n) => n.parent === null,
    ),
  ).toHaveLength(2);
  expect(defaultLayout([], []).items).toEqual([]);
});

it("moves a whole subtree across levels and rejects moves into itself or descendants", () => {
  const { lib } = fixture();
  const layout = libraryLayout(lib);
  const concerts = layout.items.find((n) => n.title === "Concerts")!;
  const winter = layout.items.find((n) => n.title === "Winter")!;
  const before = layout.items.find((n) => n.title === "Example choir")!;
  const moved = moveLibraryItem(layout, concerts.id, null, before.id);
  expect(moved.items.find((n) => n.id === concerts.id)?.parent).toBe(null);
  expect(moved.items.filter((n) => n.parent === winter.id)).toEqual(
    layout.items.filter((n) => n.parent === winter.id),
  );
  expect(moveLibraryItem(layout, concerts.id, winter.id)).toBe(layout);
  expect(moveLibraryItem(layout, concerts.id, concerts.id)).toBe(layout);
  expect(moveLibraryItem(layout, concerts.id, "missing")).toBe(layout);
  expect(moveLibraryItem(layout, concerts.id, null, "missing")).toBe(layout);
});

it("reorders an occurrence without changing another concert or the source catalogue", () => {
  const { lib } = fixture();
  const layout = libraryLayout(lib);
  const winter = layout.items.find((n) => n.title === "Winter")!;
  const [first, second] = layout.items.filter((n) => n.parent === winter.id);
  const moved = moveLibraryItem(layout, second.id, winter.id, first.id);
  expect(
    moved.items.filter((n) => n.parent === winter.id).map((n) => n.title),
  ).toEqual(["3. One", "2. Two"]);
  expect(libraryLayout({ ...lib, layout: moved })).toEqual(moved);
  expect(lib.websites![0].entries[0].title).toBe("One");
});

it("creates folders, unwraps deleted folders in place, keeps scores and does not regenerate removed source folders", () => {
  const { lib } = fixture();
  const layout = libraryLayout(lib);
  const winter = layout.items.find((n) => n.title === "Winter")!;
  const custom = addLibraryFolder(layout, " My concert ", null);
  const folder = custom.items.at(-1)!;
  expect(folder.title).toBe("My concert");
  const moved = moveLibraryItem(custom, winter.id, folder.id);
  const removed = removeLibraryFolder(moved, winter.id);
  expect(
    removed.items.filter((n) => n.parent === folder.id).map((n) => n.title),
  ).toEqual(["2. Two", "3. One"]);
  expect(libraryLayout({ ...lib, layout: removed })).toEqual(removed);
  expect(removed.items.filter((n) => n.type === "piece")).toHaveLength(
    layout.items.filter((n) => n.type === "piece").length,
  );
  expect(lib.pieces).toHaveLength(3);
});

it("admits new imports without moving edited folders, and removes deleted piece references", () => {
  const { lib, local } = fixture();
  const initial = libraryLayout(lib);
  const custom = addLibraryFolder(initial, "Practice", null);
  const folder = custom.items.at(-1)!;
  const localItem = custom.items.find((n) => n.pieceId === local.id)!;
  const moved = moveLibraryItem(custom, localItem.id, folder.id);
  const extra = demoPiece();
  const updated = libraryLayout({
    ...lib,
    layout: moved,
    pieces: [...lib.pieces, extra],
  });
  expect(updated.items.find((n) => n.id === localItem.id)?.parent).toBe(
    folder.id,
  );
  expect(updated.items.filter((n) => n.pieceId === extra.id)).toHaveLength(1);
  expect(
    libraryLayout({ ...lib, layout: updated, pieces: [extra] })
      .items.filter((n) => n.type === "piece")
      .map((n) => n.pieceId),
  ).toEqual([extra.id]);
});

it("rejects cycles, duplicate identities and broken references in backup layouts", () => {
  const layout: LibraryLayout = {
    items: [
      { id: "a", parent: null, type: "folder", title: "A" },
      { id: "b", parent: "a", type: "folder", title: "B" },
    ],
    removedSources: [],
  };
  expect(() => validateLibraryLayout(layout, new Set())).not.toThrow();
  layout.items[0].parent = "b";
  expect(() => validateLibraryLayout(layout, new Set())).toThrow("hierarchy");
  layout.items[0].parent = null;
  expect(() =>
    validateLibraryLayout(
      { ...layout, items: [...layout.items, layout.items[0]] },
      new Set(),
    ),
  ).toThrow("Duplicate");
  expect(() =>
    validateLibraryLayout(
      {
        ...layout,
        items: [
          ...layout.items,
          {
            id: "c",
            parent: null,
            type: "piece",
            pieceId: "missing",
            title: "Missing",
          },
        ],
      },
      new Set(),
    ),
  ).toThrow("association");
});

it("inserts a late shared-score import in its own concert order after organization has been saved", () => {
  const { lib, one, two } = fixture();
  const earlier = { ...lib, pieces: [one] };
  const layout = addLibraryFolder(libraryLayout(earlier), "Personal", null);
  const next = libraryLayout({ ...lib, layout, pieces: [one, two] });
  const winter = next.items.find((n) => n.title === "Winter")!;
  expect(
    next.items.filter((n) => n.parent === winter.id).map((n) => n.title),
  ).toEqual(["2. Two", "3. One"]);
});
