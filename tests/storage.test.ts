import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { demoPiece, defaults, type Library } from "../src/model";
import {
  persist,
  load,
  putRecording,
  getRecording,
  deleteRecording,
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
