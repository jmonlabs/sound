/**
 * SFZ instruments: reading the file, choosing the regions a note plays, and
 * what each region does with it. The audio is a recorder of the Web Audio
 * calls made (a fake context), and Tone the few pieces the instrument uses.
 *
 * Run with: node --test tests/sfz.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { parseSfz, readWav, sfzKey } from "../src/sfz-parse.js";
import { controlPlan, envelopeLevel, regionWeight, voicePlan } from "../src/sfz.js";

const sound = await import("../src/index.js");

test("keys are MIDI numbers or note names, middle C being c4", () => {
  assert.equal(sfzKey("60"), 60);
  assert.equal(sfzKey("c4"), 60);
  assert.equal(sfzKey("C#4"), 61);
  assert.equal(sfzKey("eb3"), 51);
  assert.equal(sfzKey("c-1"), 0);
});

test("a region inherits from its group, master and global, and `key` is a single tuned key", () => {
  const { control, regions } = parseSfz([
    "<control> default_path=..\\libs\\ set_cc1=64",
    "<global> volume=-6",
    "<group> ampeg_release=1.6 // slower release",
    "<region> sample=Solo Violin\\4_C#.wav key=c#4",
    "<region> sample=b.wav lokey=62 hikey=64 pitch_keycenter=63 volume=-3",
    "/* a block",
    "   comment */",
    "<group>",
    "<region> sample=c.wav",
  ].join("\r\n"));
  assert.deepEqual(control, { default_path: "..\\libs\\", set_cc1: 64 });
  assert.deepEqual(regions[0], {
    volume: -6, ampeg_release: 1.6, sample: "../libs/Solo Violin/4_C#.wav",
    key: 61, lokey: 61, hikey: 61, pitch_keycenter: 61,
  });
  assert.equal(regions[1].volume, -3, "a region's own opcode wins");
  assert.equal(regions[2].ampeg_release, undefined, "a new group starts afresh");
  assert.equal(regions[2].volume, -6, "but keeps the global");
});

test("#define and #include are expanded", () => {
  const { regions } = parseSfz('#define $LOUD -3\n#include "strings.sfz"', {
    include: (path) => (path === "strings.sfz" ? "<region> sample=a.wav volume=$LOUD" : ""),
  });
  assert.equal(regions[0].volume, -3);
});

test("a WAV is read at its own rate, with the loop of its smpl chunk", () => {
  const frames = 4;
  const bytes = new ArrayBuffer(12 + 24 + 8 + frames * 2 + 8 + 60);
  const view = new DataView(bytes);
  const ascii = (at, text) => [...text].forEach((c, k) => view.setUint8(at + k, c.charCodeAt(0)));
  ascii(0, "RIFF"); ascii(8, "WAVE");
  ascii(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 44100, true); view.setUint16(34, 16, true);
  ascii(36, "data"); view.setUint32(40, frames * 2, true);
  [0, 16384, -16384, 32767].forEach((v, k) => view.setInt16(44 + k * 2, v, true));
  const smpl = 44 + frames * 2;
  ascii(smpl, "smpl"); view.setUint32(smpl + 4, 60, true);
  view.setUint32(smpl + 8 + 28, 1, true); // one loop
  view.setUint32(smpl + 8 + 44, 1, true);
  view.setUint32(smpl + 8 + 48, 9, true); // past the end: brought back to the last frame
  const wav = readWav(bytes);
  assert.equal(wav.sampleRate, 44100);
  assert.deepEqual([...wav.channels[0]], [0, 0.5, -0.5, 32767 / 32768]);
  assert.deepEqual(wav.loop, { start: 1, end: 3 });
  assert.equal(readWav(new ArrayBuffer(4)), null, "not a WAV: the browser decodes it");
});

const note = { key: 60, velocity: 100, trigger: "attack", random: 0.5, round: 0, keyswitch: null };

test("a region answers the keys, velocities, round and key switch it is mapped to", () => {
  assert.equal(regionWeight({ lokey: 55, hikey: 65 }, note), 1);
  assert.equal(regionWeight({ lokey: 61 }, note), 0);
  assert.equal(regionWeight({ hivel: 90 }, note), 0);
  assert.equal(regionWeight({ trigger: "release" }, note), 0);
  assert.equal(regionWeight({ trigger: "release" }, { ...note, trigger: "release" }), 1);
  assert.equal(regionWeight({ seq_length: 2, seq_position: 1 }, note), 1);
  assert.equal(regionWeight({ seq_length: 2, seq_position: 2 }, note), 0);
  assert.equal(regionWeight({ seq_length: 2, seq_position: 2 }, { ...note, round: 1 }), 1);
  assert.equal(regionWeight({ lorand: 0.5, hirand: 1 }, note), 1);
  assert.equal(regionWeight({ lorand: 0, hirand: 0.5 }, note), 0);
  assert.equal(regionWeight({ sw_last: 36 }, { ...note, keyswitch: 37 }), 0);
  assert.equal(regionWeight({ sw_last: 36 }, { ...note, keyswitch: 36 }), 1);
});

