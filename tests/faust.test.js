/**
 * Faust instruments: how a track's notes, bends, loudness curves and
 * controller moves reach the DSP. faustwasm is replaced by a recorder
 * (tests/fixtures/fake-faustwasm.js), and Tone by the few pieces the
 * instrument uses. The sound itself was checked in a browser.
 *
 * Run with: node --test tests/faust.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

const library = new URL("./fixtures/fake-faustwasm.js", import.meta.url).href;
// The recorder, once the instrument has loaded it: loading it here first would hide how it was loaded.
const fake = () => import(library);

const dsp = {
  "voice.dsp": 'import("stdfaust.lib");',
  "other.dsp": 'import("stdfaust.lib");',
  "chords.dsp": 'declare options "[nvoices:4]";',
  "room.dsp": 'declare options "[nvoices:4]";\nprocess = _;\neffect = re.mono_freeverb(0.5, 0.5, 0.5, 0);',
  "broken.dsp": "a mistake",
};
const fetched = [];
globalThis.fetch = async (url) => {
  fetched.push(url);
  return url in dsp ? { ok: true, text: async () => dsp[url] } : { ok: false, status: 404 };
};

class ToneWorkletNode {}

const fakeTone = () => {
  const context = {
    currentTime: 0,
    rawContext: { audioWorklet: { addModule: async () => {} } },
    createAudioWorkletNode: () => new ToneWorkletNode(),
  };
  class Gain {
    constructor(gain) { this.gain = gain; }
    connect() { return this; }
    dispose() { this.disposed = true; }
  }
  const names = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const midiOfName = (name) => (Number(name.slice(-1)) + 1) * 12 + names[name[0]] + (name[1] === "#" ? 1 : 0);
  const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
  const Frequency = (note, unit) => {
    const value = typeof note === "number" ? (unit === "midi" ? hz(note) : note) : hz(midiOfName(note));
    return { toFrequency: () => value, toMidi: () => 69 + 12 * Math.log2(value / 440) };
  };
  return {
    getContext: () => context,
    Gain,
    Frequency,
    Time: (t) => ({ toSeconds: () => Number(t) }),
    Sampler: class {},
    dbToGain: (db) => 10 ** (db / 20),
    connect: () => {},
  };
};

const sound = await import("../src/index.js");
sound.useFaust({ library });

/** A track's instrument, loaded, with its node. */
async function instrument(spec) {
  const { node } = sound.create(spec, fakeTone());
  await node.loaded;
  return node;
}

/** What one control of a voice was told, in order. */
const events = (instrument, control, voice = 0) => instrument.voices[voice].param(control).events;

test("a { faust } track reads as a Faust instrument and needs no samples", async () => {
  assert.deepEqual(sound.readSpec({ faust: "voice.dsp", params: { bright: 0.7 }, volume: -6 }), {
    kind: "faust", faust: "voice.dsp", params: { bright: 0.7 }, voices: undefined, volume: -6,
  });
  assert.equal(await sound.prepare([{ faust: "voice.dsp" }, { type: "Synth" }]), null, "no request for a sample source");
});

test("faustwasm is loaded with Tone's AudioWorkletNode in place, and the browser's is put back", async () => {
  const before = globalThis.AudioWorkletNode;
  await instrument({ faust: "voice.dsp" });
  assert.equal((await fake()).loadedWith, ToneWorkletNode, "its nodes then join Tone's graph");
  assert.equal(globalThis.AudioWorkletNode, before);
});

test("a .dsp is compiled once, however many tracks play it; its params start where the spec says", async () => {
  const a = await instrument({ faust: "other.dsp", params: { bright: 0.7 } });
  await instrument({ faust: "other.dsp" });
  assert.equal((await fake()).compiles.other, 1);
  assert.deepEqual(a.voices[0].node.sent, [["param", "/other/bright", 0.7, undefined]]);
  assert.equal(a.poly, false);
});

