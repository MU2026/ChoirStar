import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
it("timestamps variable audio quanta, emits continuous selected-channel samples, outputs silence and stops", () => {
  let Processor: any;
  const packets: any[] = [];
  const scope: any = {
    Float32Array,
    currentFrame: 1234,
    AudioWorkletProcessor: class {
      port = {
        postMessage: (packet: any) => packets.push(packet),
        onmessage: null,
      };
    },
    registerProcessor: (name: string, processor: any) => {
      expect(name).toBe("choirstar-latency-capture");
      Processor = processor;
    },
  };
  runInNewContext(
    readFileSync(
      new URL("../src/latency-capture.worklet.js", import.meta.url),
      "utf8",
    ),
    scope,
  );
  const processor = new Processor();
  let processed = 0;
  for (let i = 0; i < 32; i++) {
    const size = i % 2 ? 256 : 128;
    const input = Float32Array.from({ length: size }, (_, j) => processed + j);
    const output = new Float32Array(size).fill(1);
    expect(processor.process([[input]], [[output]])).toBe(true);
    expect(output.every((v) => v === 0)).toBe(true);
    processed += size;
    scope.currentFrame += size;
  }
  expect(packets).toHaveLength(3);
  packets.forEach((packet, i) => {
    expect(packet.frame).toBe(1234 + i * 2048);
    expect(Array.from(packet.samples)).toEqual(
      Array.from({ length: 2048 }, (_, j) => i * 2048 + j),
    );
  });
  processor.port.onmessage({ data: { stop: true } });
  expect(processor.process([], [[new Float32Array(128)]])).toBe(false);
});

it("drops an incomplete startup buffer if the audio graph skips frames", () => {
  let Processor: any;
  const packets: any[] = [];
  const scope: any = {
    Float32Array,
    currentFrame: 0,
    AudioWorkletProcessor: class {
      port = {
        postMessage: (packet: any) => packets.push(packet),
        onmessage: null,
      };
    },
    registerProcessor: (_name: string, value: any) => (Processor = value),
  };
  runInNewContext(
    readFileSync(
      new URL("../src/latency-capture.worklet.js", import.meta.url),
      "utf8",
    ),
    scope,
  );
  const processor = new Processor();
  processor.process(
    [[new Float32Array(128).fill(1)]],
    [[new Float32Array(128)]],
  );
  scope.currentFrame = 512;
  for (let i = 0; i < 16; i++) {
    processor.process(
      [[new Float32Array(128).fill(2)]],
      [[new Float32Array(128)]],
    );
    scope.currentFrame += 128;
  }
  expect(packets).toHaveLength(1);
  expect(packets[0].frame).toBe(512);
  expect(packets[0].samples.every((value: number) => value === 2)).toBe(true);
});
