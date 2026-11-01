import { removeUnusedDefaultSingers } from "./profiles";
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioSession, type Frame } from "./audio";
import {
  assess,
  barAt,
  defaults,
  demoPiece,
  importMidi,
  secondsAt,
  suggestions,
  tickAt,
  uid,
  type Attempt,
  type Library,
  type Piece,
  type Sample,
  type Settings,
} from "./model";
import * as store from "./storage";
import { noteLabel } from "./vendor/openvox/core/music/notes";
import { Score } from "./views";
import { importMusicXml } from "./musicxml";
const initial: Library = {
  version: 1,
  profiles: [],
  pieces: [],
  settings: {},
  attempts: [],
};
function TransportIcon({
  kind,
}: {
  kind: "sing" | "listen" | "stop" | "loop";
}) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {kind === "sing" ? (
        <>
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
        </>
      ) : kind === "listen" ? (
        <path d="m7 3 14 9-14 9z" fill="currentColor" />
      ) : kind === "stop" ? (
        <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" />
      ) : (
        <>
          <path d="M19 7H6a3 3 0 0 0-3 3v2M5 17h13a3 3 0 0 0 3-3v-2M16 4l3 3-3 3M8 14l-3 3 3 3" />
        </>
      )}
    </svg>
  );
}
function SettingsIcon({ kind }: { kind: "tracks" | "audio" | "close" }) {
  return (
    <svg
      width="23"
      height="23"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {kind === "tracks" ? (
        <>
          <path d="M4 3v18M12 3v18M20 3v18" />
          <path d="M1 8h6M9 16h6M17 9h6" strokeWidth="4" />
        </>
      ) : kind === "audio" ? (
        <>
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
        </>
      ) : (
        <path d="m6 6 12 12M18 6 6 18" />
      )}
    </svg>
  );
}
export default function App() {
  const [lib, setLib] = useState<Library>(initial),
    [loaded, setLoaded] = useState(false),
    [profile, setProfile] = useState(""),
    [pieceId, setPieceId] = useState(""),
    [screen, setScreen] = useState<
      "prepare" | "practice" | "review" | "library"
    >("prepare");
  const [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false),
    [running, setRunning] = useState(false),
    [starting, setStarting] = useState(false),
    [record, setRecord] = useState(false),
    [monitor, setMonitor] = useState(false),
    [monitorVolume, setMonitorVolume] = useState(0.35),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [time, setTime] = useState(0),
    [frame, setFrame] = useState<Frame | null>(null),
    [samples, setSamples] = useState<Sample[]>([]),
    [drawer, setDrawer] = useState<"tracks" | "audio" | null>(null),
    [last, setLast] = useState<Attempt | null>(null),
    [recordingURL, setRecordingURL] = useState(""),
    [recordingType, setRecordingType] = useState(""),
    [includeAudio, setIncludeAudio] = useState(false),
    [newProfile, setNewProfile] = useState("");
  const libRef = useRef(lib);
  libRef.current = lib;
  const engine = useRef(new AudioSession());
  useEffect(() => {
    engine.current.setMonitoring(monitor, monitorVolume);
  }, [monitor, monitorVolume]);
  const playbackPosition = useCallback(() => engine.current.position(), []);
  const settingsTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!drawer) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawer(null);
        settingsTrigger.current?.focus();
      }
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [drawer]);
  const active = useRef(false);
  const finishing = useRef(false);
  const sampleRef = useRef<Sample[]>([]);
  const startConfig = useRef<{
    p: Piece;
    s: Settings;
    profile: string;
    session: string;
    practice: boolean;
  } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null),
    restoreFile = useRef<HTMLInputElement>(null);
  const writes = useRef(Promise.resolve());
  const piece = lib.pieces.find((p) => p.id === pieceId);
  const key = `${profile}:${pieceId}`;
  const settings = piece ? lib.settings[key] || defaults(piece) : null;
  function update(next: Library) {
    libRef.current = next;
    setLib(next);
    writes.current = writes.current
      .then(() => store.persist(next))
      .then(() => {})
      .catch((e) => setError("Could not save locally: " + message(e)));
  }
  function change(patch: Partial<Settings>) {
    if (!settings || !profile) return;
    update({
      ...libRef.current,
      settings: {
        ...libRef.current.settings,
        [key]: { ...settings, ...patch },
      },
    });
  }
  useEffect(() => {
    store
      .load()
      .then((l) => {
        if (l) {
          const next = removeUnusedDefaultSingers(l);
          if (next !== l) update(next);
          else setLib(next);
          setProfile(next.profiles[0]?.id || "");
          setPieceId(next.pieces[0]?.id || "");
        }
        setLoaded(true);
      })
      .catch((e) => {
        setError("Local storage unavailable: " + message(e));
        setLoaded(true);
      });
    return () => {
      active.current = false;
      void engine.current.close();
    };
  }, []);
  useEffect(() => {
    const changed = () => {
      void navigator.mediaDevices
        .enumerateDevices()
        .then((d) => setDevices(d.filter((d) => d.kind === "audioinput")));
      if (engine.current.running) {
        void stop();
        setError(
          "Audio devices changed. Practice stopped; re-check timing compensation.",
        );
      }
      const l = libRef.current;
      update({
        ...l,
        settings: Object.fromEntries(
          Object.entries(l.settings).map(([k, s]) => [
            k,
            { ...s, timing: false },
          ]),
        ),
      });
    };
    navigator.mediaDevices?.addEventListener("devicechange", changed);
    return () =>
      navigator.mediaDevices?.removeEventListener("devicechange", changed);
  }, []);
  useEffect(
    () => () => {
      if (recordingURL) URL.revokeObjectURL(recordingURL);
    },
    [recordingURL],
  );
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setTime(engine.current.position());
      setSamples([...sampleRef.current]);
    }, 65);
    return () => clearInterval(id);
  }, [running]);
  function message(e: unknown) {
    return e instanceof Error ? e.message : String(e);
  }
  async function importFile(f: File) {
    try {
      setError("");
      if (f.size > 20 * 1024 * 1024)
        throw new Error("Score files must be smaller than 20 MB.");
      if (/\.mxl$/i.test(f.name))
        throw new Error(
          "Compressed MusicXML is not supported yet. Export an uncompressed .musicxml file.",
        );
      const isXml = /\.(musicxml|xml)$/i.test(f.name);
      const p = isXml
        ? importMusicXml(await f.text(), f.name)
        : importMidi(await f.arrayBuffer(), f.name);
      update({ ...libRef.current, pieces: [...libRef.current.pieces, p] });
      setPieceId(p.id);
      setTime(0);
      setNotice(
        `Imported ${p.parts.length} parts. ${isXml ? "MusicXML practice notation imported." : "MIDI notation is reconstructed; compare it with your score."} ${(p.importWarnings || []).join(" ")}`,
      );
    } catch (e) {
      setError(message(e));
    }
  }
  function demo() {
    const p = demoPiece();
    update({ ...libRef.current, pieces: [...libRef.current.pieces, p] });
    setPieceId(p.id);
    setTime(0);
  }
  async function inputAccess() {
    try {
      setError("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setDevices(
        (await navigator.mediaDevices.enumerateDevices()).filter(
          (d) => d.kind === "audioinput",
        ),
      );
      setNotice("Input list refreshed. The microphone is now off.");
    } catch (e) {
      setError("Microphone access: " + message(e));
    }
  }
  function frameReceived(f: Frame) {
    setFrame(f);
    const cfg = startConfig.current;
    if (!active.current || !engine.current.running || !cfg || !cfg.practice)
      return;
    const e = engine.current;
    const t =
      e.startSeconds +
      (f.time - e.startTime) * e.speed -
      (cfg.s.offset / 1000) * e.speed;
    if (t >= e.startSeconds - 0.4 && t <= e.endSeconds)
      sampleRef.current.push({
        time: t,
        midi: f.midi,
        confidence: f.confidence,
      });
  }
  async function start(
    practice: boolean,
    loopConfig?: typeof startConfig.current,
  ) {
    if (starting || finishing.current || !profile) return;
    const p = loopConfig?.p || piece,
      s = loopConfig?.s || settings;
    if (!p || !s) return;
    setStarting(true);
    setError("");
    setNotice("");
    sampleRef.current = [];
    setSamples([]);
    setFrame(null);
    const cfg = loopConfig || {
      p,
      s: { ...structuredClone(s), timing: s.speakers ? false : s.timing },
      profile,
      session: uid(),
      practice,
    };
    startConfig.current = cfg;
    active.current = true;
    try {
      if (practice) {
        const input = await engine.current.microphone(
          s.device,
          s.channel,
          frameReceived,
          !!s.speakers,
        );
        if (s.speakers)
          setNotice(
            input.echoCancellation === true
              ? "Speaker mode: echo cancellation enabled. Keep playback quiet; backing voices can still leak into detection."
              : "Speaker mode: browser echo cancellation was not confirmed. Use headphones if backing voices appear in the pitch trace.",
          );
        if (!active.current) {
          engine.current.releaseMic();
          return;
        }
        if (record) engine.current.record(input.destination);
        engine.current.stream?.getAudioTracks().forEach((t) =>
          t.addEventListener("ended", () => {
            if (active.current) {
              void stop();
              setError("The microphone disconnected.");
            }
          }),
        );
      }
      await engine.current.play(p, s, () => void finish(true));
      if (!active.current) {
        engine.current.stopPlayback();
        engine.current.releaseMic();
        return;
      }
      setScreen("practice");
      setDrawer(null);
      setRunning(true);
      setTime(engine.current.position());
    } catch (e) {
      active.current = false;
      await engine.current.finishRecording();
      engine.current.stopPlayback();
      engine.current.releaseMic();
      setError(message(e));
      setRunning(false);
    } finally {
      setStarting(false);
    }
  }
  async function finish(natural: boolean) {
    if (finishing.current) return;
    finishing.current = true;
    const cfg = startConfig.current;
    const stoppedAt = engine.current.position();
    active.current = false;
    engine.current.stopPlayback();
    setRunning(false);
    setStarting(true);
    let attempt: Attempt | null = null;
    try {
      const blob = await engine.current.finishRecording();
      engine.current.releaseMic();
      if (cfg?.practice && stoppedAt >= engine.current.startSeconds) {
        const recording = blob?.size ? uid() : undefined;
        if (recording && blob) await store.putRecording(recording, blob);
        attempt = {
          id: uid(),
          session: cfg.session,
          profile: cfg.profile,
          piece: cfg.p.id,
          title: cfg.p.title,
          part: cfg.s.part,
          date: Date.now(),
          from: cfg.s.from,
          to: natural
            ? cfg.s.to
            : Math.max(
                cfg.s.from,
                Math.min(
                  cfg.s.to,
                  barAt(
                    cfg.p,
                    tickAt(
                      cfg.p,
                      Math.max(engine.current.startSeconds, stoppedAt),
                    ),
                  ),
                ),
              ),
          speed: cfg.s.speed,
          results: assess(
            cfg.p,
            cfg.p.parts.find((p) => p.id === cfg.s.part)!,
            sampleRef.current,
            cfg.s.from,
            natural
              ? cfg.s.to
              : Math.max(
                  cfg.s.from,
                  Math.min(
                    cfg.s.to,
                    barAt(cfg.p, tickAt(cfg.p, Math.max(0, stoppedAt))),
                  ),
                ),
            cfg.s.timing,
          ),
          recording,
          audioSettings: {
            speakers: !!cfg.s.speakers,
            device: cfg.s.device,
            channel: cfg.s.channel,
            offset: cfg.s.offset,
            timing: cfg.s.timing,
          },
        };
        update({
          ...libRef.current,
          attempts: [attempt, ...libRef.current.attempts],
        });
        setLast(attempt);
        setScreen("review");
      } else if (cfg) setTime(secondsAt(cfg.p, cfg.p.bars[cfg.s.from].start));
    } catch (e) {
      setError("Could not finish attempt: " + message(e));
    } finally {
      engine.current.releaseMic();
      finishing.current = false;
      setStarting(false);
    }
    if (natural && cfg?.s.loop) {
      setScreen("practice");
      setTimeout(() => {
        if (startConfig.current === cfg) void start(cfg.practice, cfg);
      }, 150);
    }
  }
  async function stop() {
    startConfig.current && (startConfig.current.s.loop = false);
    await finish(false);
  }
  function selectPiece(id: string) {
    setPieceId(id);
    const p = lib.pieces.find((p) => p.id === id);
    setTime(
      p
        ? secondsAt(
            p,
            p.bars[(lib.settings[`${profile}:${id}`] || defaults(p)).from]
              .start,
          )
        : 0,
    );
    setSamples([]);
    setLast(null);
  }
  async function removePiece(p: Piece) {
    if (
      deleting ||
      !confirm(
        `Delete “${p.title}” from this browser?\n\nThis also deletes its practice results, settings and recordings for all singers. Exported files are not affected. This cannot be undone.`,
      )
    )
      return;
    setDeleting(true);
    setError("");
    const operation = writes.current.then(async () => {
      const next = await store.deletePiece(libRef.current, p.id);
      libRef.current = next;
      setLib(next);
      if (pieceId === p.id) {
        selectPiece(next.pieces[0]?.id || "");
        setFrame(null);
      }
      if (last?.piece === p.id) setLast(null);
      setRecordingURL("");
      setNotice(`Deleted “${p.title}”.`);
    });
    writes.current = operation.catch(() => {});
    try {
      await operation;
    } catch (e) {
      setError("Could not delete piece: " + message(e));
    } finally {
      setDeleting(false);
    }
  }
  function mix(id: string, patch: Partial<Settings["mix"][string]>) {
    if (!settings) return;
    const m = { ...settings.mix[id], ...patch };
    change({ mix: { ...settings.mix, [id]: m } });
    if (running) {
      engine.current.mix(id, m.volume, m.mute);
      if (startConfig.current) startConfig.current.s.mix[id] = m;
    }
  }
  function retry(bar: number) {
    if (!piece || !settings) return;
    change({
      from: bar,
      to: Math.min(bar + 1, piece.bars.length - 1),
      speed: Math.min(settings.speed, 0.7),
      loop: true,
    });
    setTime(secondsAt(piece, piece.bars[bar].start));
    setSamples([]);
    setScreen("practice");
  }
  async function recordingAction(a: Attempt, download = false) {
    try {
      if (!a.recording) return;
      const blob = await store.getRecording(a.recording);
      if (!blob) throw new Error("This recording is no longer available.");
      if (download)
        store.download(
          blob,
          `choirstar-${new Date(a.date).toISOString().slice(0, 10)}.${blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm"}`,
        );
      else {
        setRecordingType(blob.type);
        setRecordingURL(URL.createObjectURL(blob));
      }
    } catch (e) {
      setError(message(e));
    }
  }
  async function removeRecording(a: Attempt) {
    if (
      !a.recording ||
      !confirm(
        "Delete this local recording? Exported files and practice results will remain.",
      )
    )
      return;
    try {
      await store.deleteRecording(a.recording);
      update({
        ...libRef.current,
        attempts: libRef.current.attempts.map((x) =>
          x.id === a.id ? { ...x, recording: undefined } : x,
        ),
      });
      if (last?.id === a.id) setLast({ ...a, recording: undefined });
      setRecordingURL("");
    } catch (e) {
      setError(message(e));
    }
  }
  const currentPart = piece?.parts.find((p) => p.id === settings?.part);
  const currentTick = piece ? tickAt(piece, Math.max(0, time)) : 0;
  const target = currentPart?.notes.find(
    (n) => currentTick >= n.tick && currentTick < n.tick + n.length,
  );
  const cents =
    frame?.midi !== null &&
    frame?.midi !== undefined &&
    frame.confidence >= 0.85 &&
    target
      ? Math.round((frame.midi - target.midi) * 100)
      : null;
  const viewTime =
    piece && settings
      ? Math.max(time, secondsAt(piece, piece.bars[settings.from].start))
      : time;
  const disabled = running || starting;
  const profileName = lib.profiles.find((p) => p.id === profile)?.name;
  const partsPanel = piece && settings && (
    <div className="parts-list">
      {piece.importWarnings?.map((w) => (
        <p className="muted" key={w}>
          {w}
        </p>
      ))}
      <label>
        My part
        <select
          disabled={disabled}
          value={settings.part}
          onChange={(e) => change({ part: e.target.value })}
        >
          {piece.parts.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>{" "}
      {piece.parts.map((p) => (
        <div
          className={"track " + (p.id === settings.part ? "selected" : "")}
          key={p.id}
        >
          <span>{p.name}</span>
          <input
            aria-label={`${p.name} volume`}
            type="range"
            min="0"
            max="100"
            value={Math.round((settings.mix[p.id]?.volume ?? 0.6) * 100)}
            onChange={(e) =>
              mix(p.id, { volume: Number(e.target.value) / 100 })
            }
          />
          <button
            aria-pressed={settings.mix[p.id]?.mute || false}
            onClick={() => mix(p.id, { mute: !settings.mix[p.id]?.mute })}
          >
            {settings.mix[p.id]?.mute ? "Muted" : "Mute"}
          </button>
        </div>
      ))}
      <p className="muted">
        Collapse staves using their name in the score. Muting does not change
        your assessed part.
      </p>
    </div>
  );
  const audioPanel = piece && settings && (
    <>
      {disabled && (
        <p className="muted">Stop the practice to change audio settings.</p>
      )}
      <fieldset disabled={disabled} className="audio-controls">
        <label className="field">
          Listening setup
          <select
            value={settings.speakers ? "speakers" : "headphones"}
            onChange={(e) => {
              const speakers = e.target.value === "speakers";
              setMonitor(false);
              change({
                speakers,
                channel: speakers ? 0 : settings.channel,
                timing: false,
              });
            }}
          >
            <option value="headphones">
              Headphones · unprocessed microphone
            </option>
            <option value="speakers">Laptop speakers · echo reduction</option>
          </select>
        </label>
        {settings.speakers && (
          <p className="muted">
            Experimental speaker mode requests echo reduction and rejects
            unstable pitch. Keep speaker volume low. Hear my voice is disabled
            to avoid feeding the microphone back into the speakers. New pitches
            need two consistent observations (normally about 20 ms apart); onset
            assessment should stay off.
          </p>
        )}
        <div className="row">
          <button onClick={() => void inputAccess()}>
            Choose microphone access
          </button>
          <span className="muted">
            {running && engine.current.stream
              ? "Microphone active"
              : "Microphone off"}
          </span>
        </div>
        <label className="field">
          Microphone
          <select
            value={settings.device}
            onChange={(e) => change({ device: e.target.value, timing: false })}
          >
            <option value="">System default input</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Microphone"}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Input channel
          <select
            value={settings.channel}
            disabled={!!settings.speakers}
            onChange={(e) =>
              change({
                channel: Number(e.target.value),
                timing: false,
              })
            }
          >
            <option value={0}>Input 1 / mono</option>
            <option value={1}>Input 2 (audio interface)</option>
          </select>
        </label>
        <p className="muted">
          Select the output in macOS. Headphones isolate the backing mix from
          the microphone. Volt 2 channel separation and Bluetooth timing need a
          real-device check.
        </p>
        <details>
          <summary>Timing setup · experimental</summary>
          <p className="muted">
            Pitch feedback works without timing assessment. Verify this offset
            with your current headphones before enabling onset feedback;
            changing input or output requires another check.
          </p>
          <label className="field">
            Input / output compensation (ms)
            <input
              type="number"
              min="-1000"
              max="1000"
              step="10"
              value={settings.offset}
              onChange={(e) =>
                change({
                  offset: Math.max(
                    -1000,
                    Math.min(1000, Number(e.target.value)),
                  ),
                  timing: false,
                })
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.timing && !settings.speakers}
              disabled={!!settings.speakers}
              onChange={(e) => change({ timing: e.target.checked })}
            />
            I have checked timing with this audio setup
          </label>
        </details>
        <label className="field">
          <span>
            <input
              type="checkbox"
              checked={record}
              onChange={(e) => setRecord(e.target.checked)}
            />{" "}
            Save a voice recording
          </span>
        </label>
        <label title="Use headphones. Browser monitoring may be delayed, especially over Bluetooth.">
          <input
            type="checkbox"
            checked={monitor && !settings.speakers}
            disabled={!!settings.speakers}
            onChange={(e) => setMonitor(e.target.checked)}
          />
          Hear my voice
        </label>
        <label>
          Voice level
          <input
            aria-label="Voice monitoring volume"
            disabled={!!settings.speakers}
            type="range"
            min="0"
            max="100"
            value={monitorVolume * 100}
            onChange={(e) => setMonitorVolume(Number(e.target.value) / 100)}
          />
        </label>
      </fieldset>
      {notice && (
        <p role="status" className="muted">
          {notice}
        </p>
      )}
    </>
  );
  const closeSettings = () => {
    setDrawer(null);
    settingsTrigger.current?.focus();
  };
  return (
    <div
      ref={root}
      inert={deleting || undefined}
      aria-busy={deleting}
      className={"app " + (screen === "practice" ? "focus" : "")}
    >
      {screen !== "practice" && (
        <header>
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setScreen("prepare");
            }}
          >
            ChoirStar <span>✦</span>
          </a>
          <span className="tag">LOCAL PRACTICE · 0.1</span>
          <nav>
            <button
              aria-pressed={screen === "prepare"}
              onClick={() => setScreen("prepare")}
            >
              Library
            </button>
            <button
              aria-pressed={screen === "library"}
              onClick={() => setScreen("library")}
            >
              History & backup
            </button>
          </nav>
          {screen !== "prepare" && (
            <label>
              Singer{" "}
              <select
                disabled={disabled}
                value={profile}
                onChange={(e) => {
                  setProfile(e.target.value);
                  setLast(null);
                  setSamples([]);
                }}
              >
                {lib.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {notice && screen !== "practice" && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <input
        ref={file}
        type="file"
        accept=".mid,.midi,.musicxml,.xml"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
          e.target.value = "";
        }}
      />
      {!loaded ? (
        <main>
          <h1>Opening your local library…</h1>
        </main>
      ) : screen === "prepare" ? (
        <main>
          <div className="hero row between">
            <div>
              <div className="eyebrow">YOUR VOICE. YOUR PART.</div>
              <h1>Make the harmony yours.</h1>
              <p className="muted">
                Choose your singer and a piece. Your rehearsal is one step away.
              </p>
            </div>
            <div className="row">
              <button onClick={demo}>Try 12-part study</button>
              <button className="primary" onClick={() => file.current?.click()}>
                Import score
              </button>
            </div>
          </div>
          <div className="library-choices">
            <section className="singer-choice panel">
              <div className="eyebrow">01 · WHO IS SINGING?</div>
              <h2>Your singer</h2>
              <div className="singer-cards">
                {lib.profiles.map((p) => (
                  <button
                    key={p.id}
                    className="singer-card"
                    aria-pressed={profile === p.id}
                    onClick={() => {
                      setProfile(p.id);
                      setLast(null);
                      setSamples([]);
                    }}
                  >
                    <span className="singer-avatar" aria-hidden="true">
                      {p.name.slice(0, 1).toUpperCase()}
                    </span>
                    <strong>{p.name}</strong>
                    <span>
                      {profile === p.id ? "Selected" : "Choose singer"}
                    </span>
                  </button>
                ))}
              </div>
              {!lib.profiles.length && (
                <p className="muted">
                  Add your name to create your first singer profile.
                </p>
              )}
              <details
                className="add-singer"
                open={lib.profiles.length === 0 ? true : undefined}
              >
                <summary>Add a singer</summary>
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newProfile.trim()) return;
                    const p = { id: uid(), name: newProfile.trim() };
                    update({
                      ...libRef.current,
                      profiles: [...libRef.current.profiles, p],
                    });
                    setProfile(p.id);
                    setNewProfile("");
                  }}
                >
                  <input
                    aria-label="New singer name"
                    placeholder="New singer name"
                    value={newProfile}
                    maxLength={80}
                    onChange={(e) => setNewProfile(e.target.value)}
                  />
                  <button>Add singer</button>
                </form>
              </details>
            </section>
            <section className="piece-choice panel">
              <div className="eyebrow">02 · WHAT SHALL WE SING?</div>
              <h2>Your pieces</h2>
              <div className="piece-cards">
                {lib.pieces.map((p) => (
                  <div key={p.id} className="piece-row">
                    <button
                      className="piece-card"
                      aria-pressed={pieceId === p.id}
                      onClick={() => selectPiece(p.id)}
                    >
                      <span className="piece-symbol" aria-hidden="true">
                        ♫
                      </span>
                      <span>
                        <strong>{p.title}</strong>
                        <small>
                          {p.parts.length} parts · {p.bars.length} bars
                        </small>
                      </span>
                      <span aria-hidden="true">
                        {pieceId === p.id ? "✓" : "→"}
                      </span>
                    </button>
                    <button
                      className="delete-piece"
                      aria-label={`Delete ${p.title}`}
                      title={`Delete ${p.title}`}
                      onClick={() => void removePiece(p)}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              {!piece && (
                <p className="muted">
                  Import a MIDI or MusicXML file or try the 12-part study to
                  start your first rehearsal.
                </p>
              )}
              {piece && settings && (
                <div className="practice-launch">
                  <p>
                    <strong>
                      {profileName || "Add a singer to start practising"}
                    </strong>
                    <br />
                    <span className="muted">
                      {piece.title} · {currentPart?.name}
                    </span>
                  </p>
                  <button
                    className="primary"
                    disabled={!profile}
                    onClick={() => {
                      setDrawer(null);
                      setTime(
                        secondsAt(piece, piece.bars[settings.from].start),
                      );
                      setScreen("practice");
                    }}
                  >
                    Open practice →
                  </button>
                </div>
              )}
            </section>
          </div>
          <footer>
            Local-only storage · Clearing site data can erase your library ·{" "}
            <a href={`${import.meta.env.BASE_URL}LICENSE`} target="_blank">
              AGPL-3.0-only
            </a>{" "}
            ·{" "}
            <a
              href={
                import.meta.env.VITE_SOURCE_URL ||
                `${import.meta.env.BASE_URL}source-notice.txt`
              }
              target="_blank"
            >
              Source code
            </a>{" "}
            ·{" "}
            <a
              href={`${import.meta.env.BASE_URL}source-notice.txt`}
              target="_blank"
            >
              Credits
            </a>
          </footer>
        </main>
      ) : screen === "practice" && piece && settings ? (
        <>
          <div className="practice-header">
            <button disabled={disabled} onClick={() => setScreen("prepare")}>
              ← Library
            </button>
            <div>
              <strong>{piece.title}</strong>
              <div className="muted">
                {profileName} · {currentPart?.name} · Bar{" "}
                {Math.min(
                  piece.bars.length,
                  barAt(
                    piece,
                    Math.min(tickAt(piece, viewTime), piece.end - 1),
                  ) + 1,
                )}
              </div>
            </div>
            <div className="top-transport">
              {running ? (
                <button
                  className="icon-button primary"
                  aria-label="Stop and review"
                  title="Stop and review"
                  onClick={() => void stop()}
                >
                  <TransportIcon kind="stop" />
                </button>
              ) : (
                <>
                  <button
                    className="icon-button primary"
                    disabled={starting}
                    aria-label="Sing my part"
                    title={starting ? "Opening audio…" : "Sing my part"}
                    onClick={() => void start(true)}
                  >
                    <TransportIcon kind="sing" />
                  </button>
                  <button
                    className="icon-button"
                    disabled={starting}
                    aria-label="Listen"
                    title="Listen"
                    onClick={() => void start(false)}
                  >
                    <TransportIcon kind="listen" />
                  </button>
                </>
              )}
              <label className="top-speed" title="Playback speed">
                <input
                  aria-label="Speed"
                  disabled={disabled}
                  type="range"
                  min="25"
                  max="200"
                  step="5"
                  value={Math.round(settings.speed * 100)}
                  onChange={(e) =>
                    change({ speed: Number(e.target.value) / 100 })
                  }
                />
                <output>{Math.round(settings.speed * 100)}%</output>
              </label>
              <button
                className="icon-button"
                disabled={disabled}
                aria-label="Loop passage"
                title="Loop passage"
                aria-pressed={settings.loop}
                onClick={() => change({ loop: !settings.loop })}
              >
                <TransportIcon kind="loop" />
              </button>
              <span
                className="record-status"
                title="One-bar count-in before each attempt"
              >
                {record ? "● Recording enabled" : "1-bar count-in"}
              </span>
            </div>
            <div className="row">
              <button
                className="icon-button"
                aria-label="Track settings"
                title="Track settings"
                aria-expanded={drawer === "tracks"}
                aria-controls="practice-settings"
                onClick={(e) => {
                  settingsTrigger.current = e.currentTarget;
                  setDrawer(drawer === "tracks" ? null : "tracks");
                }}
              >
                <SettingsIcon kind="tracks" />
              </button>
              <button
                className="icon-button"
                aria-label="Audio settings"
                title="Audio settings"
                aria-expanded={drawer === "audio"}
                aria-controls="practice-settings"
                onClick={(e) => {
                  settingsTrigger.current = e.currentTarget;
                  setDrawer(drawer === "audio" ? null : "audio");
                }}
              >
                <SettingsIcon kind="audio" />
              </button>
              <button
                onClick={() => {
                  if (document.fullscreenElement)
                    void document.exitFullscreen();
                  else
                    void root.current
                      ?.requestFullscreen()
                      .catch(() =>
                        setError(
                          "Full screen is unavailable. Maximize your browser window instead.",
                        ),
                      );
                }}
              >
                Full screen
              </button>
            </div>
          </div>
          {drawer && (
            <aside
              id="practice-settings"
              className="drawer"
              role="region"
              aria-label={
                drawer === "tracks" ? "Track settings" : "Audio settings"
              }
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  closeSettings();
                }
              }}
            >
              <div className="settings-heading">
                <h2>
                  {drawer === "tracks" ? "Track settings" : "Audio settings"}
                </h2>
                <button
                  autoFocus
                  className="icon-button"
                  aria-label="Close settings"
                  title="Close settings"
                  onClick={closeSettings}
                >
                  <SettingsIcon kind="close" />
                </button>
              </div>
              {drawer === "tracks" ? partsPanel : audioPanel}
            </aside>
          )}
          <Score
            piece={piece}
            settings={settings}
            time={viewTime}
            samples={samples}
            running={running}
            playbackPosition={playbackPosition}
            onMix={mix}
            controlsDisabled={disabled}
            onStartingNote={(part) =>
              void engine.current
                .startingNote(piece, { ...settings, part })
                .catch((e) => setError(message(e)))
            }
            onRange={(range) => {
              const from = range?.from ?? 0,
                to = range?.to ?? piece.bars.length - 1;
              change({ from, to, loop: !!range });
              setTime(secondsAt(piece, piece.bars[from].start));
              setSamples([]);
            }}
          />
          <div className="feedback" role="status">
            <span>
              {!running
                ? "Ready when you are"
                : time < secondsAt(piece, piece.bars[settings.from].start)
                  ? "Count-in…"
                  : !startConfig.current?.practice
                    ? "Listening to the rehearsal mix"
                    : frame && frame.rms > 0.0025
                      ? cents === null
                        ? "Listening · no confident target match"
                        : Math.abs(cents) <= 25
                          ? "On pitch"
                          : `${Math.abs(cents)} cents ${cents > 0 ? "high" : "low"}`
                      : "Sing into the selected microphone"}
            </span>
            <span>
              {frame?.midi !== null &&
              frame?.midi !== undefined &&
              frame.confidence >= 0.85
                ? noteLabel(frame.midi)
                : "—"}{" "}
              <small>
                {settings.timing && !settings.speakers
                  ? "Onsets estimated in review"
                  : "Onset assessment off"}
              </small>
            </span>
            <meter
              aria-label="Microphone level"
              min="0"
              max="0.15"
              value={frame?.rms || 0}
            />
          </div>
        </>
      ) : screen === "review" && last ? (
        <main>
          <div className="row between">
            <div>
              <div className="eyebrow">YOUR LAST ATTEMPT</div>
              <h1>One phrase at a time.</h1>
              <p>
                {last.title} · Bars {last.from + 1}–{last.to + 1} ·{" "}
                {Math.round(last.speed * 100)}%
              </p>
            </div>
            <button className="primary" onClick={() => setScreen("practice")}>
              Back to practice
            </button>
          </div>
          <div className="summary">
            <span>
              <strong>
                {
                  last.results.filter((r) => r.cents !== null && r.cents <= 50)
                    .length
                }
              </strong>{" "}
              notes within ±50 cents
            </span>
            <span>
              <strong>
                {last.results.filter((r) => r.cents !== null).length}
              </strong>{" "}
              notes assessed
            </span>
            <span>
              <strong>
                {last.results.filter((r) => r.cents === null).length}
              </strong>{" "}
              not assessed
            </span>
          </div>
          <section className="panel">
            <h3>Passages to revisit</h3>
            {suggestions(last.results).length ? (
              suggestions(last.results)
                .slice(0, 12)
                .map((b) => (
                  <div className="review-row" key={b.bar}>
                    <div>
                      <strong>Bar {b.bar + 1}</strong>
                      <p>
                        {[
                          b.pitch ? `${b.pitch} pitch deviations` : null,
                          b.timing ? `${b.timing} early / late entries` : null,
                          b.unknown ? `${b.unknown} notes not assessed` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <button onClick={() => retry(b.bar)}>
                      Practise this passage
                    </button>
                  </div>
                ))
            ) : (
              <p>No difficult passages identified among the assessed notes.</p>
            )}
            <p className="muted">
              Uncertain input is not counted as a mistake. Timing estimates
              depend on your compensation setting; repeated same-pitch syllables
              are not assessed.
            </p>
          </section>
          {last.recording && (
            <div className="row recording-actions">
              <button onClick={() => void recordingAction(last)}>
                Play recording
              </button>
              <button onClick={() => void recordingAction(last, true)}>
                Export recording
              </button>
              <button onClick={() => void removeRecording(last)}>
                Delete recording
              </button>
            </div>
          )}
          {recordingURL && (
            <audio controls src={recordingURL} key={recordingURL} />
          )}
        </main>
      ) : (
        <main>
          <h1>Your practice, kept here.</h1>
          <div className="setup-grid">
            <section className="panel">
              <h3>Singers</h3>
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newProfile.trim()) return;
                  const p = { id: uid(), name: newProfile.trim() };
                  update({
                    ...libRef.current,
                    profiles: [...libRef.current.profiles, p],
                  });
                  setProfile(p.id);
                  setNewProfile("");
                }}
              >
                <input
                  aria-label="New singer name"
                  placeholder="New singer name"
                  value={newProfile}
                  maxLength={80}
                  onChange={(e) => setNewProfile(e.target.value)}
                />
                <button>Add singer</button>
              </form>
              <p className="muted">
                Separate histories, shared repertoire. Local profiles are not
                password-protected accounts.
              </p>
            </section>
            <section className="panel">
              <h3>Backup & restore</h3>
              <label>
                <input
                  type="checkbox"
                  checked={includeAudio}
                  onChange={(e) => setIncludeAudio(e.target.checked)}
                />
                Include voice recordings
              </label>
              <div className="row" style={{ marginTop: 16 }}>
                <button
                  onClick={() =>
                    void store
                      .backup(lib, includeAudio)
                      .catch((e) => setError(message(e)))
                  }
                >
                  Export backup
                </button>
                <button onClick={() => restoreFile.current?.click()}>
                  Restore backup
                </button>
              </div>
              <input
                hidden
                type="file"
                accept=".json"
                ref={restoreFile}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  try {
                    if (f.size > 100 * 1024 * 1024)
                      throw new Error("Backup exceeds the 100 MB limit.");
                    await writes.current;
                    const next = await store.restore(
                      await f.text(),
                      libRef.current,
                    );
                    setLib(next);
                    libRef.current = next;
                    setNotice(
                      "Backup restored as new profiles and pieces. Existing data was preserved.",
                    );
                  } catch (e) {
                    setError("Restore failed: " + message(e));
                  }
                }}
              />
              <p className="muted">
                Clearing browser data can erase everything stored here. Restore
                adds new copies and never replaces existing data.
              </p>
            </section>
          </div>
          <section className="panel history">
            <h3>{profileName} · Practice history</h3>
            {lib.attempts.filter((a) => a.profile === profile).length ? (
              lib.attempts
                .filter((a) => a.profile === profile)
                .map((a) => (
                  <div className="review-row" key={a.id}>
                    <div>
                      <strong>{a.title}</strong>
                      <p>
                        {new Date(a.date).toLocaleString("en-GB")} · Bars{" "}
                        {a.from + 1}–{a.to + 1}
                      </p>
                    </div>
                    <div className="row">
                      <button
                        onClick={() => {
                          setPieceId(a.piece);
                          const p = libRef.current.pieces.find(
                            (p) => p.id === a.piece,
                          );
                          if (p) {
                            const k = `${profile}:${a.piece}`;
                            update({
                              ...libRef.current,
                              settings: {
                                ...libRef.current.settings,
                                [k]: {
                                  ...(libRef.current.settings[k] ||
                                    defaults(p)),
                                  part: a.part,
                                },
                              },
                            });
                          }
                          setLast(a);
                          setScreen("review");
                        }}
                      >
                        Review
                      </button>
                      {a.recording && (
                        <>
                          <button onClick={() => void recordingAction(a)}>
                            Play voice
                          </button>
                          <button onClick={() => void recordingAction(a, true)}>
                            Export
                          </button>
                          <button onClick={() => void removeRecording(a)}>
                            Delete voice
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))
            ) : (
              <p>No attempts yet. Your first practice will appear here.</p>
            )}
            {recordingURL && (
              <audio controls src={recordingURL} key={recordingURL}>
                <source type={recordingType} />
              </audio>
            )}
          </section>
        </main>
      )}
    </div>
  );
}
