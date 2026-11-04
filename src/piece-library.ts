import {
  uid,
  type Library,
  type LibraryLayout,
  type LibraryItem,
  type Piece,
} from "./model";
import type { WebsiteCatalogue } from "./website";

// Source identities distinguish appearances of one score in different concerts.
export function defaultLayout(
  pieces: Piece[],
  catalogues: WebsiteCatalogue[],
): LibraryLayout {
  const items: LibraryItem[] = [];
  const folders = new Map<string, string>();
  const appearances = new Set<string>();
  const matched = new Set<string>();
  function add(
    piece: Piece,
    page: string,
    title: string,
    path: string[],
    websiteTitle: string,
  ) {
    let parent: string | null = null;
    for (let depth = 0; depth <= path.length; depth++) {
      const sourceKey = JSON.stringify([
        "folder",
        page,
        ...path.slice(0, depth),
      ]);
      let id = folders.get(sourceKey);
      if (!id) {
        id = uid();
        folders.set(sourceKey, id);
        items.push({
          id,
          parent,
          type: "folder",
          title: depth ? path[depth - 1] : websiteTitle,
          sourceKey,
        });
      }
      parent = id;
    }
    const sourceKey = JSON.stringify(["piece", page, path, piece.id]);
    if (appearances.has(sourceKey)) return;
    appearances.add(sourceKey);
    items.push({
      id: uid(),
      parent,
      type: "piece",
      title,
      pieceId: piece.id,
      sourceKey,
    });
    matched.add(piece.id);
  }
  for (const piece of pieces.filter((p) => !p.website)) {
    items.push({
      id: uid(),
      parent: null,
      type: "piece",
      title: piece.title,
      pieceId: piece.id,
      sourceKey: JSON.stringify(["local", piece.id]),
    });
  }
  // Traverse source entries, not import order: every concert has its own order.
  for (const catalogue of catalogues) {
    for (const entry of catalogue.entries) {
      for (const piece of pieces.filter(
        (p) => p.website?.page === catalogue.url && p.website.url === entry.url,
      ))
        add(piece, catalogue.url, entry.title, entry.category, catalogue.title);
    }
  }
  for (const piece of pieces) {
    if (!piece.website || matched.has(piece.id)) continue;
    const { page, category } = piece.website;
    let title = page;
    try {
      title = new URL(page).hostname;
    } catch {
      /* Keep legacy provenance readable. */
    }
    add(
      piece,
      page,
      piece.title,
      category,
      catalogues.find((c) => c.url === page)?.title || title,
    );
  }
  return { items, removedSources: [] };
}

// Preserve user edits, while admitting newly imported scores and categories.
export function libraryLayout(
  lib: Pick<Library, "pieces" | "websites" | "layout">,
): LibraryLayout {
  const generated = defaultLayout(lib.pieces, lib.websites || []);
  if (!lib.layout) return generated;
  const pieces = new Set(lib.pieces.map((p) => p.id));
  const items = lib.layout.items
    .filter((n) => n.type === "folder" || pieces.has(n.pieceId!))
    .map((n) => ({ ...n }));
  const bySource = new Map<string, string>();
  for (const item of items)
    if (item.sourceKey && !bySource.has(item.sourceKey))
      bySource.set(item.sourceKey, item.id);
  const parents = new Map<string, string | null>();
  const removed = new Set(lib.layout.removedSources);
  for (const [index, item] of generated.items.entries()) {
    const parent = item.parent ? (parents.get(item.parent) ?? null) : null;
    const existing = bySource.get(item.sourceKey!);
    if (existing) parents.set(item.id, existing);
    else if (removed.has(item.sourceKey!)) parents.set(item.id, parent);
    else {
      // Insert late imports before their next source sibling, without
      // reordering any rows the user has already arranged.
      const following = generated.items.slice(index + 1).find((candidate) => {
        if (candidate.parent !== item.parent) return false;
        const existingId = bySource.get(candidate.sourceKey!);
        return items.some(
          (node) => node.id === existingId && node.parent === parent,
        );
      });
      const before = following
        ? items.findIndex(
            (node) => node.id === bySource.get(following.sourceKey!),
          )
        : -1;
      items.splice(before < 0 ? items.length : before, 0, { ...item, parent });
      bySource.set(item.sourceKey!, item.id);
      parents.set(item.id, item.id);
    }
  }
  return { items, removedSources: [...removed] };
}

