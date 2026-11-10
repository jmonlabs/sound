/**
 * ison: an instrument said in JSON. The pure half (performIson: strokes,
 * variants, the shape of a stroke) and the built half (one node per source,
 * a SoundFont's modes as its variants, a note going to its mode's node).
 *
 * Run with: node --test tests/ison.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

const library = new URL("./fixtures/fake-spessasynth.js", import.meta.url).href;
const { sent } = await import(library);
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });

const fakeTone = () => {
  const context = {
    currentTime: 0,
    rawContext: { name: "raw", audioWorklet: { addModule: async () => {} } },
    createAudioWorkletNode: () => ({ name: "worklet" }),
  };
  class Gain {
    constructor(gain = 1) { this.gain = gain; this.input = { name: "gain" }; this.connected = []; }
    connect(node) { this.connected.push(node); return this; }
    disconnect() { return this; }
    dispose() { this.disposed = true; }
  }
  // Like Tone's: a Monophonic synth releases without naming the note, and bends through its detune.
  class Monophonic {
    constructor(options) { this.options = options; this.played = []; this.frequency = {}; this.volume = { value: 0, ramps: [], setValueAtTime(v, t) { this.ramps.push(["set", Math.round(v), t]); }, linearRampToValueAtTime(v, t) { this.ramps.push(["ramp", Math.round(v), t]); }, cancelScheduledValues() {} }; this.detune = { ramps: [], setValueAtTime(v, t) { this.ramps.push(["set", v, t]); }, linearRampToValueAtTime(v, t) { this.ramps.push(["ramp", v, t]); }, cancelScheduledValues() {} }; }
    connect(node) { this.to = node; return this; }
    triggerAttack(note, time, velocity) { this.played.push(["on", note, time, velocity]); return this; }
    triggerRelease(time) { this.played.push(["off", time]); return this; }
    dispose() { this.disposed = true; }
  }
  class FMSynth extends Monophonic {}
  const names = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const Frequency = (note) => ({ toMidi: () => (Number(note.slice(-1)) + 1) * 12 + names[note[0]] });
  return { getContext: () => context, Gain, Monophonic, FMSynth, Frequency, Time: (t) => ({ toSeconds: () => Number(t) }), Sampler: class { constructor(o) { this.options = o; } connect() { return this; } } };
};

const sound = await import("../src/index.js");

const violin = {
  format: "ison",
  version: "1.0",
  name: "Violon",
  sources: { ldk: { sf2: "violin.sf2" } },
  modes: {
    normal: { source: "ldk", program: 0, holds: 5 },
    vibrato: { source: "ldk", program: 11, holds: 4 },
    pizzicato: { source: "ldk", program: 15, holds: 1.5, oneShot: true },
  },
  play: {
    bow: { max: 4, gap: 0.25, change: 0.8 },
    vibrato: { from: 2, mode: "vibrato" },
    stroke: { attack: 0.25, swell: 0.35, peak: 0.6, fade: 0.25 },
  },
  level: { db: -6, velocity: "sqrt" },
  controls: { brightness: { cc: 74, default: 0.5 } },
};

test("performIson: a long note is bowed in strokes, with vibrato on the long ones", () => {
  const notes = [{ pitch: 69, duration: 8, time: 0, velocity: 0.6 }, { pitch: 71, duration: 0.5, time: 8, velocity: 0.6 }];
  const played = sound.performIson(violin, notes, { tempo: 60 });
  // 8 beats at 60 BPM: a bow lasts 4 beats, but the vibrato recording holds 4 s = 4 beats, so two strokes
  assert.equal(played.length, 3);
  const [first, second, short] = played;
  assert.deepEqual([first.time, first.duration, first.velocity, first.variant], [0, 3.75, 0.6, "vibrato"]);
  assert.deepEqual([second.time, second.duration, second.variant], [4, 4, "vibrato"]);
  assert.ok(Math.abs(second.velocity - 0.48) < 1e-9, "the second stroke is softer");
  assert.equal(short.variant, undefined, "a short note keeps the usual mode");
  assert.equal(short.dynamics.length, 3, "a stroke under a beat only gets a soft attack");
  assert.deepEqual(first.dynamics.map((a) => a.value), [0, 0.65, 1, 0.75], "the shape of a stroke");
  assert.equal(notes[0].duration, 8, "the notes given are untouched");
});

test("performIson: a one-shot mode is never split, and a note's own variant and dynamics are kept", () => {
  const played = sound.performIson(violin, [
    { pitch: 69, duration: 8, time: 0, velocity: 0.6, variant: "pizzicato" },
    { pitch: 69, duration: 8, time: 8, velocity: 0.6, dynamics: [1, 0.5], variant: "normal" },
  ], { tempo: 60 });
  assert.equal(played[0].duration, 8);
  assert.equal(played[0].variant, "pizzicato");
  assert.deepEqual(played[1].dynamics, [1, 0.5]);
  assert.equal(played.length, 3, "a normal note of 8 beats is two strokes, both in its own mode");
  assert.equal(played[2].variant, "normal");
});

test("performPiece performs the ison tracks of a piece and leaves the others alone", () => {
  const piece = { tempo: 60, tracks: [
    { label: "violin", synth: violin, notes: [{ pitch: 69, duration: 8, time: 0, velocity: 0.6 }] },
    { label: "piano", synth: 0, notes: [{ pitch: 60, duration: 8, time: 0 }] },
  ] };
  const played = sound.performPiece(piece);
  assert.equal(played.tracks[0].notes.length, 2);
  assert.equal(played.tracks[1], piece.tracks[1]);
  assert.equal(piece.tracks[0].notes.length, 1, "the piece given is untouched");
});

test("an ison with a SoundFont source is one instrument whose modes are its variants", async () => {
  sound.useSoundfont({ library, processor: "processor.js" });
  sent.length = 0;
  try {
    const Tone = fakeTone();
    const { node } = sound.create(violin, Tone, {});
    assert.equal(node.isIson, true);
    assert.equal(sound.handlesVoices(node), true);
    assert.equal(node.nodes.length, 1, "one SoundFont node for the three modes");
    assert.deepEqual(Object.keys(node.byMode).sort(), ["normal", "pizzicato", "vibrato"]);
    assert.ok(Math.abs(node.output.gain - Math.pow(10, -6 / 20)) < 1e-9, "the level, in dB, on the output");
    await node.loaded;
    const programs = sent.filter((m) => m[0] === "program").map((m) => m[2]);
    assert.deepEqual(programs, [0, 11, 15]);
    assert.ok(sent.some((m) => m[0] === "cc" && m[2] === 74 && m[3] === 64), "a control's default goes to its controller");
    sent.length = 0;
    node.triggerAttack(69, 1, 0.25, 2, { variant: "vibrato" });
    node.triggerRelease(69, 3);
    assert.deepEqual(sent, [["on", 1, 69, 64, 1], ["off", 1, 69, 3]], "the note goes to its mode's channel, at the square root of its velocity");
  } finally {
    sound.useSoundfont(null);
  }
});

test("an ison with a Tone source builds the synth itself, one per mode", () => {
  const Tone = fakeTone();
  const whale = {
    format: "ison", version: "1.0", name: "Baleine",
    sources: { fm: { type: "FMSynth", options: { harmonicity: 1 } } },
    modes: { song: { source: "fm" }, nasal: { source: "fm", options: { modulationIndex: 16 } } },
  };
  const { node } = sound.create(whale, Tone, {});
  assert.equal(node.nodes.length, 2);
  assert.deepEqual(node.byMode.nasal.options, { harmonicity: 1, modulationIndex: 16 });
  node.triggerAttack("A4", 0, 0.5, 2, { variant: "nasal" });
  node.triggerRelease("A4", 2);
  assert.deepEqual(node.byMode.nasal.played, [["on", "A4", 0, 0.5], ["off", 2]], "a one-voice synth releases without the note's name");
  assert.deepEqual(node.byMode.song.played, []);
  node.triggerAttack("E3", 4, 0.5, 2);
  assert.equal(node.bend(52, 4, [{ time: 0, value: 0 }, { time: 1, value: 700 }, { time: 2, value: 0 }]), true);
  assert.deepEqual(node.byMode.song.detune.ramps, [["set", 0, 4], ["ramp", 700, 5], ["ramp", 0, 6], ["set", 0, 6.05]], "a bend goes through the synth's detune, in cents");
});

test("ison(base, changes) turns one setting without touching the rest, nor the base", () => {
  const changed = sound.ison(violin, { play: { bow: { gap: 0.05 } }, level: { db: -3 }, modes: { vibrato: { holds: 3 } } });
  assert.equal(changed.play.bow.gap, 0.05);
  assert.equal(changed.play.bow.max, 4, "a sibling setting stays");
  assert.equal(changed.play.vibrato.from, 2, "a sibling object stays");
  assert.deepEqual(changed.level, { db: -3, velocity: "sqrt" });
  assert.equal(changed.modes.vibrato.program, 11);
  assert.equal(changed.modes.vibrato.holds, 3);
  assert.equal(violin.play.bow.gap, 0.25, "the base is untouched");
  assert.equal(changed.sources, violin.sources, "what did not change is the same object");
});

test("only the modes a track's notes ask for are built", () => {
  const Tone = fakeTone();
  const whale = {
    format: "ison", version: "1.0", name: "Baleine",
    sources: { fm: { type: "FMSynth", options: { harmonicity: 1 } } },
    modes: { song: { source: "fm" }, nasal: { source: "fm" }, slow: { source: "fm" } },
  };
  const { node } = sound.create(whale, Tone, { notes: [{ pitch: 52, duration: 4, time: 0 }, { pitch: 52, duration: 4, time: 4, variant: "slow" }] });
  assert.deepEqual(Object.keys(node.byMode).sort(), ["slow", "song"]);
  assert.equal(sound.create(sound.ison(whale, { mode: "slow" }), Tone, { notes: [{ pitch: 52, duration: 4, time: 0 }] }).node.nodes.length, 1);
});

test("a one-voice Tone synth swells with the note's dynamics, through its volume", () => {
  const Tone = fakeTone();
  const whale = { format: "ison", version: "1.0", name: "w", sources: { fm: { type: "FMSynth" } } };
  const { node } = sound.create(whale, Tone, {});
  node.triggerAttack("E3", 2, 0.5, 4);
  assert.equal(sound.shapeVoices(node, 52, 2, [{ time: 0, value: 0.1 }, { time: 2, value: 1 }, { time: 4, value: 0.5 }], { seconds: 4 }), true);
  const synth = node.nodes[0];
  assert.deepEqual(synth.volume.ramps, [["set", -20, 2], ["ramp", 0, 4], ["ramp", -6, 6]]);
  assert.deepEqual(synth.played.at(-1), ["off", 6]);
});

test("performIson: with a grid, the strokes are cut on the piece's grid, every voice together", () => {
  const strings = sound.ison(violin, { play: { bow: { max: 4, gap: 0.1, change: 0.9, grid: 4 }, vibrato: undefined } });
  const played = sound.performIson(strings, [{ pitch: 69, duration: 10, time: 2, velocity: 0.5 }], { tempo: 60 });
  assert.deepEqual(played.map((s) => [s.time, Number(s.duration.toFixed(2)), Number(s.velocity.toFixed(2))]), [[2, 1.9, 0.5], [4, 3.9, 0.45], [8, 4, 0.45]], "cut at 4 and 8; the last stroke keeps its end");
  const whole = sound.performIson(strings, [{ pitch: 69, duration: 4, time: 24, velocity: 0.5, dynamics: [1, 0.5] }], { tempo: 60 });
  assert.equal(whole.length, 1, "a note that sits on the grid is one stroke");
  assert.deepEqual(whole[0].dynamics, [1, 0.5], "and keeps its own dynamics");
});

const ether = {
  format: "ison",
  version: "1.0",
  name: "Éther",
  sources: { low: { type: "FMSynth" }, high: { type: "FMSynth", options: { harmonicity: 3 } } },
  modes: {
    ether: { layers: [
      { mode: "body" },
      { mode: "light", transpose: 19, db: -12, delay: 0.5, spread: { cents: 10, delay: 0.2 } },
    ] },
    body: { source: "low", pan: -0.3 },
    light: { source: "high", pan: 0.4 },
  },
  controls: { shimmer: { cc: 20, mode: "light", default: 0.5 } },
};

test("performIson: a note in a mode of layers becomes one note per layer, the same on every play", () => {
  const notes = [{ pitch: 60, time: 4, duration: 8, velocity: 0.8 }];
  const once = sound.performIson(ether, notes, { tempo: 120 });
  assert.deepEqual(once.map((n) => n.variant), ["body", "light"]);
  const [body, light] = once;
  assert.equal(body.pitch, 60);
  assert.equal(body.time, 4);
  assert.equal(light.pitch, 79, "19 semitones up");
  assert.ok(light.time >= 5 && light.time <= 5.4, "0.5 s later (1 beat at 120), plus at most 0.2 s of spread");
  assert.ok(Math.abs(light.time + light.duration - 12) < 1e-9, "the layers end together");
  assert.ok(Math.abs(light.velocity - 0.8 * Math.pow(10, -12 / 20)) < 1e-9);
  assert.ok(Math.abs(light.tuning ?? 0) <= 0.1 + 1e-9, "within 10 cents");
  assert.deepEqual(sound.performIson(ether, notes, { tempo: 120 }), once, "the spread is the same on every play");
  const other = sound.performIson(ether, [{ pitch: 62, time: 4, duration: 8, velocity: 0.8 }], { tempo: 120 })[1];
  assert.notEqual(other.time - 4, light.time - 4, "another note, another spread");
});

test("performPiece layers an ison track even without play rules", () => {
  const piece = { tempo: 120, tracks: [{ label: "Ether", synth: ether, notes: [{ pitch: 60, time: 0, duration: 4 }] }] };
  assert.equal(sound.performPiece(piece).tracks[0].notes.length, 2);
});

test("a mode of layers builds no sound of its own; a control turns a mode's level; two layers on one pitch end apart", () => {
  const Tone = fakeTone();
  class Panner { constructor(pan) { this.pan = pan; } connect() { return this; } dispose() {} }
  Tone.Panner = Panner;
  Tone.now = () => 0;
  const notes = sound.performIson(ether, [{ pitch: 60, time: 0, duration: 4 }], { tempo: 120 });
  const { node } = sound.create(ether, Tone, { notes });
  assert.equal(node.nodes.length, 2, "body and light, not ether");
  assert.equal(node.levels.light.gain, 0.5, "the control's default");
  let ramped = null;
  node.levels.light.gain = { linearRampToValueAtTime: (v, t) => { ramped = [v, t]; } };
  node.controllerChange(20, 0.9, 1);
  assert.deepEqual(ramped, [0.9, 1.05]);
  // two layers on the same pitch: each release reaches its own node
  node.triggerAttack(60, 0, 0.8, 4, { variant: "body" });
  node.triggerAttack(60, 0.5, 0.8, 4, { variant: "light" });
  node.triggerRelease(60, 4);
  node.triggerRelease(60, 4.5);
  assert.deepEqual(node.byMode.body.played.at(-1), ["off", 4]);
  assert.deepEqual(node.byMode.light.played.at(-1), ["off", 4.5]);
});

test("a control that follows the velocity: each note turns it to its own velocity as it starts", () => {
  const Tone = fakeTone();
  Tone.now = () => 0;
  class Played extends Tone.FMSynth { controllerChange(cc, value, time) { (this.moves ??= []).push([cc, value, time]); } }
  Tone.Played = Played;
  const bowed = {
    format: "ison", version: "1.0", name: "Bowed",
    sources: { synth: { type: "Played" } },
    modes: { sustain: { source: "synth" } },
    controls: { dynamics: { cc: 1, default: 0.7, velocity: true }, brightness: { cc: 74, default: 0.5 } },
  };
  const { node } = sound.create(bowed, Tone, { notes: [] });
  node.triggerAttack(62, 1, 0.44, 2);
  node.triggerAttack(65, 3, 0.9, 1);
  assert.deepEqual(node.nodes[0].moves, [[1, 0.44, 1], [1, 0.9, 3]], "CC1 only, not the brightness, at each note's start");
});

test("a control the piece writes on a track is the piece's: the velocity stops turning it there", () => {
  const bowed = {
    format: "ison", version: "1.0", name: "Bowed",
    sources: { synth: { type: "Synth" } },
    modes: { sustain: { source: "synth" } },
    controls: { dynamics: { cc: 1, default: 0.7, velocity: true } },
  };
  const notes = [{ pitch: 62, time: 0, duration: 4, velocity: 0.5 }];
  const free = sound.performPiece({ tempo: 60, tracks: [{ label: "Violin", synth: bowed, notes }] });
  assert.equal(free.tracks?.[0].synth.controls.dynamics.velocity ?? true, true, "nothing written: the velocity drives it");
  const byName = sound.performPiece({ tempo: 60, automation: { tracks: { Violin: [{ target: "dynamics", anchorPoints: [{ time: 0, value: 0.2 }, { time: 4, value: 1 }] }] } }, tracks: [{ label: "Violin", synth: bowed, notes }] });
  assert.equal(byName.tracks[0].synth.controls.dynamics.velocity, false, "a lane by the control's name");
  const byCc = sound.performPiece({ tempo: 60, tracks: [{ label: "Violin", synth: bowed, notes: [{ ...notes[0], modulations: [{ type: "cc", controller: 1, value: 90, time: 0 }] }] }] });
  assert.equal(byCc.tracks[0].synth.controls.dynamics.velocity, false, "a note's own moves on CC1");
  const other = sound.performPiece({ tempo: 60, automation: { tracks: { Cello: [{ target: "dynamics", anchorPoints: [{ time: 0, value: 0.2 }] }] } }, tracks: [{ label: "Violin", synth: bowed, notes }] });
  assert.equal(other.tracks?.[0].synth.controls.dynamics.velocity ?? true, true, "another track's lane changes nothing here");
  assert.equal(bowed.controls.dynamics.velocity, true, "the instrument itself is untouched");
});

test("two notes together keep their own force: a sampler gets each note's velocity control with the note, not as a shared move", () => {
  const Tone = fakeTone();
  Tone.now = () => 0;
  class Sampled extends Tone.FMSynth {
    constructor(o) { super(o); this.isSfz = true; this.attacks = []; }
    triggerAttack(note, time, velocity, duration, options) { this.attacks.push([note, options?.controllers]); return this; }
    controllerChange(cc, value) { (this.moves ??= []).push([cc, value]); }
  }
  Tone.Sampled = Sampled;
  const bowed = {
    format: "ison", version: "1.0", name: "Bowed",
    sources: { synth: { type: "Sampled" } },
    modes: { sustain: { source: "synth" } },
    controls: { dynamics: { cc: 1, default: 0.7, velocity: true } },
  };
  const { node } = sound.create(bowed, Tone, { notes: [] });
  node.triggerAttack([74], 0, 1, 2);
  node.triggerAttack([81], 0, 0.55, 2);
  assert.deepEqual(node.nodes[0].attacks.map(([, c]) => c), [{ 1: 1 }, { 1: 0.55 }], "each note its own CC1");
  assert.equal(node.nodes[0].moves, undefined, "no shared move that would pull the other note along");
});