test("a legato instrument plays its first note and its slurred notes from different regions", () => {
  assert.equal(regionWeight({ trigger: "first" }, note), 1);
  assert.equal(regionWeight({ trigger: "first" }, { ...note, legato: true }), 0);
  assert.equal(regionWeight({ trigger: "legato" }, note), 0);
  assert.equal(regionWeight({ trigger: "legato" }, { ...note, legato: true }), 1);
  assert.equal(regionWeight({}, { ...note, legato: true }), 1, "an ordinary region plays either way");
});

test("a velocity crossfade plays a region partly, at equal power", () => {
  const layer = { xfin_lovel: 63, xfin_hivel: 127 };
  assert.equal(regionWeight(layer, { ...note, velocity: 63 }), 0);
  assert.equal(regionWeight(layer, { ...note, velocity: 127 }), 1);
  assert.ok(Math.abs(regionWeight(layer, { ...note, velocity: 95 }) - Math.sqrt(0.5)) < 1e-9);
});

const planFor = (region, extra = {}) =>
  voicePlan(region, { key: 60, velocity: 127, weight: 1, controllers: {}, random: () => 0.5, ...extra });

test("a region is tuned from its key centre", () => {
  assert.equal(planFor({ pitch_keycenter: 60 }).rate, 1);
  assert.equal(planFor({ pitch_keycenter: 48 }).rate, 2);
  assert.equal(planFor({ pitch_keycenter: 60, transpose: -12 }).rate, 0.5);
  assert.equal(planFor({ pitch_keycenter: 60, tune: -5 }).cents, -5);
});

test("loudness adds the region's volume and the velocity curve", () => {
  assert.equal(planFor({}).gain, 1);
  assert.ok(Math.abs(planFor({ volume: -6 }).gain - 10 ** (-6 / 20)) < 1e-9);
  // velocity 64 of 127 is about -12 dB at full tracking, -7.2 dB at 60%
  const soft = (region) => 20 * Math.log10(planFor(region, { velocity: 64 }).gain);
  assert.ok(Math.abs(soft({}) - 40 * Math.log10(64 / 127)) < 1e-9);
  assert.ok(Math.abs(soft({ amp_veltrack: 60 }) - 0.6 * 40 * Math.log10(64 / 127)) < 1e-9);
});

test("the controllers set a voice's gain, its share of a layer crossfade, and its brightness", () => {
  // gain_cc1=34 with cc1 at 127 adds 34 dB
  assert.ok(Math.abs(controlPlan({ gain_cc1: 34 }, { 1: 127 }).gain - 10 ** (34 / 20)) < 1e-6);
  assert.equal(controlPlan({ gain_cc1: 34 }, { 1: 0 }).gain, 1);
  // the soft layer fades out and the loud one in as the mod wheel rises
  const soft = { xfout_locc1: 32, xfout_hicc1: 96 };
  const loud = { xfin_locc1: 32, xfin_hicc1: 96 };
  assert.deepEqual([controlPlan(soft, { 1: 0 }).gain, controlPlan(loud, { 1: 0 }).gain], [1, 0]);
  assert.deepEqual([controlPlan(soft, { 1: 127 }).gain, controlPlan(loud, { 1: 127 }).gain], [0, 1]);
  assert.ok(Math.abs(controlPlan(soft, { 1: 64 }).gain - Math.SQRT1_2) < 1e-9, "half way: equal power");
  assert.equal(controlPlan({ cutoff_cc1: 2400 }, { 1: 127 }).cutoffCents, 2400);
  // and the envelope reads them as the note starts
  assert.equal(planFor({ ampeg_attack: 0.1, ampeg_attackcc1: 1 }, { controllers: { 1: 127 } }).envelope.attack, 1.1);
});

test("the envelope follows the velocity, and a track's own envelope overrides it", () => {
  const region = { ampeg_attack: 1, ampeg_vel2attack: -0.5, ampeg_release: 1.6, ampeg_sustain: 80 };
  assert.deepEqual(planFor(region).envelope, { delay: 0, attack: 0.5, hold: 0, decay: 0, sustain: 0.8, release: 1.6 });
  assert.equal(planFor(region, { envelope: { attack: 0.2 } }).envelope.attack, 0.2);
  assert.equal(planFor(region, { envelope: { sustain: 1 } }).envelope.sustain, 1);
});