export function moveLibraryItem(
  layout: LibraryLayout,
  id: string,
  parent: string | null,
  before: string | null = null,
): LibraryLayout {
  const item = layout.items.find((n) => n.id === id);
  const target = parent && layout.items.find((n) => n.id === parent);
  if (!item || (parent && (!target || target.type !== "folder"))) return layout;
  let ancestor = parent;
  while (ancestor) {
    if (ancestor === id) return layout;
    ancestor = layout.items.find((n) => n.id === ancestor)?.parent || null;
  }
  if (before === id) return layout;
  const next = layout.items.filter((n) => n.id !== id);
  const index = before
    ? next.findIndex((n) => n.id === before && n.parent === parent)
    : -1;
  if (before && index < 0) return layout;
  next.splice(index < 0 ? next.length : index, 0, { ...item, parent });
  return { ...layout, items: next };
}

export function addLibraryFolder(
  layout: LibraryLayout,
  title: string,
  parent: string | null,
): LibraryLayout {
  title = title.trim().slice(0, 1000);
  if (
    !title ||
    (parent &&
      !layout.items.some((n) => n.id === parent && n.type === "folder"))
  )
    return layout;
  return {
    ...layout,
    items: [...layout.items, { id: uid(), parent, type: "folder", title }],
  };
}

export function removeLibraryFolder(
  layout: LibraryLayout,
  id: string,
): LibraryLayout {
  const folder = layout.items.find((n) => n.id === id && n.type === "folder");
  if (!folder) return layout;
  const items: LibraryItem[] = [];
  for (const item of layout.items) {
    if (item.id === id) {
      items.push(
        ...layout.items
          .filter((n) => n.parent === id)
          .map((n) => ({ ...n, parent: folder.parent })),
      );
    } else if (item.parent !== id) items.push(item);
  }
  return {
    items,
    removedSources: [
      ...new Set([
        ...layout.removedSources,
        ...(folder.sourceKey ? [folder.sourceKey] : []),
      ]),
    ],
  };
}

// Suppress the source identity so reconciliation cannot resurrect a removed row.
export function removePieceAppearance(
  layout: LibraryLayout,
  id: string,
): LibraryLayout {
  const item = layout.items.find((n) => n.id === id && n.type === "piece");
  if (!item) return layout;
  return {
    items: layout.items.filter((n) => n.id !== id),
    removedSources: [
      ...new Set([
        ...layout.removedSources,
        ...(item.sourceKey ? [item.sourceKey] : []),
      ]),
    ],
  };
}

export function validateLibraryLayout(
  layout: LibraryLayout,
  pieceIds: Set<string>,
) {
  const byId = new Map(layout.items.map((n) => [n.id, n]));
  if (byId.size !== layout.items.length)
    throw new Error("Duplicate library item identities.");
  for (const item of layout.items) {
    if (item.type === "piece" && (!item.pieceId || !pieceIds.has(item.pieceId)))
      throw new Error("Broken library piece association.");
    const visited = new Set([item.id]);
    let parent = item.parent;
    while (parent) {
      const folder = byId.get(parent);
      if (
        !folder ||
        folder.type !== "folder" ||
        visited.has(parent) ||
        visited.size > 128
      )
        throw new Error("Invalid library folder hierarchy.");
      visited.add(parent);
      parent = folder.parent;
    }
  }
}

export function remapLayoutSource(
  source: string,
  remap: (id: string) => string,
) {
  try {
    const parts = JSON.parse(source);
    if (parts[0] === "piece") parts[3] = remap(parts[3]);
    if (parts[0] === "local") parts[1] = remap(parts[1]);
    return JSON.stringify(parts);
  } catch {
    return source;
  }
}
