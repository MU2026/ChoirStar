import type { Library, Piece } from "./model";

// Compare score content without generated identities or import provenance.
function scoreContent(piece: Piece) {
  const { id, title, website, importWarnings, fileHash, ...score } = piece;
  return JSON.stringify(
    { ...score, source: score.source ?? "midi" },
    (key, value) => {
      if (key === "id") return undefined;
      if (value && typeof value === "object" && !Array.isArray(value))
        return Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        );
      return value;
    },
  );
}

/** Reuse a duplicate without touching its settings, history or folder layout. */
export function importPiece(library: Library, imported: Piece) {
  const content = scoreContent(imported);
  const existing = library.pieces.find(
    (piece) =>
      (imported.fileHash && piece.fileHash === imported.fileHash) ||
      scoreContent(piece) === content,
  );
  if (existing) return { library, piece: existing, duplicate: true };
  if (library.pieces.length >= 200)
    throw new Error(
      "The library limit is 200 pieces. Delete unused pieces before importing more.",
    );
  return {
    library: { ...library, pieces: [...library.pieces, imported] },
    piece: imported,
    duplicate: false,
  };
}