test("the envelope level is a linear attack, a hold, and a decay towards the sustain", () => {
  const env = { delay: 0.1, attack: 0.2, hold: 0.1, decay: 1, sustain: 0.5 };
  assert.equal(envelopeLevel(env, 0.05), 0);
  assert.ok(Math.abs(envelopeLevel(env, 0.2) - 0.5) < 1e-9);
  assert.equal(envelopeLevel(env, 0.35), 1);
  assert.ok(envelopeLevel(env, 5) - 0.5 < 1e-6);
});

test("an SFZ spec is read, and its instrument handles its own voices", () => {
  assert.deepEqual(sound.readSpec({ sfz: "violin.sfz", staccato: "violin-staccato.sfz", envelope: { attack: 0.2 } }), {
    kind: "sfz", sfz: "violin.sfz", staccato: "violin-staccato.sfz", staccatoUnder: undefined,
    envelope: { attack: 0.2 }, volume: undefined, controllers: undefined,
  });
  assert.equal(sound.handlesVoices({ isSfz: true }), true);
});

// ---- playback, on a context that records what it is asked to do ----

/** A Web Audio context that records calls, and whose buffers are 2 s long. */
function fakeContext() {
  const log = [];
  const param = (name) => {
    const p = { value: 0 };
    for (const method of ["setValueAtTime", "linearRampToValueAtTime", "exponentialRampToValueAtTime", "setTargetAtTime", "cancelScheduledValues"]) {
      p[method] = (...args) => { log.push([name, method, ...args]); return p; };
    }
    return p;
  };
  const node = (kind, params = []) => {
    const n = { kind, connect: () => n, disconnect: () => n };
    for (const name of params) n[name] = param(`${kind}.${name}`);
    return n;
  };
  const context = {
    currentTime: 0,
    log,
    sources: [],
    decodeAudioData: async () => ({ duration: 2, sampleRate: 44100 }),
    createBufferSource() {
      const source = node("source", ["playbackRate", "detune"]);
      source.start = (...args) => log.push(["source", "start", ...args]);
      source.stop = (...args) => log.push(["source", "stop", ...args]);
      context.sources.push(source);
      return source;
    },
    createGain: () => node("gain", ["gain"]),
    createStereoPanner: () => node("panner", ["pan"]),
    createBiquadFilter: () => node("filter", ["frequency", "Q", "gain", "detune"]),
    createOscillator: () => Object.assign(node("lfo", ["frequency"]), { start() {}, stop() {} }),
  };
  return context;
}

function fakeTone(context) {
  class Gain {
    constructor() { this.input = { name: "track" }; }
    connect() { return this; }
    dispose() {}
  }
  return { getContext: () => context, Gain, Frequency: () => ({ toFrequency: () => 440 }), Time: (t) => ({ toSeconds: () => Number(t) }), Sampler: class {} };
}

function serve(files) {
  globalThis.fetch = async (url) => {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop());
    if (!(name in files)) return { ok: false, status: 404 };
    const body = files[name];
    return { ok: true, text: async () => body, arrayBuffer: async () => new ArrayBuffer(4) };
  };
}

test("a short note plays the staccato file, a long one the sustain file", async () => {
  serve({
    "violin.sfz": "<region> sample=long.wav pitch_keycenter=60",
    "violin-staccato.sfz": "<region> sample=short.wav pitch_keycenter=60",
    "long.wav": "", "short.wav": "",
  });
  const context = fakeContext();
  const { node } = sound.create({ sfz: "https://x/violin.sfz", staccato: "https://x/violin-staccato.sfz" }, fakeTone(context));
  await node.loaded;
  node.triggerAttack(60, 1, 1, 2);
  node.triggerAttack(60, 3, 1, 0.1);
  const played = node.voices.map((v) => v.plan.sample.split("/").pop());
  assert.deepEqual(played, ["long.wav", "short.wav"]);
});

test("a short note the staccato file does not cover plays the sustain file", async () => {
  serve({
    "violin.sfz": "<region> sample=long.wav lokey=55 hikey=100",
    "violin-staccato.sfz": "<region> sample=short.wav lokey=55 hikey=90",
    "long.wav": "", "short.wav": "",
  });
  const context = fakeContext();
  const { node } = sound.create({ sfz: "https://x/violin.sfz", staccato: "https://x/violin-staccato.sfz" }, fakeTone(context));
  await node.loaded;
  node.triggerAttack(96, 0, 1, 0.1);
  assert.deepEqual(node.voices.map((v) => v.plan.sample.split("/").pop()), ["long.wav"]);
});

