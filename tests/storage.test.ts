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