test("a .dsp that does not compile says so when the track loads", async () => {
  const { node } = sound.create({ faust: "broken.dsp" }, fakeTone());
  await assert.rejects(node.loaded, /syntax error/);
  const missing = sound.create({ faust: "nowhere.dsp" }, fakeTone()).node;
  await assert.rejects(missing.loaded, /nowhere\.dsp \(404\)/);
});

test("a note sets freq, gain and gate at its time; a note that touches the last one starts again", async () => {
  const voice = await instrument({ faust: "voice.dsp" });
  voice.triggerAttack("A4", 1, 0.8, 1);
  voice.triggerRelease("A4", 2);
  voice.triggerAttack("A5", 2, 0.5, 1);
  assert.deepEqual(events(voice, "freq"), [["cancel", 1], ["set", 440, 1], ["cancel", 2], ["set", 880, 2]]);
  assert.deepEqual(events(voice, "gain"), [["cancel", 1], ["set", 0.8, 1], ["cancel", 2], ["set", 0.5, 2]]);
  assert.deepEqual(events(voice, "gate"), [
    ["cancel", 1], ["set", 1, 1],
    ["set", 0, 2], // the first note's release
    ["cancel", 2], ["set", 0, 2], ["set", 1, 2.003], // the gate dips, the second note starts again
  ]);
});

test("a note that overlaps the last one is tied: the gate stays up", async () => {
  const voice = await instrument({ faust: "voice.dsp" });
  voice.triggerAttack("C4", 0, 1, 2);
  voice.triggerRelease("C4", 2);
  voice.triggerAttack("G4", 1.5, 1, 1);
  voice.triggerRelease("G4", 2.5);
  assert.deepEqual(events(voice, "gate"), [
    ["cancel", 0], ["set", 1, 0],
    ["set", 0, 2],
    ["cancel", 1.5], ["set", 1, 1.5], // the release at 2 is dropped
    ["set", 0, 2.5],
  ]);
});

test("a bend glides freq, a straight line in pitch; a loudness curve moves gain and ends the note", async () => {
  const voice = await instrument({ faust: "voice.dsp" });
  voice.triggerAttack("A3", 0, 0.5, 2);
  assert.equal(sound.handlesVoices(voice), true);
  assert.equal(sound.holdVoices(voice, 57, 0, 2), false, "nothing to loop");
  assert.equal(sound.bendVoices(voice, 57, 0, [{ time: 0, value: 0 }, { time: 2, value: 1200 }]), true);
  assert.deepEqual(events(voice, "freq").slice(-2), [["set", 220, 0], ["exponential", 440, 2]]);
  assert.equal(sound.shapeVoices(voice, 57, 0, [{ time: 0, value: 0.2 }, { time: 1, value: 1 }], { seconds: 2, velocity: 0.5 }), true);
  assert.deepEqual(events(voice, "gain").slice(-2), [["set", 0.1, 0], ["linear", 0.5, 1]]);
  assert.deepEqual(events(voice, "gate").at(-1), ["set", 0, 2]);
});

test("controller moves and pitch bends reach the DSP's [midi:...] controls at their time", async () => {
  const voice = await instrument({ faust: "voice.dsp" });
  voice.controllerChange(74, 0.9, 8);
  voice.pitchBend(-1, 9);
  voice.pitchBend(1, 10);
  assert.deepEqual(voice.voices[0].node.sent, [["cc", 0, 74, 114, 8], ["wheel", 0, 0, 9], ["wheel", 0, 16383, 10]]);
});