test("a slurred note starts from the legato regions, and fades the previous one over off_time", async () => {
  serve({
    "legato.sfz": [
      "<group> trigger=first group=1 off_by=1 off_mode=time off_time=1 <region> sample=first.wav",
      "<group> trigger=legato group=1 off_by=1 off_mode=time off_time=1 <region> sample=slur.wav",
    ].join("\n"),
    "first.wav": "", "slur.wav": "",
  });
  const context = fakeContext();
  const { node } = sound.create({ sfz: "https://x/legato.sfz" }, fakeTone(context));
  await node.loaded;
  node.triggerAttack(60, 0, 1);
  node.triggerRelease(60, 1);
  node.triggerAttack(62, 1, 1); // starts as the first ends: slurred
  node.triggerRelease(62, 2);
  node.triggerAttack(64, 5, 1); // after a rest: a first note again
  const played = node.voices.map((v) => v.plan.sample.split("/").pop());
  assert.deepEqual(played, ["first.wav", "slur.wav", "first.wav"]);
});

test("a released note falls 60 dB over its release from where its envelope is", async () => {
  serve({ "a.sfz": "<region> sample=a.wav ampeg_attack=1 ampeg_release=2", "a.wav": "" });
  const context = fakeContext();
  const { node } = sound.create({ sfz: "https://x/a.sfz" }, fakeTone(context));
  await node.loaded;
  node.triggerAttack(60, 0, 1);
  node.triggerRelease(60, 0.5); // half way through the attack
  const release = context.log.filter(([name]) => name === "gain.gain").slice(-3);
  assert.deepEqual(release, [
    ["gain.gain", "cancelScheduledValues", 0.5],
    ["gain.gain", "linearRampToValueAtTime", 0.5, 0.5],
    ["gain.gain", "exponentialRampToValueAtTime", 0.0005, 2.5],
  ]);
  assert.deepEqual(context.log.at(-1), ["source", "stop", 2.5]);
});

test("each note of a chord takes its own loudness curve and releases itself", async () => {
  serve({ "a.sfz": "<region> sample=a.wav ampeg_release=1", "a.wav": "" });
  const context = fakeContext();
  const { node } = sound.create({ sfz: "https://x/a.sfz" }, fakeTone(context));
  await node.loaded;
  node.triggerAttack([60, 64], 0, 1, 4);
  const shaped = sound.shapeVoices(node, 64, 0, [{ time: 0, value: 0.2 }, { time: 2, value: 1 }], { seconds: 4 });
  assert.equal(shaped, true);
  const [low, high] = node.voices;
  assert.equal(low.releasedAt, Infinity, "the other note is untouched");
  assert.equal(high.releasedAt, 4);
});

test("a release trigger sounds when the note ends, and a new note chokes it", async () => {
  serve({
    "a.sfz": [
      "<group> group=1 <region> sample=a.wav",
      "<group> group=3 off_by=1 trigger=release loop_mode=one_shot <region> sample=r.wav",
    ].join("\n"),
    "a.wav": "", "r.wav": "",
  });
  const context = fakeContext();
  const { node } = sound.create({ sfz: "https://x/a.sfz" }, fakeTone(context));
  await node.loaded;
  node.triggerAttack(60, 0, 1);
  node.triggerRelease(60, 1);
  const release = node.voices.find((v) => v.trigger === "release");
  assert.equal(release.start, 1);
  node.triggerAttack(62, 1.5, 1);
  assert.equal(release.releasedAt, 1.5);
});

test("a sounding note follows the mod wheel, whether the moves come before the note or while it sounds", async () => {
  serve({ "a.sfz": "<control> set_cc1=0 <region> sample=a.wav gain_cc1=20", "a.wav": "" });
  const ramps = (context) => context.log
    .filter(([name, method]) => name === "gain.gain" && method === "linearRampToValueAtTime")
    .map(([, , value, time]) => [Math.round(20 * Math.log10(value)), time]);

  // Rendering: every move is known before the notes are scheduled.
  let context = fakeContext();
  let node = sound.create({ sfz: "https://x/a.sfz" }, fakeTone(context)).node;
  await node.loaded;
  node.controllerChange(1, 1, 2);
  node.controllerChange(1, 0.5, 3);
  node.triggerAttack(60, 1, 1);
  node.triggerRelease(60, 4);
  assert.deepEqual(ramps(context).filter(([, t]) => t === 2 || t === 3), [[20, 2], [10, 3]]);

  // Live: the moves arrive as the note sounds.
  context = fakeContext();
  node = sound.create({ sfz: "https://x/a.sfz" }, fakeTone(context)).node;
  await node.loaded;
  node.triggerAttack(60, 1, 1);
  node.controllerChange(1, 1, 2);
  node.triggerRelease(60, 4);
  node.controllerChange(1, 0.5, 3);
  node.controllerChange(1, 0, 9); // after the note: not its business
  assert.deepEqual(ramps(context).filter(([, t]) => t >= 2), [[20, 2], [20, 2], [10, 3]]);
});
