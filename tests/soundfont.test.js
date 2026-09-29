/**
 * The SoundFont path: GM instruments played by spessasynth, one channel per
 * track, shaped for the host like a Tone.js instrument. spessasynth itself is
 * replaced by a recorder (tests/fixtures/fake-spessasynth.js), and Tone by
 * the few pieces the instrument uses.
 *
 * Run with: node --test tests/soundfont.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

const library = new URL("./fixtures/fake-spessasynth.js", import.meta.url).href;
const { sent } = await import(library);

globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });

const fakeTone = () => {
  const context = {
    currentTime: 0,
    rawContext: { name: "raw" },
    addAudioWorkletModule: async () => {},
    createAudioWorkletNode: () => ({ name: "worklet" }),
  };
  class Gain {
    constructor() { this.input = { name: "gain" }; this.connected = []; }
    connect(node) { this.connected.push(node); return this; }
    disconnect() { return this; }
    dispose() { this.disposed = true; }
  }
  const names = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const Frequency = (note) => ({ toMidi: () => (Number(note.slice(-1)) + 1) * 12 + names[note[0]] });
  return { getContext: () => context, Gain, Frequency, Time: (t) => ({ toSeconds: () => Number(t) }), Sampler: class { constructor(o) { this.options = o; } } };
};

const sound = await import("../src/index.js");

test("with a bank in use, a GM program becomes a channel of the SoundFont synthesizer", async () => {
  sent.length = 0;
  sound.useSoundfont({ bank: "bank.sf3", library, processor: "processor.js" });
  try {
    const Tone = fakeTone();
    const { node } = sound.create({ gm: 40 }, Tone);
    assert.equal(node.isSoundfont, true);
    await node.loaded;
    assert.deepEqual(sent.filter((m) => m[0] !== "bank"), [
      ["connect", 0, "gain"],
      ["program", 0, 40],
      ["cc", 0, 91, 0, undefined], // dry: the piece's reverb does the room
      ["cc", 0, 93, 0, undefined],
      ["cc", 0, 73, 100, undefined], // a bowed string starts a little softer
    ]);
    sent.length = 0;
    node.triggerAttackRelease("A4", 2, 1, 0.5);
    assert.deepEqual(sent, [["on", 0, 69, 64, 1], ["off", 0, 69, 3]], "notes are scheduled at their audio time");
  } finally {
    sound.useSoundfont(null);
  }
});

test("each track gets its own channel, never the drum channel, and a Sampler when none is left", async () => {
  sound.useSoundfont({ bank: "bank.sf3", library, processor: "processor.js" });
  try {
    const Tone = fakeTone();
    const nodes = Array.from({ length: 15 }, () => sound.create({ gm: 0 }, Tone).node);
    assert.deepEqual(nodes.map((n) => n.channel), [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15]);
    assert.equal(sound.create({ gm: 0 }, Tone).node.isSoundfont, undefined, "the sixteenth falls back to samples");
    nodes[3].dispose();
    assert.equal(sound.create({ gm: 0 }, Tone).node.channel, 3, "a disposed track frees its channel");
    assert.equal(sound.create({ gm: 0, soundfont: false }, Tone).node.isSoundfont, undefined, "and a track can opt out");
  } finally {
    sound.useSoundfont(null);
  }
});

test("a loudness curve becomes CC 11 on the channel, and the note is released there", async () => {
  sound.useSoundfont({ bank: "bank.sf3", library, processor: "processor.js" });
  try {
    const node = sound.create({ gm: 42 }, fakeTone()).node;
    await node.loaded;
    sent.length = 0;
    assert.equal(sound.handlesVoices(node), true, "the host plays it as attack, shape, release");
    node.triggerAttack("A2", 10, 0.5);
    const released = sound.shapeVoices(node, 45, 10, [{ time: 0, value: 0 }, { time: 0.5, value: 0.6 }, { time: 1, value: 1 }], { seconds: 2, velocity: 0.5 });
    assert.equal(released, true);
    const faders = sent.filter((m) => m[0] === "cc" && m[2] === 11).map((m) => m[3]);
    assert.equal(faders[0], 76, "a curve rising from silence starts at its first level: the instrument does the attack");
    assert.ok(Math.min(...faders) >= 76 && faders.includes(127));
    assert.deepEqual(sent.at(-1), ["off", 0, 45, 12]);
    sent.length = 0;
    node.triggerAttack("B2", 20, 0.5);
    assert.deepEqual(sent[0], ["cc", 0, 11, 127, 20], "a later note with no curve starts at rest");
  } finally {
    sound.useSoundfont(null);
  }
});

test("without a bank, GM programs are Samplers as before", () => {
  const { node } = sound.create({ gm: 40 }, fakeTone());
  assert.equal(node.isSoundfont, undefined);
  assert.ok(node.options.urls, "a Sampler with its sample URLs");
});
