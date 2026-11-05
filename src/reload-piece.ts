import type { Library, Note, Piece } from "./model";

const noteKey = (n: Note) => JSON.stringify([n.tick, n.length, n.midi]);
const musicKey = (p: Piece["parts"][number]) =>
  JSON.stringify(p.notes.map(noteKey).sort());

/** Refresh engraving metadata while keeping every saved practice association. */
export function reloadPiece(
  lib: Library,
  id: string,
  imported: Piece,
): Library {
  const old = lib.pieces.find((p) => p.id === id);
  if (!old) throw new Error("This piece is no longer in the library.");
  const changed = () =>
    new Error(
      "This file changes the score's notes, parts or timing. Use Import to add it as a new piece; the existing piece and practice history were kept.",
    );
  const bars = (p: Piece) => p.bars.map((b) => [b.start, b.end, b.meter]);
  const tempos = (p: Piece) => p.tempos.map((t) => [t.tick, t.bpm]);
  if (
    (old.source ?? "midi") !== (imported.source ?? "midi") ||
    old.ppq !== imported.ppq ||
    old.end !== imported.end ||
    JSON.stringify(bars(old)) !== JSON.stringify(bars(imported)) ||
    JSON.stringify(tempos(old)) !== JSON.stringify(tempos(imported)) ||
    old.parts.length !== imported.parts.length
  )
    throw changed();
  const available = new Set(imported.parts);
  const parts = old.parts.map((part, index) => {
    const key = musicKey(part);
    const atIndex = imported.parts[index];
    const matches = [...available].filter((p) => musicKey(p) === key);
    const candidate =
      available.has(atIndex) && musicKey(atIndex) === key
        ? atIndex
        : (matches.find((p) => p.name === part.name) ??
          (matches.length === 1 ? matches[0] : undefined));
    if (!candidate) throw changed();
    available.delete(candidate);
    const identities = new Map<string, string[]>();
    part.notes.forEach((n) => {
      const key = noteKey(n);
      identities.set(key, [...(identities.get(key) ?? []), n.id]);
    });
    return {
      ...candidate,
      id: part.id,
      notes: candidate.notes.map((n) => ({
        ...n,
        id: identities.get(noteKey(n))!.shift()!,
      })),
    };
  });
  const next: Piece = {
    ...imported,
    id: old.id,
    title: old.title,
    website: old.website,
    parts,
  };
  return { ...lib, pieces: lib.pieces.map((p) => (p.id === id ? next : p)) };
}
