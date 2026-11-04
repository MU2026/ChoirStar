import {
  libraryLayout,
  remapLayoutSource,
  removePieceAppearance,
  validateLibraryLayout,
} from "./piece-library";
import { catalogueSchema } from "./website";
import { z } from "zod";
import { uid, type Library } from "./model";
const number = z.number().finite();
const nonnegative = number.nonnegative();
const id = z.string().min(1).max(200);
const text = z.string().max(1000);
const note = z.object({
  spelling: z
    .object({ note: z.string().max(4), octave: number.int().min(-1).max(9) })
    .optional(),
  id,
  midi: number.int().min(0).max(127),
  tick: nonnegative,
  length: nonnegative,
  velocity: number.min(0).max(1),
});
const part = z.object({
  lyrics: z
    .array(
      z.object({
        verse: text,
        text,
        syllabic: z.enum(["single", "begin", "middle", "end"]),
        extend: z.enum(["start", "continue", "stop"]).optional(),
        tick: nonnegative,
        length: nonnegative,
      }),
    )
    .max(1000000)
    .optional(),
  id,
  name: text,
  notes: z.array(note).max(100000),
  clef: z.enum(["treble", "bass"]).optional(),
  clefOctaveChange: z.number().int().min(-1).max(1).optional(),
});
const settings = z.object({
  instrument: z.enum(["piano", "choir", "organ", "strings"]).optional(),
  speakers: z.boolean().optional(),
  part: id,
  mix: z.record(
    z.string(),
    z.object({
      volume: number.min(0).max(1),
      mute: z.boolean(),
      visible: z.boolean(),
    }),
  ),
  speed: number.min(0.25).max(2),
  from: nonnegative.int(),
  to: nonnegative.int(),
  loop: z.boolean(),
  device: z.string(),
  channel: number.int().min(0).max(1),
  offset: number.min(-1000).max(1000),
  timing: z.boolean(),
});
const librarySchema = z.object({
  layout: z
    .object({
      items: z
        .array(
          z.object({
            id,
            parent: id.nullable(),
            type: z.enum(["folder", "piece"]),
            title: text,
            pieceId: id.optional(),
            sourceKey: z.string().max(30000).optional(),
          }),
        )
        .max(30000),
      removedSources: z.array(z.string().max(30000)).max(30000),
    })
    .optional(),
  websites: z.array(catalogueSchema).max(100).optional(),
  version: z.literal(1),
  profiles: z.array(z.object({ id, name: text })).max(100),
  pieces: z
    .array(
      z.object({
        id,
        title: text,
        website: z
          .object({
            url: z.string().max(8000),
            page: z.string().max(8000),
            category: z.array(text).max(12),
          })
          .optional(),
        source: z.enum(["midi", "musicxml", "nwc"]).optional(),
        importWarnings: z.array(text).optional(),
        ppq: number.positive(),
        end: nonnegative,
        tempos: z.array(
          z.object({ tick: nonnegative, bpm: number.positive().max(2000) }),
        ),
        bars: z
          .array(
            z.object({
              key: number.int().min(-7).max(7).optional(),
              start: nonnegative,
              end: nonnegative,
              meter: z.tuple([number.positive(), number.positive()]),
            }),
          )
          .min(1)
          .max(20001),
        parts: z.array(part).min(1).max(64),
        key: number.int().min(-7).max(7),
      }),
    )
    .max(200),
  settings: z.record(z.string(), settings),
  attempts: z
    .array(
      z.object({
        id,
        session: id,
        profile: id,
        piece: id,
        title: text,
        part: id,
        date: nonnegative,
        from: nonnegative.int(),
        to: nonnegative.int(),
        speed: number.positive(),
        results: z.array(
          z.object({
            note: id,
            bar: nonnegative.int(),
            cents: nonnegative.nullable(),
            onset: number.nullable(),
            samples: nonnegative.int(),
          }),
        ),
        recording: id.optional(),
        audioSettings: z.object({
          speakers: z.boolean().optional(),
          device: z.string(),
          channel: number.int().min(0).max(1),
          offset: number,
          timing: z.boolean(),
        }),
      }),
    )
    .max(10000),
});
let connection: Promise<IDBDatabase> | null = null;
function db() {
  return (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("choirstar", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("state");
      r.result.createObjectStore("recordings");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
async function op<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (s: IDBObjectStore) => IDBRequest<T>,
) {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const tx = d.transaction(store, mode),
      r = action(tx.objectStore(store));
    let result: T;
    r.onsuccess = () => {
      result = r.result;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || r.error);
    tx.onabort = () =>
      reject(tx.error || new Error("Storage transaction aborted."));
  });
}
export const load = () =>
  op<Library | undefined>("state", "readonly", (s) => s.get("library"));
