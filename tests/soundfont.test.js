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
    rawContext: { name: "raw", audioWorklet: { loaded: [], addModule: async function (url) { this.loaded.push(url); } } },
    // Like Tone 14: one module per context, whichever was asked for first.
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
      ["range", 0, 12], // room for an octave's glissando either way
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

test("a pitch curve becomes the channel's pitch wheel, back to the centre after it", async () => {
  sound.useSoundfont({ bank: "bank.sf3", library, processor: "processor.js" });
  try {
    const node = sound.create({ gm: 40 }, fakeTone()).node;
    await node.loaded;
    sent.length = 0;
    // A glissando up a fifth over one second.
    assert.equal(sound.bendVoices(node, 60, 5, [{ time: 0, value: 0 }, { time: 1, value: 700 }]), true);
    const wheel = sent.filter((m) => m[0] === "wheel");
    assert.deepEqual(wheel[0], ["wheel", 0, 8192, 5], "it starts at the written pitch");
    const top = Math.max(...wheel.map((m) => m[2]));
    assert.equal(top, Math.round(8192 + (7 / 12) * 8192), "and reaches a fifth up, on a range of an octave");
    assert.deepEqual(wheel.at(-1), ["wheel", 0, 8192, 6.05], "then returns to the centre");
  } finally {
    sound.useSoundfont(null);
  }
});

test("a track can take a program from any bank, each bank with a synthesizer of its own", async () => {
  sent.length = 0;
  sound.useSoundfont({ library, processor: "processor.js" });
  try {
    const Tone = fakeTone();
    assert.equal(sound.create({ gm: 40 }, Tone).node.isSoundfont, undefined, "with no bank named, GM programs stay Samplers");
    const violin = sound.create({ sf2: "strings.sf2", program: 40 }, Tone).node;
    const piano = sound.create({ sf2: "pianos.sf2", program: 0, bankSelect: 8 }, Tone).node;
    await Promise.all([violin.loaded, piano.loaded]);
    assert.notEqual(violin._entry, piano._entry, "two banks, two synthesizers");
    assert.deepEqual([violin.channel, piano.channel], [0, 0], "each with its own channels");
    assert.equal(sent.filter((m) => m[0] === "bank").length, 2);
    const setup = sent.filter((m) => m[0] === "program" || (m[0] === "cc" && m[2] === 0));
    assert.deepEqual(setup, [["program", 0, 40], ["cc", 0, 0, 8, undefined], ["program", 0, 0]], "the bank number is selected before the program");
    assert.equal(sent.some((m) => m[0] === "cc" && m[2] === 73), false, "a bank of one's choosing keeps its own attack");
    const second = sound.create({ sf2: "strings.sf2", program: 42 }, Tone).node;
    assert.equal(second._entry, violin._entry, "the same bank shares its synthesizer");
    assert.equal(second.channel, 1);
  } finally {
    sound.useSoundfont(null);
  }
});

test("an sf2 track plays with the engine shipped beside the package, useSoundfont or not", () => {
  const built = sound.create({ sf2: "strings.sf2", program: 40 }, fakeTone());
  assert.ok(built?.node?.isSoundfont, "built on the shipped engine");
});

test("drumkit plays the drum bank, on the drum channel, with nothing declared", () => {
  const Tone = fakeTone();
  const built = sound.create("drumkit", Tone);
  assert.ok(built?.node?.isSoundfont);
  assert.equal(built.node.channel, 9, "General MIDI's drum channel");
  const second = sound.create("drumkit:808", Tone);
  assert.ok(second?.node?.isSoundfont, "a second kit takes another channel, switched to drums");
  assert.notEqual(second.node.channel, 9);
  assert.equal(sound.create("drumkit:acoustic", fakeTone()).node.isSoundfont, undefined, "the Tone.js kits are unchanged");
});

test("a piece's controller moves reach the channel as MIDI values", async () => {
  sound.useSoundfont({ library, processor: "processor.js" });
  try {
    const node = sound.create({ sf2: "strings.sf2", program: 40 }, fakeTone()).node;
    await node.loaded;
    sent.length = 0;
    node.controllerChange(1, 0.5, 2);
    node.pitchBend(1, 3);
    node.channelPressure(1, 4);
    assert.deepEqual(sent, [
      ["cc", node.channel, 1, 64, 2],
      ["wheel", node.channel, Math.round(8192 + (2 / 12) * 8191), 3], // two semitones up
      ["pressure", node.channel, 127, 4],
    ]);
  } finally {
    sound.useSoundfont(null);
  }
});

test("the synthesizer's processor loads even when another module came first, once per context", async () => {
  // Tone's addAudioWorkletModule keeps only the first module of a context: a
  // BitCrusher's, say. The processor has to reach the browser all the same.
  const Tone = fakeTone();
  const raw = Tone.getContext().rawContext;
  sound.useSoundfont({ bank: "worklet.sf3", library, processor: "processor.js" });
  const a = sound.create({ gm: 0 }, Tone);
  const b = sound.create({ gm: 1 }, Tone);
  await a.node.loaded;
  await b.node.loaded;
  assert.deepEqual(raw.audioWorklet.loaded, ["processor.js"]);
  sound.useSoundfont(false);
});
