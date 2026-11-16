import {
  analyseLatency,
  latencyProbe,
  LATENCY_GAP,
  LATENCY_SIGNALS,
  LATENCY_WINDOW,
} from "./latency";

const aborted = () => new DOMException("Measurement cancelled.", "AbortError");
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(aborted());
    signal.addEventListener("abort", cancel, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", cancel));
    if (signal.aborted) cancel();
  });
}

/** Temporary local capture: no monitoring, recording, storage or uploads. */
export async function measureLatency(
  device: string,
  channel: number,
  signal: AbortSignal,
  progress: (completed: number) => void,
  context?: AudioContext,
) {
  if (!device || device === "off")
    throw new Error("Choose a microphone before measuring.");
  if (signal.aborted) throw aborted();
  const ctx = context ?? new AudioContext({ latencyHint: "interactive" });
  let stream: MediaStream | undefined;
  const nodes: AudioNode[] = [];
  const probes: AudioBufferSourceNode[] = [];
  let capture: AudioWorkletNode | undefined;
  try {
    if (!ctx.audioWorklet || typeof AudioWorkletNode === "undefined")
      throw new Error(
        "Latency measurement is unavailable in this browser. Use desktop Chrome on localhost or HTTPS.",
      );
    await abortable(ctx.resume(), signal);
    const permission = navigator.mediaDevices
      .getUserMedia({
        audio: {
          deviceId: { exact: device },
          channelCount: { ideal: 2 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
      .then((input) => {
        stream = input; // Own the stream before a cancellation can win the await.
        if (signal.aborted) input.getTracks().forEach((track) => track.stop());
        return input;
      });
    stream = await abortable(permission, signal);
    const channels = stream.getAudioTracks()[0].getSettings().channelCount ?? 1;
    if (channel >= channels)
      throw new Error(
        `The selected microphone has ${channels} input channel(s). Choose an available channel.`,
      );
    await abortable(
      ctx.audioWorklet.addModule(
        new URL("./latency-capture.worklet.js?no-inline", import.meta.url),
      ),
      signal,
    );
    const source = ctx.createMediaStreamSource(stream);
    const splitter = ctx.createChannelSplitter(channels);
    capture = new AudioWorkletNode(ctx, "choirstar-latency-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    nodes.push(source, splitter, capture);
    const compressor = ctx.createDynamicsCompressor();
    nodes.push(compressor);
    compressor.connect(ctx.destination);
    const first = ctx.currentTime + 0.6;
    const sent = Array.from(
      { length: LATENCY_SIGNALS },
      (_, i) => first + i * LATENCY_GAP,
    );
    const finish = sent.at(-1)! + LATENCY_WINDOW + 0.15;
    const input = await new Promise<{ samples: Float32Array; start: number }>(
      (resolve, reject) => {
        const packets: Float32Array[] = [];
        let firstFrame = -1,
          nextFrame = -1,
          lastProgress = -1;
        const cleanup = () => {
          clearTimeout(timeout);
          signal.removeEventListener("abort", cancel);
          stream
            ?.getTracks()
            .forEach((track) =>
              track.removeEventListener("ended", disconnected),
            );
        };
        const fail = (error: unknown) => {
          cleanup();
          reject(error);
        };
        const cancel = () => fail(aborted());
        const disconnected = () =>
          fail(
            new Error(
              "The microphone disconnected. Reconnect it and try again.",
            ),
          );
        const timeout = window.setTimeout(
          () =>
            fail(
              new Error(
                "Audio capture stopped or timed out. Keep this page active and try again.",
              ),
            ),
          20000,
        );
        signal.addEventListener("abort", cancel, { once: true });
        stream!
          .getTracks()
          .forEach((track) =>
            track.addEventListener("ended", disconnected, { once: true }),
          );
        capture!.onprocessorerror = () =>
          fail(new Error("Audio capture failed. Please try again."));
        capture!.port.onmessage = (
          event: MessageEvent<{ frame: number; samples: Float32Array }>,
        ) => {
          const packet = event.data;
          if (
            !(packet.samples instanceof Float32Array) ||
            packet.samples.length !== 2048 ||
            !Number.isInteger(packet.frame)
          ) {
            fail(new Error("Invalid measurement audio."));
            return;
          }
          // Audio graphs can reconfigure while the input first connects.
          // Discard warm-up packets before any probe can be present.
          if (
            (packet.frame + packet.samples.length) / ctx.sampleRate <
            first - 0.1
          )
            return;
          if (firstFrame < 0) firstFrame = packet.frame;
          if (nextFrame >= 0 && nextFrame !== packet.frame) {
            fail(new Error("Audio capture was interrupted. Please try again."));
            return;
          }
          nextFrame = packet.frame + packet.samples.length;
          packets.push(packet.samples);
          const now = nextFrame / ctx.sampleRate;
          const completed = sent.filter(
            (time) => time + LATENCY_WINDOW + 0.07 <= now,
          ).length;
          if (completed !== lastProgress) {
            lastProgress = completed;
            progress(completed);
          }
          if (now >= finish) {
            cleanup();
            capture!.port.onmessage = null;
            const samples = new Float32Array(packets.length * 2048);
            packets.forEach((packet, i) => samples.set(packet, i * 2048));
            resolve({ samples, start: firstFrame / ctx.sampleRate });
          }
        };
        try {
          source.connect(splitter);
          splitter.connect(capture!, channel, 0);
          capture!.connect(ctx.destination); // Processor outputs zeros; never monitors the mic.
          sent.forEach((time, i) => {
            const probe = latencyProbe(ctx.sampleRate, i);
            const buffer = ctx.createBuffer(1, probe.length, ctx.sampleRate);
            buffer.copyToChannel(probe, 0);
            const node = ctx.createBufferSource();
            probes.push(node);
            nodes.push(node);
            node.buffer = buffer;
            node.connect(compressor);
            node.start(time);
          });
        } catch (error) {
          fail(error);
        }
        if (signal.aborted) cancel();
      },
    );
    if (signal.aborted) throw aborted();
    return analyseLatency(input.samples, ctx.sampleRate, input.start, sent);
  } finally {
    if (capture) {
      capture.port.postMessage({ stop: true });
      capture.port.onmessage = null;
      capture.onprocessorerror = null;
      capture.port.close();
    }
    probes.forEach((probe) => {
      try {
        probe.stop();
      } catch {
        /* Not started or already stopped. */
      }
    });
    nodes.forEach((node) => node.disconnect());
    stream?.getTracks().forEach((track) => track.stop());
    if (!context) await ctx.close();
  }
}