export const persist = (lib: Library) =>
  op("state", "readwrite", (s) => s.put(lib, "library"));
export const putRecording = (id: string, blob: Blob) =>
  op("recordings", "readwrite", (s) => s.put(blob, id));
export const getRecording = (id: string) =>
  op<Blob | undefined>("recordings", "readonly", (s) => s.get(id));
export const deleteRecording = (id: string) =>
  op("recordings", "readwrite", (s) => s.delete(id));
/** Remove one appearance; collect the shared score only after its last reference. */
export async function deleteLibraryAppearance(
  lib: Library,
  itemId: string,
): Promise<Library> {
  const layout = libraryLayout(lib);
  const item = layout.items.find((n) => n.id === itemId && n.type === "piece");
  if (!item) return lib;
  const next = { ...lib, layout: removePieceAppearance(layout, itemId) };
  if (next.layout.items.some((n) => n.pieceId === item.pieceId)) {
    await persist(next);
    return next;
  }
  return deletePiece(next, item.pieceId!);
}

/** Remove a piece and its dependent local data in one transaction. */
export async function deletePiece(
  lib: Library,
  pieceId: string,
): Promise<Library> {
  const attempts = lib.attempts.filter((a) => a.piece !== pieceId);
  const next: Library = {
    ...lib,
    pieces: lib.pieces.filter((p) => p.id !== pieceId),
    ...(lib.layout
      ? {
          layout: {
            ...lib.layout,
            items: lib.layout.items.filter((n) => n.pieceId !== pieceId),
          },
        }
      : {}),
    settings: Object.fromEntries(
      Object.entries(lib.settings).filter(
        ([key]) => key.split(":")[1] !== pieceId,
      ),
    ),
    attempts,
  };
  const retained = new Set(attempts.map((a) => a.recording));
  const recordings = new Set(
    lib.attempts
      .filter(
        (a) => a.piece === pieceId && a.recording && !retained.has(a.recording),
      )
      .map((a) => a.recording!),
  );
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(["state", "recordings"], "readwrite");
    tx.oncomplete = () => resolve(next);
    tx.onabort = () =>
      reject(tx.error || new Error("Piece deletion was not saved."));
    tx.onerror = () => reject(tx.error);
    try {
      tx.objectStore("state").put(next, "library");
      for (const id of recordings) tx.objectStore("recordings").delete(id);
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function toBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
export async function backup(lib: Library, include: boolean) {
  const recordings: Record<string, { type: string; data: string }> = {};
  if (include)
    for (const a of lib.attempts) {
      if (a.recording) {
        const b = await getRecording(a.recording);
        if (b)
          recordings[a.recording] = { type: b.type, data: await toBase64(b) };
      }
    }
  const copy = structuredClone(lib);
  if (!include) copy.attempts.forEach((a) => delete a.recording);
  download(
    new Blob(
      [
        JSON.stringify({
          format: "ChoirStar backup",
          library: copy,
          recordings,
        }),
      ],
      { type: "application/json" },
    ),
    "choirstar-backup.json",
  );
}
export function parseBackup(text: string) {
  const parsed = z
    .object({
      format: z.literal("ChoirStar backup"),
      library: librarySchema,
      recordings: z.record(
        z.string(),
        z.object({
          type: z.string().regex(/^audio\//),
          data: z
            .string()
            .max(150000000)
            .regex(/^[A-Za-z0-9+/]*={0,2}$/),
        }),
      ),
    })
    .parse(JSON.parse(text));
  const l = parsed.library;
  if (l.layout)
    validateLibraryLayout(l.layout, new Set(l.pieces.map((p) => p.id)));
  const identities = [
    ...l.profiles.map((p) => p.id),
    ...l.pieces.flatMap((p) => [
      p.id,
      ...p.parts.flatMap((t) => [t.id, ...t.notes.map((n) => n.id)]),
    ]),
    ...l.attempts.map((a) => a.id),
  ];
  if (new Set(identities).size !== identities.length)
    throw new Error("Duplicate backup identities.");
  for (const p of l.pieces) {
    if (
      p.bars.some(
        (b, i) => b.end <= b.start || (i > 0 && b.start !== p.bars[i - 1].end),
      ) ||
      p.bars[0].start !== 0
    )
      throw new Error("Invalid bar map.");
    if (p.tempos.some((t, i) => i > 0 && t.tick < p.tempos[i - 1].tick))
      throw new Error("Unsorted tempo map.");
  }
  for (const [key, s] of Object.entries(l.settings)) {
    const [profile, piece, extra] = key.split(":");
    const p = l.pieces.find((p) => p.id === piece);
    if (
      extra !== undefined ||
      !p ||
      !l.profiles.some((p) => p.id === profile) ||
      !p.parts.some((t) => t.id === s.part) ||
      s.from > s.to ||
      s.to >= p.bars.length ||
      p.parts.some((t) => !s.mix[t.id]) ||
      Object.keys(s.mix).some((id) => !p.parts.some((t) => t.id === id))
    )
      throw new Error("Broken backup settings associations.");
  }
  for (const a of l.attempts) {
    const p = l.pieces.find((p) => p.id === a.piece);
    if (
      !p ||
      !l.profiles.some((p) => p.id === a.profile) ||
      !p.parts.some((t) => t.id === a.part)
    )
      throw new Error("Broken backup associations.");
  }
  return parsed;
}
export async function restore(
  text: string,
  current: Library,
): Promise<Library> {
  const parsed = parseBackup(text);
  const maps = new Map<string, string>();
  const remap = (s: string) => {
    if (!maps.has(s)) maps.set(s, uid());
    return maps.get(s)!;
  };
  const lib = parsed.library;
  const restoredLayout = libraryLayout(lib);
  restoredLayout.items = restoredLayout.items.map((n) => ({
    ...n,
    id: remap(n.id),
    parent: n.parent ? remap(n.parent) : null,
    ...(n.pieceId ? { pieceId: remap(n.pieceId) } : {}),
    ...(n.sourceKey
      ? { sourceKey: remapLayoutSource(n.sourceKey, remap) }
      : {}),
  }));
  restoredLayout.removedSources = restoredLayout.removedSources.map((source) =>
    remapLayoutSource(source, remap),
  );
  const currentLayout = libraryLayout(current);
  lib.profiles.forEach((p) => {
    p.id = remap(p.id);
    p.name += " (restored)";
  });
  lib.pieces.forEach((p) => {
    p.id = remap(p.id);
    p.parts.forEach((t) => {
      t.id = remap(t.id);
      t.notes.forEach((n) => (n.id = remap(n.id)));
    });
  });
  lib.attempts.forEach((a) => {
    a.id = remap(a.id);
    a.session = remap(a.session);
    a.profile = remap(a.profile);
    a.piece = remap(a.piece);
    a.part = remap(a.part);
    a.results.forEach((r) => (r.note = remap(r.note)));
    if (a.recording && !parsed.recordings[a.recording]) delete a.recording;
    else if (a.recording) a.recording = remap(a.recording);
  });
  const nextSettings: Library["settings"] = {};
  for (const [key, s] of Object.entries(lib.settings)) {
    const [profile, piece] = key.split(":");
    const p = lib.pieces.find((p) => p.id === remap(piece));
    if (!p || s.from > s.to || s.to >= p.bars.length) continue;
    s.part = remap(s.part);
    s.mix = Object.fromEntries(
      Object.entries(s.mix).map(([key, value]) => [remap(key), value]),
    );
    s.timing = false;
    s.device = "";
    nextSettings[`${remap(profile)}:${remap(piece)}`] = s;
  }
  const stored: string[] = [];
  try {
    for (const [key, r] of Object.entries(parsed.recordings)) {
      const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
      const target = remap(key);
      await putRecording(target, new Blob([bytes], { type: r.type }));
      stored.push(target);
    }
    const merged: Library = {
      version: 1,
      websites: Array.from(
        new Map(
          [...(lib.websites || []), ...(current.websites || [])].map((c) => [
            c.url,
            c,
          ]),
        ).values(),
      ),
      layout: {
        items: [...currentLayout.items, ...restoredLayout.items],
        removedSources: [
          ...new Set([
            ...currentLayout.removedSources,
            ...restoredLayout.removedSources,
          ]),
        ],
      },
      profiles: [...current.profiles, ...lib.profiles],
      pieces: [...current.pieces, ...lib.pieces],
      settings: { ...current.settings, ...nextSettings },
      attempts: [...current.attempts, ...lib.attempts],
    };
    await persist(merged);
    return merged;
  } catch (e) {
    await Promise.all(stored.map(deleteRecording));
    throw e;
  }
}
