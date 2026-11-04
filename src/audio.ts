import { instrumentHarmonics, type Instrument } from "./instruments";
import { secondsAt, type Piece, type Settings, type Sample } from "./model";
import { PITCH_POLL_MS, pitchWindowSize } from "./pitch-analysis";
import { PitchStability } from "./pitch-stability";
export interface Frame extends Sample {
  rms: number;
}
export class AudioSession {
  context: AudioContext | null = null;
  stream: MediaStream | null = null;
  worker: Worker | null = null;
  recorder: MediaRecorder | null = null;
  private timer = 0;
  private micTimer = 0;
  private nodes = new Set<OscillatorNode>();
  private gains = new Map<string, GainNode>();
  private inputNodes: AudioNode[] = [];
  private busy = false;
  private monitor: GainNode | null = null;
  private monitorLevel = 0;
  private speakers = false;
  setMonitoring(enabled: boolean, volume: number) {
    this.monitorLevel =
      enabled && !this.speakers ? Math.max(0, Math.min(1, volume)) : 0;
    this.monitor?.gain.setTargetAtTime(
      this.monitorLevel,
      this.context!.currentTime,
      0.02,
    );
  }
  async startingNote(piece: Piece, settings: Settings) {
    if (this.running) return;
    const start = piece.bars[settings.from].start;
    const end = piece.bars[settings.to].end;
    const note = piece.parts
      .find((p) => p.id === settings.part)
      ?.notes.find((n) => n.tick + n.length > start && n.tick < end);
    if (!note)
      throw new Error("This part has no notes in the selected passage.");
    const ctx = await this.ready();
    this.stopPlayback();
    this.tone(
      ctx.currentTime,
      1.5,
      440 * 2 ** ((note.midi - 69) / 12),
      0.12,
      ctx.destination,
      settings.instrument ?? "piano",
    );
  }
  startTime = 0;
  startSeconds = 0;
  endSeconds = 0;
  speed = 1;
  running = false;
  async ready() {
    if (!this.context || this.context.state === "closed")
      this.context = new AudioContext({ latencyHint: "interactive" });
    await this.context.resume();
    return this.context;
  }
  async microphone(
    device: string,
    channel: number,
    onFrame: (f: Frame) => void,
    speakers = false,
  ) {
    this.releaseMic();
    this.speakers = speakers;
    if (speakers) this.monitorLevel = 0;
    const stability = new PitchStability();
    const ctx = await this.ready();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: device ? { exact: device } : undefined,
          channelCount: { ideal: speakers ? 1 : 2 },
          echoCancellation: speakers,
          // Speech-oriented suppression can remove soft sung onsets.
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const channels =
        this.stream.getAudioTracks()[0].getSettings().channelCount || 1;
      if (channel >= channels)
        throw new Error(
          `The selected device exposes ${channels} input channel(s). Choose an available channel.`,
        );
      const source = ctx.createMediaStreamSource(this.stream),
        splitter = ctx.createChannelSplitter(channels),
        analyser = ctx.createAnalyser();
      analyser.fftSize = pitchWindowSize(ctx.sampleRate);
      analyser.smoothingTimeConstant = 0;
      source.connect(splitter);
      splitter.connect(analyser, channel);
      const monitor = ctx.createGain();
      monitor.gain.value = this.monitorLevel;
      analyser.connect(monitor).connect(ctx.destination);
      this.monitor = monitor;
      const destination = ctx.createMediaStreamDestination();
      analyser.connect(destination);
      this.inputNodes = [source, splitter, analyser, monitor, destination];
      this.worker = new Worker(new URL("./pitch.worker.ts", import.meta.url), {
        type: "module",
      });
      this.worker.onmessage = (e) => {
        this.busy = false;
        onFrame(stability.filter(e.data, speakers));
      };
      this.worker.onerror = () => {
        this.busy = false;
      };
      this.micTimer = window.setInterval(() => {
        if (this.busy || !this.worker) return;
        const buffer = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(buffer);
        this.busy = true;
        this.worker.postMessage(
          {
            buffer,
            rate: ctx.sampleRate,
            time: ctx.currentTime - buffer.length / (2 * ctx.sampleRate),
          },
          [buffer.buffer],
        );
      }, PITCH_POLL_MS);
      return {
        channels,
        destination,
        echoCancellation: this.stream.getAudioTracks()[0].getSettings()
          .echoCancellation,
      };
    } catch (e) {
      this.releaseMic();
      throw e;
    }
  }
  record(destination: MediaStreamAudioDestinationNode) {
    if (!window.MediaRecorder)
      throw new Error("Recording is not supported in this browser.");
    this.recorder = new MediaRecorder(destination.stream);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.recorder.start(1000);
  }
  private chunks: Blob[] = [];
  async finishRecording(): Promise<Blob | null> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === "inactive") return null;
    this.recorder = null;
    return new Promise((resolve, reject) => {
      recorder.onstop = () =>
        resolve(new Blob(this.chunks, { type: recorder.mimeType }));
      recorder.onerror = () => reject(new Error("Recording failed."));
      recorder.stop();
    });
  }
  async play(piece: Piece, settings: Settings, onEnd: () => void) {
    const ctx = await this.ready();
    this.stopPlayback();
    this.running = true;
    this.speed = settings.speed;
    this.startSeconds = secondsAt(piece, piece.bars[settings.from].start);
    this.endSeconds = secondsAt(piece, piece.bars[settings.to].end);
    const meter = piece.bars[settings.from].meter;
    const bpm =
      [...piece.tempos]
        .reverse()
        .find((t) => t.tick <= piece.bars[settings.from].start)?.bpm || 120;
    const beat = ((60 / bpm) * 4) / meter[1] / settings.speed;
    this.startTime = ctx.currentTime + 0.15 + beat * meter[0];
    const master = ctx.createGain();
    master.gain.value = 0.7 / Math.sqrt(piece.parts.length);
    const compressor = ctx.createDynamicsCompressor();
    master.connect(compressor).connect(ctx.destination);
    this.playNodes = [master, compressor];
    for (const p of piece.parts) {
      const gain = ctx.createGain();
      gain.gain.value = settings.mix[p.id]?.mute
        ? 0
        : (settings.mix[p.id]?.volume ?? 0.6);
      gain.connect(master);
      this.gains.set(p.id, gain);
    }
    for (let i = 0; i < meter[0]; i++)
      this.tone(
        ctx.currentTime + 0.15 + i * beat,
        0.07,
        i === 0 ? 880 : 660,
        0.09,
        master,
        "sine",
      );
    const events = piece.parts
      .flatMap((p) =>
        p.notes.map((n) => ({
          part: p.id,
          start: Math.max(secondsAt(piece, n.tick), this.startSeconds),
          end: Math.min(secondsAt(piece, n.tick + n.length), this.endSeconds),
          midi: n.midi,
          velocity: n.velocity,
        })),
      )
      .filter((n) => n.end > n.start && n.start < this.endSeconds)
      .sort((a, b) => a.start - b.start);
    let index = 0;
    const schedule = () => {
      if (!this.running) return;
      while (index < events.length) {
        const n = events[index],
          time = this.startTime + (n.start - this.startSeconds) / this.speed;
        if (time > ctx.currentTime + 0.22) break;
        index++;
        this.tone(
          time,
          (n.end - n.start) / this.speed,
          440 * 2 ** ((n.midi - 69) / 12),
          0.18 * n.velocity,
          this.gains.get(n.part)!,
          settings.instrument ?? "piano",
        );
      }
      if (
        ctx.currentTime >=
        this.startTime + (this.endSeconds - this.startSeconds) / this.speed
      ) {
        this.stopPlayback();
        onEnd();
      }
    };
    this.timer = window.setInterval(schedule, 25);
    schedule();
  }
  private playNodes: AudioNode[] = [];
  private tone(
    start: number,
    duration: number,
    freq: number,
    volume: number,
    dest: AudioNode,
    type: OscillatorType | Instrument,
  ) {
    const ctx = this.context!;
    const osc = ctx.createOscillator(),
      gain = ctx.createGain();
    if (
      type === "piano" ||
      type === "choir" ||
      type === "organ" ||
      type === "strings"
    ) {
      const harmonics = instrumentHarmonics(type, freq, ctx.sampleRate);
      osc.setPeriodicWave(
        ctx.createPeriodicWave(new Float32Array(harmonics.length), harmonics),
      );
    } else osc.type = type;
    osc.frequency.value = freq;
    const time = Math.max(ctx.currentTime, start),
      end = Math.max(time + 0.02, start + duration);
    const attack = type === "strings" ? 0.12 : type === "choir" ? 0.07 : 0.015;
    const attackEnd = Math.min(time + attack, time + (end - time) / 3);
    const releaseStart = Math.max(attackEnd, end - 0.035);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, attackEnd);
    if (type === "piano") {
      // Piano decays while held; the other presets sustain for the written duration.
      gain.gain.setTargetAtTime(volume * 0.08, attackEnd, 0.65);
      const level =
        volume * (0.08 + 0.92 * Math.exp(-(releaseStart - attackEnd) / 0.65));
      gain.gain.setValueAtTime(level, releaseStart);
    } else gain.gain.setValueAtTime(volume, releaseStart);
    gain.gain.linearRampToValueAtTime(0, end);
    osc.connect(gain).connect(dest);
    osc.start(time);
    osc.stop(end + 0.01);
    this.nodes.add(osc);
    osc.onended = () => {
      this.nodes.delete(osc);
      osc.disconnect();
      gain.disconnect();
    };
  }
  position() {
    return (
      this.startSeconds +
      ((this.context?.currentTime || 0) - this.startTime) * this.speed
    );
  }
  mix(id: string, volume: number, mute: boolean) {
    this.gains
      .get(id)
      ?.gain.setTargetAtTime(
        mute ? 0 : volume,
        this.context!.currentTime,
        0.02,
      );
  }
  stopPlayback() {
    clearInterval(this.timer);
    this.running = false;
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        /* Already stopped. */
      }
    }
    this.nodes.clear();
    this.gains.clear();
    this.playNodes.forEach((n) => n.disconnect());
    this.playNodes = [];
  }
  releaseMic() {
    clearInterval(this.micTimer);
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.inputNodes.forEach((n) => n.disconnect());
    this.inputNodes = [];
    this.monitor = null;
  }
  async close() {
    this.stopPlayback();
    await this.finishRecording();
    this.releaseMic();
    await this.context?.close();
    this.context = null;
  }
}
