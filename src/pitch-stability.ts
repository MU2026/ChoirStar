import type { Sample } from "./model";
/** Reject uncertain input rather than moving it towards the expected note. */
export class PitchStability {
  private accepted: number | null = null;
  private candidate: number | null = null;
  private count = 0;
  private lastTime = -Infinity;
  private lastAcceptedTime = -Infinity;
  filter(
    frame: Sample & { rms: number },
    speakers: boolean,
  ): Sample & { rms: number } {
    const reject = () => ({ ...frame, midi: null, confidence: 0 });
    const gap = frame.time - this.lastTime;
    if (frame.time - this.lastTime > 0.25) {
      this.accepted = null;
      this.candidate = null;
      this.count = 0;
    }
    if (gap > 0.08) {
      this.candidate = null;
      this.count = 0;
    }
    this.lastTime = frame.time;
    if (
      frame.midi === null ||
      !Number.isFinite(frame.midi) ||
      frame.confidence < (speakers ? 0.9 : 0.85) ||
      frame.rms < (speakers ? 0.006 : 0.0025)
    ) {
      // A short consonant or uncertain frame must not discard a stable pitch.
      if (frame.time - this.lastAcceptedTime > 0.12) this.accepted = null;
      this.candidate = null;
      this.count = 0;
      return reject();
    }
    if (this.accepted !== null && Math.abs(frame.midi - this.accepted) < 2) {
      this.accepted = frame.midi;
      this.lastAcceptedTime = frame.time;
      this.candidate = null;
      this.count = 0;
      return frame;
    }
    if (this.candidate !== null && Math.abs(frame.midi - this.candidate) < 0.7)
      this.count++;
    else this.count = 1;
    this.candidate = frame.midi;
    const required =
      this.accepted === null
        ? speakers
          ? 2
          : 1
        : Math.abs(frame.midi - this.accepted) >= 11
          ? 3
          : 2;
    if (this.count < required) return reject();
    this.accepted = frame.midi;
    this.lastAcceptedTime = frame.time;
    this.candidate = null;
    this.count = 0;
    return frame;
  }
}