test("a polyphonic DSP has a voice per note, each its own pitch, bend and loudness", async () => {
  const chords = await instrument({ faust: "chords.dsp", voices: 6 });
  assert.equal(chords.poly, true);
  assert.equal(chords.voices.length, 6, "the spec's voices over the DSP's");
  chords.triggerAttackRelease(["C4", "E4"], 1, 3, 0.5);
  chords.triggerAttack(270, 3.5, 0.5, 1); // between C#4 and D4, as the player sends a tuned note
  assert.deepEqual(events(chords, "freq", 0).at(-1), ["set", 261.6255653005986, 3]);
  assert.deepEqual(events(chords, "freq", 1).at(-1), ["set", 329.6275569128699, 3]);
  assert.deepEqual(events(chords, "freq", 2).at(-1), ["set", 270, 3.5], "the exact pitch, not the nearest key");
  assert.deepEqual(events(chords, "gate", 1), [["cancel", 3], ["set", 1, 3], ["set", 0, 4]]);
  assert.equal(sound.bendVoices(chords, 64, 3, [{ time: 0, value: 0 }, { time: 1, value: 100 }]), true);
  assert.deepEqual(events(chords, "freq", 1).slice(-2), [["set", 329.6275569128699, 3], ["exponential", 349.2282314330039, 4]]);
  assert.equal(events(chords, "freq", 0).length, 2, "the other note does not move");
  assert.equal(sound.shapeVoices(chords, 60, 3, [{ time: 0, value: 1 }, { time: 1, value: 0 }], { seconds: 1, velocity: 0.5 }), true);
  assert.deepEqual(events(chords, "gain", 0).slice(-2), [["set", 0.5, 3], ["linear", 0, 4]]);
  assert.equal(events(chords, "gain", 1).length, 2, "the other note keeps its loudness");
});

test("with every voice busy, a note takes the one that has sounded the longest, and starts it again", async () => {
  const chords = await instrument({ faust: "chords.dsp", voices: 2 });
  chords.triggerAttackRelease("C4", 2, 0);
  chords.triggerAttackRelease("E4", 3, 0.5);
  chords.triggerAttackRelease("G4", 1, 1);
  assert.equal(chords.voices[0].key, 67, "the C, which ends first, gives way");
  assert.deepEqual(events(chords, "gate", 0).slice(-3), [["set", 0, 1], ["set", 1, 1.003], ["set", 0, 2]]);
  chords.triggerAttackRelease("A4", 1, 4);
  assert.deepEqual(events(chords, "gate", 0).slice(-2), [["set", 1, 4], ["set", 0, 5]], "free again by then: no dip");
});

test("a polyphonic DSP's effect is played once, after the voices; controls go where they exist", async () => {
  const room = await instrument({ faust: "room.dsp", params: { bright: 0.7, room: 0.3 } });
  assert.equal((await fake()).compiles.room_effect, 1);
  assert.ok(room.effect);
  assert.equal(room.voices.length, 4);
  assert.deepEqual(room.voices[0].node.sent, [["param", "/room/bright", 0.7, undefined]]);
  assert.deepEqual(room.effect.sent, [["param", "/room_effect/room", 0.3, undefined]]);
  room.controllerChange(1, 1, 2);
  assert.equal(room.nodes.filter((n) => n.sent.some((m) => m[0] === "cc")).length, 5, "every voice and the effect");
});

test("a track's voices make a monophonic DSP polyphonic", async () => {
  const doubleStops = await instrument({ faust: "voice.dsp", voices: 2 });
  assert.equal(doubleStops.poly, true);
  doubleStops.triggerAttackRelease(["D4", "A4"], 1, 0);
  assert.deepEqual(doubleStops.voices.map((v) => v.key), [62, 69]);
});

test("which voice a note takes, and whether a DSP has an effect", async () => {
  const { pickVoice, definesEffect } = await import("../src/faust.js");
  const free = { end: 1 }, freedLater = { end: 2 }, busy = { end: 9 };
  assert.equal(pickVoice([busy, freedLater, free]), free);
  assert.equal(pickVoice([{ end: -Infinity }, free]).end, -Infinity, "one never used");
  assert.equal(definesEffect("process = _;\neffect = dm.zita_light;"), true);
  assert.equal(definesEffect("process = _;\n// effect = dm.zita_light;"), false);
  assert.equal(definesEffect("process = _ : sideeffect;"), false);
});

test("the voices a DSP declares are read from its options", async () => {
  const { declaredVoices } = await import("../src/faust.js");
  assert.equal(declaredVoices({ meta: [{ options: "[midi:on][nvoices:8]" }] }), 8);
  assert.equal(declaredVoices({ meta: [{ name: "voice" }] }), 0);
});
