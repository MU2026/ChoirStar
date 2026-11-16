import { metronomeTicks, rehearsalGains } from "./rehearsal";
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
    this.monitorLevel = enabled ? Math.max(0, Math.min(1, volume)) : 0;
    this.monitor?.gain.setTargetAtTime(
      this.speakers ? 0 : this.monitorLevel,
      this.context!.currentTime,
      0.02,
    );
  }
  async previewNote(midi: number, instrument: Instrument = "piano") {
    if (this.running) return;
    const ctx = await this.ready();
    if (this.running) return;
    this.stopPlayback();
    this.tone(
      ctx.currentTime,
      1,
      440 * 2 ** ((midi - 69) / 12),
      0.12,
      ctx.destination,
      instrument,
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
      monitor.gain.value = speakers ? 0 : this.monitorLevel;
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
  private metronomeEnabled = false;
  private metronomeNodes = new Set<OscillatorNode>();
  private resetMetronome: (() => void) | null = null;
  setMetronome(enabled: boolean) {
    this.metronomeEnabled = enabled;
    for (const node of this.metronomeNodes) {
      try {
        node.stop();
      } catch {
        /* Already stopped. */
      }
    }
    this.metronomeNodes.clear();
    this.resetMetronome?.();
  }
  private changePlaybackSpeed: ((speed: number) => void) | null = null;
  setSpeed(speed: number) {
    this.changePlaybackSpeed?.(Math.max(0.25, Math.min(2, speed)));
  }
  private seekPlayback: ((tick: number, endTick: number) => void) | null = null;
  seek(tick: number, endTick: number) {
    this.seekPlayback?.(tick, endTick);
  }
  async play(
    piece: Piece,
    settings: Settings,
    onEnd: () => void,
    startTick = piece.bars[settings.from].start,
  ) {
    const ctx = await this.ready();
    this.stopPlayback();
    this.running = true;
    this.speed = settings.speed;
    this.metronomeEnabled = !!settings.metronome;
    this.startSeconds = secondsAt(piece, startTick);
    this.endSeconds = secondsAt(piece, piece.bars[settings.to].end);
    const meter = piece.bars[settings.from].meter;
    const bpm =
      [...piece.tempos].reverse().find((t) => t.tick <= startTick)?.bpm || 120;
    let beat = ((60 / bpm) * 4) / meter[1] / settings.speed;
    const preparation =
      settings.initialPitches === false
        ? []
        : piece.parts
            .flatMap((part) => {
              const note = part.notes.find(
                (n) =>
                  n.tick + n.length > startTick &&
                  n.tick < piece.bars[settings.to].end,
              );
              return note ? [note] : [];
            })
            .sort((a, b) => b.midi - a.midi);
    let countStart = ctx.currentTime + 0.15 + preparation.length;
    let preparationDone = false;
    const preparationNodes = new Set<OscillatorNode>();
    const countNodes = new Set<OscillatorNode>();
    this.startTime = countStart + (settings.loop ? 0 : beat * meter[0]);
    const master = ctx.createGain();
    master.gain.value = 0.7 / Math.sqrt(piece.parts.length);
    const compressor = ctx.createDynamicsCompressor();
    master.connect(compressor).connect(ctx.destination);
    this.playNodes = [master, compressor];
    const levels = rehearsalGains(settings.mix);
    for (const p of piece.parts) {
      const gain = ctx.createGain();
      gain.gain.value = levels[p.id] ?? 0.6;
      gain.connect(master);
      this.gains.set(p.id, gain);
    }
    preparation.forEach((note, i) =>
      preparationNodes.add(
        this.tone(
          ctx.currentTime + 0.15 + i,
          1,
          440 * 2 ** ((note.midi - 69) / 12),
          0.12,
          ctx.destination,
          settings.instrument ?? "piano",
        ),
      ),
    );
    const scheduleCount = (first = 0) => {
      for (let i = first; !settings.loop && i < meter[0]; i++)
        countNodes.add(
          this.tone(
            countStart + i * beat,
            0.07,
            i === 0 ? 880 : 660,
            0.09,
            master,
            "sine",
          ),
        );
    };
    scheduleCount();
    const events = piece.parts
      .flatMap((p) =>
        p.notes.map((n) => ({
          part: p.id,
          start: secondsAt(piece, n.tick),
          end: secondsAt(piece, n.tick + n.length),
          midi: n.midi,
          velocity: n.velocity,
        })),
      )
      .filter((n) => n.end > n.start)
      .sort((a, b) => a.start - b.start);
    const beats = metronomeTicks(piece).map((beat) => ({
      ...beat,
      seconds: secondsAt(piece, beat.tick),
    }));
    let beatIndex = 0;
    const alignBeats = () => {
      const position = Math.max(this.startSeconds, this.position());
      const at = beats.findIndex((beat) => beat.seconds >= position - 1e-6);
      beatIndex = at < 0 ? beats.length : at;
    };
    alignBeats();
    let index = 0;
    const schedule = () => {
      if (!this.running) return;
      if (ctx.currentTime >= this.startTime) preparationDone = true;
      while (index < events.length) {
        const n = events[index],
          start = Math.max(n.start, this.startSeconds),
          time = this.startTime + (start - this.startSeconds) / this.speed;
        if (n.end <= start) {
          index++;
          continue;
        }
        if (time > ctx.currentTime + 0.22 || start >= this.endSeconds) break;
        index++;
        this.tone(
          time,
          (n.end - start) / this.speed,
          440 * 2 ** ((n.midi - 69) / 12),
          0.18 * n.velocity,
          this.gains.get(n.part)!,
          settings.instrument ?? "piano",
        );
      }
      while (this.metronomeEnabled && beatIndex < beats.length) {
        const beat = beats[beatIndex];
        const time =
          this.startTime + (beat.seconds - this.startSeconds) / this.speed;
        if (time > ctx.currentTime + 0.22 || beat.seconds >= this.endSeconds)
          break;
        beatIndex++;
        // Do not replay old clicks if the browser resumes after a long pause.
        if (time < ctx.currentTime - 0.02) continue;
        const node = this.tone(
          time,
          0.035,
          beat.accent ? 1200 : 800,
          0.12,
          master,
          "sine",
        );
        this.metronomeNodes.add(node);
      }
      if (
        ctx.currentTime >=
        this.startTime + (this.endSeconds - this.startSeconds) / this.speed
      ) {
        this.stopPlayback();
        onEnd();
      }
    };
    this.resetMetronome = () => {
      alignBeats();
      schedule();
    };
    this.changePlaybackSpeed = (speed) => {
      const now = ctx.currentTime;
      const preparing = !preparationDone && now < this.startTime;
      const position = Math.max(this.startSeconds, this.position());
      for (const node of this.nodes) {
        if (preparationNodes.has(node)) continue;
        try {
          node.stop();
        } catch {
          /* Already stopped. */
        }
        this.nodes.delete(node);
      }
      this.metronomeNodes.clear();
      countNodes.clear();
      const phase = Math.max(0, (now - countStart) / beat);
      this.speed = speed;
      if (preparing) {
        beat = ((60 / bpm) * 4) / meter[1] / speed;
        countStart = now < countStart ? countStart : now - phase * beat;
        this.startTime = countStart + (settings.loop ? 0 : beat * meter[0]);
        scheduleCount(phase > 0 ? Math.floor(phase) + 1 : 0);
      } else {
        this.startSeconds = position;
        this.startTime = now;
      }
      index = 0;
      alignBeats();
      schedule();
    };
    this.seekPlayback = (tick, endTick) => {
      preparationDone = true;
      preparationNodes.clear();
      countNodes.clear();
      for (const node of this.nodes) {
        try {
          node.stop();
        } catch {
          /* Already stopped. */
        }
      }
      this.nodes.clear();
      this.metronomeNodes.clear();
      this.startSeconds = secondsAt(piece, tick);
      this.endSeconds = secondsAt(piece, endTick);
      this.startTime = ctx.currentTime + 0.025;
      index = 0;
      alignBeats();
      schedule();
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
      this.metronomeNodes.delete(osc);
      osc.disconnect();
      gain.disconnect();
    };
    return osc;
  }
  position() {
    return (
      this.startSeconds +
      ((this.context?.currentTime || 0) - this.startTime) * this.speed
    );
  }
  setPassageEnd(piece: Piece, to: number) {
    this.endSeconds = Math.max(
      secondsAt(piece, piece.bars[to].end),
      this.running ? this.position() : 0,
    );
  }
  setMix(mix: Settings["mix"]) {
    for (const [id, level] of Object.entries(rehearsalGains(mix)))
      this.mix(id, level, false);
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
    this.resetMetronome = null;
    this.changePlaybackSpeed = null;
    this.metronomeNodes.clear();
    this.seekPlayback = null;
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
