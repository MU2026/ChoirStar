import { measureLatency } from "./latency-audio";
import type { LatencyResult } from "./latency";
import { playbackEndTick } from "./rehearsal";
import { LibraryIcon } from "./LibraryIcon";
import { TransportIcon } from "./TransportIcon";
import { WebsiteImportDialog } from "./WebsiteImportDialog";
import { PieceLibrary } from "./PieceLibrary";
import { libraryLayout } from "./piece-library";
import type { WebsiteCatalogue, WebsiteEntry } from "./website";
import { ensurePracticeProfile } from "./profiles";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioSession, type Frame } from "./audio";
import { MenuBranch, MenuItem, navigateMenu } from "./SettingsMenu";
import { INSTRUMENTS, type Instrument } from "./instruments";
import {
  completedFeedback,
  feedbackDelaySeconds,
  GRADE_COLORS,
} from "./note-feedback";
import type { NoteResult } from "./model";
import { ImportWarnings } from "./ImportWarnings";
import {
  barAt,
  defaults,
  secondsAt,
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
import { importScore } from "./score-import";
import { importPiece } from "./import-piece";
import { reloadPiece } from "./reload-piece";
import { fetchReloadFile } from "./reload-source";
const initial: Library = {
  version: 1,
  profiles: [],
  pieces: [],
  settings: {},
  attempts: [],
};
function SettingsIcon() {
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
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}
export default function App() {
  const [lib, setLib] = useState<Library>(initial),
    [loaded, setLoaded] = useState(false),
    [profile, setProfile] = useState(""),
    [pieceId, setPieceId] = useState(""),
    [screen, setScreen] = useState<"prepare" | "practice" | "library">(
      "prepare",
    );
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
    [drawer, setDrawer] = useState<
      "audio" | "library" | "import" | "backup" | null
    >(null),
    [last, setLast] = useState<Attempt | null>(null),
    [recordingURL, setRecordingURL] = useState(""),
    [recordingType, setRecordingType] = useState(""),
    [showWebsites, setShowWebsites] = useState(false);
  const [noteResults, setNoteResults] = useState<NoteResult[]>([]);
  const [scoreZoom, setScoreZoom] = useState(1);
  const [reloading, setReloading] = useState(false);
  const [reloadFallback, setReloadFallback] = useState<{
    id: string;
    page: string;
  } | null>(null);
  const reloadTarget = useRef<string | null>(null);
  const reloadFile = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<NoteResult[]>([]);
  const assessmentStart = useRef(0);
  const captureEpoch = useRef(-Infinity);
  const feedbackPart = useRef("");
  function clearFeedback() {
    resultsRef.current = [];
    feedbackPart.current = "";
    setNoteResults([]);
  }
  function refreshFeedback(until: number) {
    const cfg = startConfig.current;
    if (!cfg?.practice) return;
    const part = cfg.p.parts.find((p) => p.id === cfg.s.part)!;
    feedbackPart.current = part.id;
    const next = completedFeedback(
      cfg.p,
      part,
      sampleRef.current,
      cfg.s,
      until,
      resultsRef.current,
      assessmentStart.current,
    );
    if (next !== resultsRef.current) {
      resultsRef.current = next;
      setNoteResults(next);
    }
  }
  const layout = useMemo(
    () => libraryLayout(lib),
    [lib.pieces, lib.websites, lib.layout],
  );
  const libRef = useRef(lib);
  libRef.current = lib;
  const engine = useRef(new AudioSession());
  useEffect(() => {
    engine.current.setMonitoring(monitor, monitorVolume);
  }, [monitor, monitorVolume]);
  const playbackPosition = useCallback(
    () => Math.max(engine.current.startSeconds, engine.current.position()),
    [],
  );
  const microphoneDialog = useRef<HTMLDialogElement>(null);
  const latencyDialog = useRef<HTMLDialogElement>(null);
  const latencyAbort = useRef<AbortController | null>(null);
  const latencySetup = useRef<{
    key: string;
    device: string;
    channel: number;
  } | null>(null);
  const [measuringLatency, setMeasuringLatency] = useState(false);
  const [latencyProgress, setLatencyProgress] = useState(0);
  const [latencyError, setLatencyError] = useState("");
  const [latencyResult, setLatencyResult] = useState<LatencyResult | null>(
    null,
  );
  const settingsPanel = useRef<HTMLElement>(null);
  const [inputBusy, setInputBusy] = useState(false);
  const [inputError, setInputError] = useState("");
  const settingsTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!drawer) return;
    settingsPanel.current
      ?.querySelector<HTMLElement>('[role="menuitem"]')
      ?.focus();
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawer(null);
        settingsTrigger.current?.focus();
      }
    };
    const outside = (event: PointerEvent) => {
      if (
        !settingsPanel.current?.contains(event.target as Node) &&
        !settingsTrigger.current?.contains(event.target as Node)
      )
        setDrawer(null);
    };
    window.addEventListener("keydown", dismiss);
    window.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("keydown", dismiss);
      window.removeEventListener("pointerdown", outside);
    };
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
  const savedSettings = piece ? lib.settings[key] || defaults(piece) : null;
  // Older settings cannot distinguish a deliberate choice from the old default.
  const settings = savedSettings && {
    ...savedSettings,
    part: savedSettings.partSelectionConfirmed ? savedSettings.part : "",
  };
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
        [key]: {
          ...settings,
          ...patch,
          ...(patch.part !== undefined
            ? { partSelectionConfirmed: !!patch.part }
            : {}),
        },
      },
    });
  }
  useEffect(() => {
    store
      .load()
      .then((l) => {
        const next = ensurePracticeProfile(l || initial);
        if (next !== l) update(next);
        else setLib(next);
        setProfile(next.profiles[0].id);
        setPieceId(next.pieces[0]?.id || "");
        setLoaded(true);
      })
      .catch((e) => {
        setError("Local storage unavailable: " + message(e));
        setLoaded(true);
      });
    return () => {
      active.current = false;
      latencyAbort.current?.abort();
      void engine.current.close();
    };
  }, []);
  useEffect(() => {
    const changed = () => {
      latencyAbort.current?.abort();
      setLatencyResult(null);
      void refreshDevices().catch((e) =>
        setInputError("Could not refresh microphones: " + message(e)),
      );
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
      setTime(Math.max(engine.current.startSeconds, engine.current.position()));
      const cfg = startConfig.current;
      if (cfg)
        refreshFeedback(
          engine.current.position() -
            feedbackDelaySeconds(cfg.s) * engine.current.speed,
        );
      setSamples([...sampleRef.current]);
    }, 65);
    return () => clearInterval(id);
  }, [running]);
  function message(e: unknown) {
    return e instanceof Error ? e.message : String(e);
  }
  async function importWebsiteScore(
    f: File,
    entry: WebsiteEntry,
    catalogue: WebsiteCatalogue,
  ) {
    if (libRef.current.pieces.some((p) => p.website?.url === entry.url))
      return false;
    const p = await importScore(f);
    p.website = {
      url: entry.url,
      page: catalogue.url,
      category: entry.category,
    };
    p.title = entry.title;
    const result = importPiece(libRef.current, p);
    if (result.duplicate) return false;
    update(result.library);
    if (!pieceId) {
      setPieceId(p.id);
      setTime(0);
    }
    return true;
  }
  async function importFile(f: File) {
    try {
      setError("");
      const p = await importScore(f);
      const result = importPiece(libRef.current, p);
      if (result.duplicate) {
        setNotice(
          `Already in your library as “${result.piece.title}”. No duplicate was added. Use Reload on the existing score to refresh it.`,
        );
        setPieceId(result.piece.id);
        setTime(0);
        setScreen("prepare");
        return;
      }
      update(result.library);
      setPieceId(p.id);
      setTime(0);
      setScreen("prepare");
      setNotice(
        `Imported ${p.parts.length} parts. ${p.source === "midi" ? "MIDI notation is reconstructed; compare it with your score." : "Practice notation imported."} ${(p.importWarnings || []).join(" ")}`,
      );
    } catch (e) {
      setError(message(e));
    }
  }
  async function reloadFromFile(f: File, id: string) {
    setReloadFallback(null);
    setReloading(true);
    setError("");
    setNotice("");
    try {
      const imported = await importScore(f);
      const operation = writes.current.then(async () => {
        const next = reloadPiece(libRef.current, id, imported);
        await store.persist(next);
        libRef.current = next;
        setLib(next);
      });
      writes.current = operation.catch(() => {});
      await operation;
      setNotice(
        "Score reloaded. Folders, settings, practice history and recordings were kept.",
      );
    } catch (e) {
      setError(`Could not reload: ${message(e)}`);
    } finally {
      setReloading(false);
    }
  }
  async function reloadFromWebsite(id: string) {
    const p = libRef.current.pieces.find((p) => p.id === id);
    if (!p?.website) return;
    setReloading(true);
    setReloadFallback(null);
    setError("");
    setNotice("Reloading from the original website…");
    let f: File;
    try {
      f = await fetchReloadFile(p, libRef.current.websites ?? []);
    } catch (e) {
      setNotice("");
      setError(
        `Could not download the original score: ${message(e)} The saved score was kept. Choose a downloaded file if the source requires sign-in or blocks direct access.`,
      );
      setReloadFallback({ id, page: p.website.page });
      setReloading(false);
      return;
    }
    await reloadFromFile(f, id);
  }
  async function refreshDevices() {
    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === "audioinput" && d.deviceId,
    );
    setDevices(inputs);
    return inputs;
  }
  useEffect(() => {
    if (screen === "practice") void refreshDevices().catch(() => {});
  }, [screen]);
  async function inputAccess() {
    setInputBusy(true);
    setInputError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      await refreshDevices();
    } catch (e) {
      setInputError("Microphone access: " + message(e));
    } finally {
      setInputBusy(false);
    }
  }
  function cancelLatency() {
    latencyAbort.current?.abort();
    latencyAbort.current = null;
    setMeasuringLatency(false);
    latencyDialog.current?.close();
  }
  async function runLatencyMeasurement() {
    if (
      !settings ||
      running ||
      starting ||
      measuringLatency ||
      settings.speakers
    )
      return;
    const controller = new AbortController();
    latencyAbort.current = controller;
    latencySetup.current = {
      key,
      device: settings.device,
      channel: settings.channel,
    };
    setLatencyError("");
    setLatencyResult(null);
    setLatencyProgress(0);
    setMeasuringLatency(true);
    change({ timing: false });
    try {
      const ctx = await engine.current.ready();
      const result = await measureLatency(
        settings.device,
        settings.channel,
        controller.signal,
        setLatencyProgress,
        ctx,
      );
      if (!controller.signal.aborted && latencyAbort.current === controller)
        setLatencyResult(result);
    } catch (error) {
      if (!controller.signal.aborted) setLatencyError(message(error));
    } finally {
      if (latencyAbort.current === controller) {
        latencyAbort.current = null;
        setMeasuringLatency(false);
      }
    }
  }
  function applyLatency() {
    const setup = latencySetup.current;
    if (
      !settings ||
      !latencyResult ||
      !setup ||
      setup.key !== key ||
      setup.device !== settings.device ||
      setup.channel !== settings.channel ||
      settings.speakers
    ) {
      setLatencyResult(null);
      setLatencyError(
        "The audio setup changed. Measure again before applying a correction.",
      );
      return;
    }
    change({ offset: latencyResult.offsetMs, timing: true });
    setNotice(
      `Timing compensation set to ${latencyResult.offsetMs} ms. Re-measure after changing your microphone or headphones.`,
    );
    cancelLatency();
  }
  function frameReceived(f: Frame) {
    if (f.time < captureEpoch.current) return;
    setFrame(f);
    const cfg = startConfig.current;
    if (
      !active.current ||
      (!engine.current.running && !finishing.current) ||
      !cfg ||
      !cfg.practice
    )
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
        rms: f.rms,
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
    if (
      practice &&
      !loopConfig &&
      (!p.parts.some((part) => part.id === s.part) ||
        !s.device ||
        s.device === "off")
    ) {
      setInputError("");
      setDrawer(null);
      microphoneDialog.current?.showModal();
      return;
    }
    setStarting(true);
    setError("");
    setNotice("");
    sampleRef.current = [];
    captureEpoch.current = -Infinity;
    clearFeedback();
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
    let microphoneReady = !practice;
    try {
      if (practice) {
        if (!loopConfig) {
          const available = await refreshDevices();
          if (!available.some((d) => d.deviceId === s.device))
            throw new Error(
              "The selected microphone is unavailable. Choose an available device.",
            );
        }
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
      microphoneReady = true;
      const cursor = loopConfig
        ? p.bars[s.from].start
        : tickAt(p, Math.max(0, time));
      const startTick = cursor >= p.end - 1e-6 ? p.bars[s.from].start : cursor;
      const endTick = playbackEndTick(p, s, startTick);
      cfg.s.from = barAt(p, startTick + 1e-6);
      cfg.s.to = barAt(p, endTick - 0.001);
      assessmentStart.current = secondsAt(p, startTick);
      await engine.current.play(p, cfg.s, () => void finish(true), startTick);
      if (!active.current) {
        engine.current.stopPlayback();
        engine.current.releaseMic();
        return;
      }
      setScreen("practice");
      setDrawer(null);
      setRunning(true);
      setTime(Math.max(engine.current.startSeconds, engine.current.position()));
    } catch (e) {
      active.current = false;
      await engine.current.finishRecording();
      engine.current.stopPlayback();
      engine.current.releaseMic();
      if (!microphoneReady) {
        setInputError(message(e));
        microphoneDialog.current?.showModal();
      } else setError(message(e));
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
    active.current = natural && !!cfg?.practice;
    engine.current.stopPlayback();
    setRunning(false);
    setStarting(true);
    let attempt: Attempt | null = null;
    try {
      // Let buffered microphone frames arrive before finalizing the last note.
      if (natural && cfg?.practice)
        await new Promise((resolve) =>
          setTimeout(resolve, feedbackDelaySeconds(cfg.s) * 1000),
        );
      active.current = false;
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
          results: completedFeedback(
            cfg.p,
            cfg.p.parts.find((p) => p.id === cfg.s.part)!,
            sampleRef.current,
            cfg.s,
            Math.min(stoppedAt, engine.current.endSeconds),
            resultsRef.current,
            assessmentStart.current,
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
        resultsRef.current = attempt.results;
        feedbackPart.current = attempt.part;
        setNoteResults(attempt.results);
        setSamples([...sampleRef.current]);
        setTime(
          Math.max(
            engine.current.startSeconds,
            Math.min(stoppedAt, engine.current.endSeconds),
          ),
        );
        setScreen("practice");
      } else if (cfg)
        setTime(
          Math.max(
            engine.current.startSeconds,
            Math.min(stoppedAt, engine.current.endSeconds),
          ),
        );
    } catch (e) {
      setError("Could not finish attempt: " + message(e));
    } finally {
      active.current = false;
      engine.current.releaseMic();
      finishing.current = false;
      setStarting(false);
    }
    const nextSettings =
      cfg && libRef.current.settings[`${cfg.profile}:${cfg.p.id}`];
    if (natural && cfg?.s.loop && nextSettings?.loop) {
      setScreen("practice");
      setTimeout(() => {
        if (startConfig.current === cfg && cfg.s.loop)
          void start(cfg.practice, {
            ...cfg,
            s: {
              ...structuredClone(nextSettings),
              timing: nextSettings.speakers ? false : nextSettings.timing,
            },
          });
      }, 0);
    }
  }
  async function stop() {
    startConfig.current && (startConfig.current.s.loop = false);
    await finish(false);
  }
  function selectPiece(id: string) {
    clearFeedback();
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
    setFrame(null);
    setDrawer(null);
    setScreen("practice");
  }
  async function removePiece(itemId: string) {
    if (deleting) return;
    const currentLayout = layout;
    const item = currentLayout.items.find(
      (n) => n.id === itemId && n.type === "piece",
    );
    const p = libRef.current.pieces.find((p) => p.id === item?.pieceId);
    if (!p || !item) return;
    const lastReference =
      currentLayout.items.filter((n) => n.pieceId === p.id).length === 1;
    if (
      lastReference &&
      !confirm(
        `Remove the last reference to “${item.title}”?\n\nThis deletes the stored score and all its practice results, settings and recordings from this browser. Exported files are not affected. This cannot be undone.`,
      )
    )
      return;
    setDeleting(true);
    setError("");
    const operation = writes.current.then(async () => {
      const next = await store.deleteLibraryAppearance(
        { ...libRef.current, layout: currentLayout },
        itemId,
      );
      libRef.current = next;
      setLib(next);
      const removed = !next.pieces.some((piece) => piece.id === p.id);
      if (removed && pieceId === p.id) {
        clearFeedback();
        setPieceId(next.pieces[0]?.id || "");
        setTime(0);
        setSamples([]);
        setFrame(null);
      }
      if (removed) {
        if (last?.piece === p.id) setLast(null);
        setRecordingURL("");
      }
      setNotice(
        removed
          ? `Deleted “${item.title}” and its stored practice data.`
          : `Removed “${item.title}” from this list. Other references and practice data were kept.`,
      );
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
      const nextMix = { ...settings.mix, [id]: m };
      engine.current.setMix(nextMix);
      if (startConfig.current) startConfig.current.s.mix = nextMix;
    }
  }
  function selectPassage(range: { from: number; to: number } | null) {
    if (!piece || !settings) return;
    const patch = {
      from: range?.from ?? 0,
      to: range?.to ?? piece.bars.length - 1,
      loop: !!range,
    };
    change(patch);
    if (running && startConfig.current) {
      engine.current.setPassageEnd(piece, patch.to);
      // Keep this round's real start for assessment. The next iteration uses
      // the newly selected start, without moving the current playback clock.
      startConfig.current.s.to = Math.max(
        startConfig.current.s.from,
        barAt(piece, tickAt(piece, engine.current.endSeconds) - 0.001),
      );
      startConfig.current.s.loop = patch.loop;
    } else if (range) setTime(secondsAt(piece, piece.bars[range.from].start));
  }
  function changeSpeed(speed: number) {
    if (
      !settings ||
      !piece ||
      starting ||
      finishing.current ||
      speed === settings.speed
    )
      return;
    change({ speed });
    if (running && startConfig.current) {
      engine.current.setSpeed(speed);
      const position = Math.max(
        engine.current.startSeconds,
        engine.current.position(),
      );
      captureEpoch.current = engine.current.context!.currentTime;
      assessmentStart.current = position;
      startConfig.current.s.speed = speed;
      startConfig.current.s.from = barAt(piece, tickAt(piece, position));
      sampleRef.current = [];
      setSamples([]);
      clearFeedback();
      setFrame(null);
      setTime(position);
    }
  }
  function seekScore(tick: number) {
    if (!piece || !settings || starting || finishing.current) return;
    const target = Math.max(0, Math.min(piece.end - 0.001, tick));
    setTime(secondsAt(piece, target));
    if (running && startConfig.current) {
      const endTick = playbackEndTick(piece, settings, target);
      engine.current.seek(target, endTick);
      captureEpoch.current = engine.current.context!.currentTime;
      assessmentStart.current = secondsAt(piece, target);
      startConfig.current.s.from = barAt(piece, target + 1e-6);
      startConfig.current.s.to = barAt(piece, endTick - 0.001);
      sampleRef.current = [];
      setSamples([]);
      clearFeedback();
      setFrame(null);
    }
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
  const viewTime = time;
  const disabled = running || starting || measuringLatency;
  const devicePicker = settings && (
    <>
      <label className="field">
        Device
        <select
          aria-label="Recording device"
          value={settings.device || "off"}
          disabled={disabled || inputBusy}
          onChange={(e) => change({ device: e.target.value, timing: false })}
        >
          <option value="off">Off</option>
          {settings.device &&
            settings.device !== "off" &&
            !devices.some((d) => d.deviceId === settings.device) && (
              <option value={settings.device} disabled>
                Selected microphone unavailable
              </option>
            )}
          {devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Microphone ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={disabled || inputBusy}
        onClick={() => void inputAccess()}
      >
        {inputBusy ? "Checking microphones…" : "Allow access / refresh devices"}
      </button>
      {inputError && <p role="alert">{inputError}</p>}
      <small className="muted">
        Access reveals available microphones. Capture runs only during a singing
        round or a latency test and stops when it ends.
      </small>
    </>
  );
  const audioPanel = piece && settings && (
    <div role="menu" aria-label="Practice settings" onKeyDown={navigateMenu}>
      <MenuBranch label="Playback">
        <MenuBranch label="Instrument">
          {INSTRUMENTS.map((instrument) => (
            <MenuItem
              key={instrument.id}
              radio
              checked={(settings.instrument ?? "piano") === instrument.id}
              disabled={disabled}
              onClick={() => {
                change({ instrument: instrument.id as Instrument });
                closeSettings();
              }}
            >
              {instrument.name}
            </MenuItem>
          ))}
        </MenuBranch>
        <MenuItem
          checked={!!settings.speakers}
          disabled={disabled}
          title="Enable when using speakers. Keep playback quiet."
          onClick={() => {
            setMonitor(false);
            change({
              speakers: !settings.speakers,
              channel: !settings.speakers ? 0 : settings.channel,
              timing: false,
            });
            closeSettings();
          }}
        >
          Echo reduction <span className="menu-hint">for speakers</span>
        </MenuItem>
        <MenuBranch label="Hear my voice">
          <MenuItem
            checked={!monitor || !!settings.speakers}
            disabled={!!settings.speakers}
            onClick={() => setMonitor(!monitor)}
          >
            Mute
          </MenuItem>
          <label className="menu-slider">
            Voice level <output>{Math.round(monitorVolume * 100)}%</output>
            <input
              aria-label="Voice monitoring volume"
              type="range"
              min="0"
              max="100"
              disabled={!!settings.speakers}
              value={monitorVolume * 100}
              onChange={(e) => setMonitorVolume(Number(e.target.value) / 100)}
            />
          </label>
          <p className="menu-note">
            {settings.speakers
              ? "Off with echo reduction."
              : "Headphones only · may add delay"}
          </p>
        </MenuBranch>
      </MenuBranch>
      <MenuBranch label="Recording">
        <MenuBranch label="Device">
          <MenuItem
            radio
            checked={!settings.device || settings.device === "off"}
            disabled={disabled || inputBusy}
            onClick={() => {
              change({ device: "off", timing: false });
              closeSettings();
            }}
          >
            Off
          </MenuItem>
          {devices.map((d, i) => (
            <MenuItem
              key={d.deviceId}
              radio
              checked={settings.device === d.deviceId}
              disabled={disabled || inputBusy}
              onClick={() => {
                change({ device: d.deviceId, timing: false });
                closeSettings();
              }}
            >
              {d.label || `Microphone ${i + 1}`}
            </MenuItem>
          ))}
          {settings.device &&
            settings.device !== "off" &&
            !devices.some((d) => d.deviceId === settings.device) && (
              <MenuItem checked disabled onClick={() => {}}>
                Selected microphone unavailable
              </MenuItem>
            )}
          <div role="separator" className="menu-separator" />
          <MenuItem
            disabled={disabled || inputBusy}
            onClick={() => void inputAccess()}
          >
            {inputBusy
              ? "Checking microphones…"
              : "Allow access / refresh devices…"}
          </MenuItem>
          {inputError && (
            <p role="alert" className="menu-note">
              {inputError}
            </p>
          )}
        </MenuBranch>
        <MenuItem
          checked={record}
          disabled={disabled}
          title="Save the voice recording locally with this round."
          onClick={() => {
            setRecord(!record);
            closeSettings();
          }}
        >
          Save a recording
        </MenuItem>
        <div role="separator" className="menu-separator" />
        <MenuBranch label="Input and timing">
          <MenuBranch label="Input channel">
            {["Input 1 / mono", "Input 2 (audio interface)"].map(
              (label, channel) => (
                <MenuItem
                  key={channel}
                  radio
                  checked={settings.channel === channel}
                  disabled={disabled || !!settings.speakers}
                  onClick={() => {
                    change({ channel, timing: false });
                    closeSettings();
                  }}
                >
                  {label}
                </MenuItem>
              ),
            )}
          </MenuBranch>
          <MenuItem
            disabled={disabled}
            onClick={() => {
              closeSettings();
              engine.current.stopPlayback();
              engine.current.releaseMic();
              setLatencyResult(null);
              setLatencyError("");
              latencyDialog.current?.showModal();
            }}
          >
            Measure latency…
          </MenuItem>
          <label className="menu-slider">
            Compensation <output>{settings.offset} ms</output>
            <input
              aria-label="Input / output compensation (ms)"
              type="range"
              min="-1000"
              max="1000"
              step="10"
              disabled={disabled}
              value={settings.offset}
              onChange={(e) =>
                change({ offset: Number(e.target.value), timing: false })
              }
            />
          </label>
          <MenuItem
            checked={settings.timing && !settings.speakers}
            disabled={disabled || !!settings.speakers}
            title="Enable only after checking timing with the current input and output."
            onClick={() => {
              change({ timing: !settings.timing });
              closeSettings();
            }}
          >
            Timing checked for this setup
          </MenuItem>
          <p className="menu-note">
            Experimental · recheck after device changes
          </p>
        </MenuBranch>
      </MenuBranch>
      <MenuBranch label="View">
        <MenuItem
          onClick={() => {
            closeSettings();
            if (document.fullscreenElement)
              void document
                .exitFullscreen()
                .catch(() => setError("Could not exit full screen."));
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
        </MenuItem>
        <MenuBranch label="Zoom">
          <label className="menu-slider">
            Zoom <output>{Math.round(scoreZoom * 100)}%</output>
            <input
              aria-label="View zoom"
              type="range"
              min="50"
              max="200"
              step="5"
              value={scoreZoom * 100}
              onChange={(e) => setScoreZoom(Number(e.target.value) / 100)}
            />
          </label>
          <MenuItem onClick={() => setScoreZoom(1)}>Reset to 100%</MenuItem>
        </MenuBranch>
      </MenuBranch>
      <MenuBranch label={`Tempo · ${Math.round(settings.speed * 100)}%`}>
        <label className="menu-slider">
          Playback speed <output>{Math.round(settings.speed * 100)}%</output>
          <input
            aria-label="Playback speed"
            type="range"
            min="25"
            max="200"
            step="5"
            value={settings.speed * 100}
            disabled={starting}
            onChange={(e) => changeSpeed(Number(e.target.value) / 100)}
          />
        </label>
        <MenuItem disabled={starting} onClick={() => changeSpeed(1)}>
          Reset to 100%
        </MenuItem>
      </MenuBranch>
      {disabled && (
        <p className="menu-note">
          Some playback and recording settings require stopping.
        </p>
      )}
    </div>
  );
  const closeSettings = () => {
    setDrawer(null);
    settingsTrigger.current?.focus();
  };
  async function exportBackup(recordings: boolean) {
    closeSettings();
    try {
      await writes.current;
      await store.backup(libRef.current, recordings);
    } catch (e) {
      setError("Backup export failed: " + message(e));
    }
  }
  const importItems = (
    <>
      <MenuItem
        disabled={!loaded || reloading}
        onClick={() => {
          closeSettings();
          file.current?.click();
        }}
      >
        Local file
      </MenuItem>
      <MenuItem
        disabled={!loaded || reloading}
        onClick={() => {
          closeSettings();
          setShowWebsites(true);
        }}
      >
        Web address
      </MenuItem>
    </>
  );
  const backupItems = (
    <>
      <MenuItem disabled={!loaded} onClick={() => void exportBackup(false)}>
        Export
      </MenuItem>
      <MenuItem disabled={!loaded} onClick={() => void exportBackup(true)}>
        Export with voice recordings
      </MenuItem>
      <MenuItem
        disabled={!loaded}
        title="Restore adds copies and preserves existing data."
        onClick={() => {
          closeSettings();
          restoreFile.current?.click();
        }}
      >
        Restore
      </MenuItem>
    </>
  );
  const libraryMenu = (
    <div role="menu" aria-label="Library menu" onKeyDown={navigateMenu}>
      <MenuBranch label="Import">{importItems}</MenuBranch>
      <MenuBranch label="Backup">{backupItems}</MenuBranch>
      <MenuItem
        disabled={!loaded}
        onClick={() => {
          closeSettings();
          setScreen("library");
        }}
      >
        View practice history
      </MenuItem>
    </div>
  );
  const menuButton = (
    <button
      className="icon-button"
      aria-label="Settings"
      title="Settings"
      aria-expanded={drawer === "audio" || drawer === "library"}
      aria-controls="settings-popup"
      onClick={(e) => {
        settingsTrigger.current = e.currentTarget;
        setDrawer(
          drawer === "audio" || drawer === "library"
            ? null
            : screen === "practice"
              ? "audio"
              : "library",
        );
      }}
    >
      <SettingsIcon />
    </button>
  );
  const settingsPopup = drawer && (
    <aside
      ref={settingsPanel}
      id="settings-popup"
      className="drawer settings-popup"
      style={
        screen !== "practice"
          ? { left: settingsTrigger.current?.offsetLeft ?? 0 }
          : undefined
      }
      role="region"
      aria-label="Settings"
      onKeyDown={(e) => {
        if (e.key === "Tab") closeSettings();
        if (e.key === "Escape") {
          e.stopPropagation();
          closeSettings();
        }
      }}
    >
      {screen === "practice" ? (
        audioPanel
      ) : drawer === "import" || drawer === "backup" ? (
        <div
          role="menu"
          aria-label={drawer === "import" ? "Import" : "Backup"}
          onKeyDown={navigateMenu}
        >
          {drawer === "import" ? importItems : backupItems}
        </div>
      ) : (
        libraryMenu
      )}
    </aside>
  );
  return (
    <div
      ref={root}
      inert={deleting || undefined}
      aria-busy={deleting}
      className={"app " + (screen === "practice" ? "focus" : "")}
    >
      {screen !== "practice" && (
        <header inert={reloading}>
          <div className="practice-menu-anchor">
            {menuButton}
            {drawer !== "import" && drawer !== "backup" && settingsPopup}
          </div>
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setDrawer(null);
              setScreen("prepare");
            }}
          >
            ChoirStar <span>✦</span>
          </a>
          <span className="tag">LOCAL PRACTICE · 0.1</span>
          {screen === "library" && (
            <button
              className="history-back"
              onClick={() => setScreen("prepare")}
            >
              ← Library
            </button>
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
        accept=".mid,.midi,.musicxml,.xml,.nwc,.nwctxt"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
          e.target.value = "";
        }}
      />
      <input
        ref={reloadFile}
        type="file"
        accept=".mid,.midi,.musicxml,.xml,.nwc,.nwctxt"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          const id = reloadTarget.current;
          reloadTarget.current = null;
          e.target.value = "";
          if (f && id) void reloadFromFile(f, id);
        }}
      />
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
            const next = await store.restore(await f.text(), libRef.current);
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
      {!loaded ? (
        <main>
          <h1>Opening your local library…</h1>
        </main>
      ) : screen === "prepare" ? (
        <main className="library-home">
          <section className="piece-choice panel">
            {reloadFallback && (
              <div className="row notice" role="status">
                {/^https?:\/\//i.test(reloadFallback.page) && (
                  <a
                    href={reloadFallback.page}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open source website / sign in
                  </a>
                )}
                <button
                  onClick={() => {
                    reloadTarget.current = reloadFallback.id;
                    reloadFile.current?.click();
                  }}
                >
                  Choose downloaded file
                </button>
                <button
                  onClick={() => {
                    setReloadFallback(null);
                    setError("");
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
            {reloading && (
              <p className="muted" role="status">
                Reloading score…
              </p>
            )}
            <div inert={reloading} aria-busy={reloading}>
              <PieceLibrary
                pieces={lib.pieces}
                layout={layout}
                rootActions={
                  <span
                    className="library-shortcuts"
                    onClick={(event) => event.preventDefault()}
                  >
                    {screen === "prepare" &&
                      (["import", "backup"] as const).map((action) => (
                        <button
                          key={action}
                          className="library-action library-shortcut"
                          aria-label={action === "import" ? "Import" : "Backup"}
                          title={action === "import" ? "Import" : "Backup"}
                          aria-haspopup="menu"
                          aria-expanded={drawer === action}
                          aria-controls="settings-popup"
                          disabled={!loaded || reloading}
                          onClick={(event) => {
                            event.preventDefault();
                            settingsTrigger.current = event.currentTarget;
                            setDrawer(drawer === action ? null : action);
                          }}
                        >
                          <LibraryIcon kind={action} />
                        </button>
                      ))}
                    {(drawer === "import" || drawer === "backup") &&
                      settingsPopup}
                  </span>
                }
                onChange={(layout) => update({ ...libRef.current, layout })}
                onSelect={selectPiece}
                onDelete={(itemId) => void removePiece(itemId)}
                reloading={reloading}
                onReload={(id) => {
                  if (libRef.current.pieces.find((p) => p.id === id)?.website) {
                    void reloadFromWebsite(id);
                    return;
                  }
                  setReloadFallback(null);
                  reloadTarget.current = id;
                  reloadFile.current?.click();
                }}
              />
            </div>
            {!lib.pieces.length && (
              <p className="muted">
                Use Import to add a local MIDI, MusicXML or NWC file, or choose
                scores from a website.
              </p>
            )}
          </section>
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
            <div className="practice-menu-anchor">
              {menuButton}
              {settingsPopup}
            </div>
            <div className="practice-title">
              <strong>{piece.title}</strong>
              <div className="muted">
                {currentPart?.name || "No part selected"} · Bar{" "}
                {Math.min(
                  piece.bars.length,
                  barAt(
                    piece,
                    Math.min(tickAt(piece, viewTime), piece.end - 1),
                  ) + 1,
                )}
              </div>
            </div>
            {(record || settings.loop) && (
              <span className="record-status">
                {record ? "● Recording enabled" : "Direct loop"}
              </span>
            )}
            <ImportWarnings key={piece.id} warnings={piece.importWarnings} />
            <div className="top-transport">
              {running ? (
                <button
                  className="icon-button primary"
                  aria-label="Stop"
                  title="Stop"
                  onClick={() => void stop()}
                >
                  <TransportIcon kind="stop" />
                </button>
              ) : (
                <>
                  <button
                    className="icon-button"
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
              <button disabled={disabled} onClick={() => setScreen("prepare")}>
                ← Library
              </button>
            </div>
          </div>

          <dialog
            ref={microphoneDialog}
            className="import-warnings-dialog"
            aria-labelledby="microphone-title"
          >
            <h2 id="microphone-title">Get ready to sing</h2>
            <p>Choose your part and an available microphone before starting.</p>
            {!currentPart && (
              <p role="status">Select the part you want to practise.</p>
            )}
            <label>
              Voice part
              <select
                value={settings.part}
                onChange={(event) => change({ part: event.target.value })}
              >
                <option value="">Choose a part…</option>
                {piece.parts.map((part) => (
                  <option key={part.id} value={part.id}>
                    {part.name}
                  </option>
                ))}
              </select>
            </label>
            {devicePicker}
            <div className="row">
              <button
                disabled={
                  inputBusy ||
                  !currentPart ||
                  !settings.device ||
                  settings.device === "off" ||
                  !devices.some((d) => d.deviceId === settings.device)
                }
                onClick={() => {
                  microphoneDialog.current?.close();
                  void start(true);
                }}
              >
                Start singing
              </button>
              <button
                disabled={inputBusy}
                onClick={() => {
                  microphoneDialog.current?.close();
                  void start(false);
                }}
              >
                Listen without microphone
              </button>
              <button onClick={() => microphoneDialog.current?.close()}>
                Cancel
              </button>
            </div>
          </dialog>
          <dialog
            ref={latencyDialog}
            className="latency-dialog"
            aria-labelledby="latency-title"
            onCancel={cancelLatency}
            onClose={() => {
              latencyAbort.current?.abort();
            }}
          >
            <h2 id="latency-title">Measure audio delay</h2>
            <p>
              Place one headphone earpiece close to the selected microphone.
              Keep the room quiet and use a comfortable listening volume. Do not
              sing or tap along.
            </p>
            <p>
              Keep direct monitoring off during this test. Seven short signals
              measure the delay and then verify the result. This takes about 12
              seconds.
            </p>
            {devicePicker}
            <p className="menu-note">
              Input channel {settings.channel + 1}. To change the channel, close
              this dialog and use Recording → Input and timing.
            </p>
            {settings.speakers && (
              <p role="alert">
                Use headphones and turn off Echo reduction before measuring
                timing.
              </p>
            )}
            {measuringLatency && (
              <div role="status" aria-live="polite">
                <p>
                  {latencyProgress < 4
                    ? "Measuring delay…"
                    : "Verifying the correction…"}{" "}
                  {latencyProgress}/7 signals captured.
                </p>
                <progress
                  max="7"
                  value={latencyProgress}
                  aria-label="Latency measurement progress"
                />
              </div>
            )}
            {latencyError && <p role="alert">{latencyError}</p>}
            {latencyResult && (
              <div role="status">
                <p>
                  <strong>
                    Suggested correction: {latencyResult.offsetMs} ms
                  </strong>
                </p>
                <p>
                  Verification passed: {latencyResult.detected}/7 signals
                  detected, variation {latencyResult.spreadMs} ms, remaining
                  delay within {latencyResult.verificationMs} ms.
                </p>
                <p>
                  This checks the audio path. Singing detection remains
                  experimental. Re-measure after changing your microphone,
                  headphones or audio routing.
                </p>
              </div>
            )}
            <p className="menu-note">
              Test audio stays on this device and is discarded. Microphone
              capture ends after the test or when cancelled. The correction is
              saved only when you apply it.
            </p>
            <div className="row">
              <button
                disabled={
                  measuringLatency ||
                  inputBusy ||
                  !settings.device ||
                  settings.device === "off" ||
                  !!settings.speakers ||
                  !devices.some((device) => device.deviceId === settings.device)
                }
                onClick={() => void runLatencyMeasurement()}
              >
                {latencyResult ? "Measure again" : "Start measurement"}
              </button>
              {latencyResult && (
                <button disabled={measuringLatency} onClick={applyLatency}>
                  Use correction and enable timing
                </button>
              )}
              <button onClick={cancelLatency}>
                {measuringLatency ? "Cancel measurement" : "Close"}
              </button>
            </div>
          </dialog>
          <Score
            piece={piece}
            zoom={scoreZoom}
            settings={settings}
            time={viewTime}
            samples={samples}
            running={running}
            playbackPosition={playbackPosition}
            onMix={mix}
            onPart={(part) => change({ part })}
            controlsDisabled={disabled}
            results={noteResults}
            feedbackPart={feedbackPart.current}
            onNote={(midi) => {
              if (disabled) return;
              void engine.current
                .previewNote(midi, settings.instrument)
                .catch((e) => setError(message(e)));
            }}
            onSeek={seekScore}
            passageDisabled={starting}
            onMetronome={() => {
              const enabled = !settings.metronome;
              change({ metronome: enabled });
              engine.current.setMetronome(enabled);
              if (startConfig.current)
                startConfig.current.s.metronome = enabled;
            }}
            onInitialPitches={() =>
              change({ initialPitches: settings.initialPitches === false })
            }
            onSpeed={changeSpeed}
            onRange={selectPassage}
          />
          <div className="feedback" role="status">
            {noteResults.length > 0 && (
              <span
                className="note-rating"
                title={noteResults.at(-1)?.detail}
                style={{
                  color: noteResults.at(-1)?.grade
                    ? GRADE_COLORS[noteResults.at(-1)!.grade!]
                    : undefined,
                }}
              >
                {noteResults.at(-1)?.grade ?? "Not assessed"}
              </span>
            )}
            <span>
              {!running
                ? noteResults.length
                  ? "Performance saved · Scroll the score to review"
                  : "Ready when you are"
                : time < secondsAt(piece, piece.bars[settings.from].start)
                  ? "Starting notes / count-in…"
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
                {!running && noteResults.length
                  ? "Completed note grades"
                  : settings.timing && !settings.speakers
                    ? "Pitch + onset grades"
                    : "Pitch grades · timing not calibrated"}
              </small>
            </span>
            <meter
              aria-label="Microphone level"
              min="0"
              max="0.15"
              value={frame?.rms || 0}
            />
            <details className="grade-help">
              <summary>Grades</summary>
              <div>
                {Object.entries(GRADE_COLORS).map(([grade, color]) => (
                  <p key={grade} style={{ color }}>
                    <strong>{grade}</strong>
                  </p>
                ))}
                <p>
                  Pitch: Perfect ≤25 cents, Great ≤50, OK ≤100, Poor &gt;100.
                </p>
                <p>
                  Onset: Perfect ≤60 ms, Great ≤120, OK ≤200, Poor &gt;200. The
                  lower grade wins when timing is available.
                </p>
                <p>
                  Missed means observed silence. Uncertain input is not
                  assessed. Timing requires checked latency compensation;
                  repeated same-pitch entries may be unavailable.
                </p>
                <p>
                  Notes are colored after they finish. Hover or focus a note for
                  details; click to hear it while stopped.
                </p>
              </div>
            </details>
          </div>
        </>
      ) : (
        <main className="history-page">
          <section className="panel history">
            <h3>Practice history</h3>
            {lib.attempts.length ? (
              lib.attempts.map((a) => (
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
                        setProfile(a.profile);
                        setPieceId(a.piece);
                        const p = libRef.current.pieces.find(
                          (p) => p.id === a.piece,
                        );
                        if (p) {
                          const k = `${a.profile}:${a.piece}`;
                          update({
                            ...libRef.current,
                            settings: {
                              ...libRef.current.settings,
                              [k]: {
                                ...(libRef.current.settings[k] || defaults(p)),
                                part: a.part,
                                from: a.from,
                                to: a.to,
                                speed: a.speed,
                                loop: false,
                              },
                            },
                          });
                        }
                        setLast(a);
                        resultsRef.current = a.results;
                        feedbackPart.current = a.part;
                        setNoteResults(a.results);
                        setSamples([]);
                        setTime(p ? secondsAt(p, p.bars[a.from].start) : 0);
                        setScreen("practice");
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
      {showWebsites && (
        <WebsiteImportDialog
          catalogues={lib.websites || []}
          imported={
            new Set(
              lib.pieces.flatMap((p) => (p.website ? [p.website.url] : [])),
            )
          }
          onImport={importWebsiteScore}
          onClose={() => setShowWebsites(false)}
          onImported={(count, skipped = 0) => {
            setShowWebsites(false);
            setScreen("prepare");
            setNotice(
              `Imported ${count} ${count === 1 ? "score" : "scores"}. ${skipped ? `${skipped} already in your library; no duplicates added. ` : ""}Choose a piece to practise.`,
            );
          }}
          onSave={(catalogue) => {
            const websites = libRef.current.websites || [];
            if (
              !websites.some((c) => c.url === catalogue.url) &&
              websites.length >= 100
            )
              throw new Error("The library limit is 100 website catalogues.");
            update({
              ...libRef.current,
              websites: [
                ...websites.filter((c) => c.url !== catalogue.url),
                catalogue,
              ],
            });
          }}
        />
      )}
    </div>
  );
}
