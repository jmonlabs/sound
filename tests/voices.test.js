/**
 * Tests for what happens to a sampled instrument's sounding voices: deciding
 * whether a recording can be looped, and editing the loop join so it neither
 * clicks nor pulses.
 *
 * Pure functions over a buffer, so no Tone.js and no browser.
 * Run with: node --test tests/voices.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

test("analyseSustain tells a sustaining sample from a decaying one", async () => {
  const { analyseSustain } = await import("../src/voices.js");

  const make = (envelope) => {
    const data = new Float32Array(8000);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.sin(i * 0.05) * envelope(i / data.length);
    }
    return { duration: 2, getChannelData: () => data };
  };

  assert.equal(analyseSustain(make(() => 1)).loops, true, "a flat organ tone loops");
  assert.equal(analyseSustain(make((t) => Math.exp(-6 * t))).loops, false, "a piano does not");
  assert.equal(analyseSustain(null), null, "and a missing buffer is not a crash");
});

test("the loop join is levelled and crossfaded before it is used", async () => {
  // Looping raw audio leaves two seams: a level step, because the recording
  // decays across the window, and a waveform step at the join. Landing on a
  // zero crossing removes the click but not the discontinuity in the
  // partials, so the buffer is edited once.
  const { analyseSustain, prepareLoopRegion } = await import("../src/voices.js");

  const length = 20000;
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    // Sustaining, but decaying across its length — which is what causes the step.
    data[i] = Math.sin(i * 0.05) * (1 - 0.7 * (i / length));
  }
  const buffer = { duration: 2, length, numberOfChannels: 1, getChannelData: () => data };

  const analysis = analyseSustain(buffer);
  assert.equal(analysis.loops, true);

  const rms = (from, to) => {
    let s = 0;
    for (let i = from; i < to; i++) s += data[i] * data[i];
    return Math.sqrt(s / (to - from));
  };
  const { startSample: s, endSample: e } = analysis;
  const measure = Math.round(length * 0.1);
  const stepBefore = Math.abs(data[e - 1] - data[s - 1]);
  const levelBefore = rms(s, s + measure) / rms(e - measure, e);

  assert.equal(prepareLoopRegion(buffer, analysis), true);

  // The crossfade closes the waveform step exactly: the signal arriving at
  // loopEnd is made equal to what precedes loopStart.
  // Measured on this signal: 1.6e-2 unfixed, 1.0e-2 with the gain ramp alone,
  // 5e-5 once the crossfade runs. The bound isolates the crossfade.
  assert.ok(stepBefore > 1e-3, `nothing to fix; step was already ${stepBefore}`);
  const stepAfter = Math.abs(data[e - 1] - data[s - 1]);
  assert.ok(stepAfter < 1e-3, `the join should be near-exact, got ${stepAfter.toExponential(2)}`);

  // And 4.15 dB unfixed, 2.35 dB with the crossfade alone, 0.30 dB once the
  // gain ramp levels the loop. Likewise isolates the ramp.
  const levelAfter = Math.abs(20 * Math.log10(rms(s, s + measure) / rms(e - measure, e)));
  assert.ok(Math.abs(20 * Math.log10(levelBefore)) > 2, "nothing to fix");
  assert.ok(levelAfter < 1, `loop should be level, got ${levelAfter.toFixed(2)} dB`);
});

test("the buffer is edited once, not on every note", async () => {
  const { analyseSustain, prepareLoopRegion } = await import("../src/voices.js");

  const length = 20000;
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) data[i] = Math.sin(i * 0.05) * (1 - 0.7 * (i / length));
  const buffer = { duration: 2, length, numberOfChannels: 1, getChannelData: () => data };

  const analysis = analyseSustain(buffer);
  prepareLoopRegion(buffer, analysis);
  const once = Float32Array.from(data);

  prepareLoopRegion(buffer, analysis);
  prepareLoopRegion(buffer, analysis);

  assert.deepEqual(Array.from(data), Array.from(once), "repeat calls must not re-blend");
});

test("a decaying sample is never edited", async () => {
  const { analyseSustain, prepareLoopRegion } = await import("../src/voices.js");

  const length = 20000;
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) data[i] = Math.sin(i * 0.05) * Math.exp(-6 * (i / length));
  const original = Float32Array.from(data);
  const buffer = { duration: 2, length, numberOfChannels: 1, getChannelData: () => data };

  assert.equal(prepareLoopRegion(buffer, analyseSustain(buffer)), false);
  assert.deepEqual(Array.from(data), Array.from(original), "a piano's recording is left alone");
});

/* --- the loudness of a held note ----------------------------------------- */

const fakeGain = () => {
  const calls = [];
  return {
    calls,
    cancelScheduledValues: (t) => calls.push(["cancel", t]),
    setValueAtTime: (v, t) => calls.push(["set", v, t]),
    linearRampToValueAtTime: (v, t) => calls.push(["ramp", +v.toFixed(6), +t.toFixed(6)]),
  };
};
// A voice records its stop in the same log as its gain, so the order shows.
const fakeSampler = (gain) => ({
  _activeSources: new Map([[60, [{ _gainNode: { gain }, stop: (t) => gain.calls.push(["stop", t]) }]]]),
});

test("a loudness curve replaces the voice's whole gain path", async () => {
  const { applyAmplitudeAnchorsToSampler } = await import("../src/voices.js");
  const gain = fakeGain();
  const reached = applyAmplitudeAnchorsToSampler(
    fakeSampler(gain), 60, 10,
    [{ time: 0, value: 0.2 }, { time: 1, value: 1 }, { time: 3, value: 0.6 }],
    { seconds: 4, velocity: 0.5, attack: 0.1, release: 0.8 },
  );
  assert.equal(reached, true);
  assert.deepEqual(gain.calls, [
    ["stop", 14],                   // let go at the end first: a later stop would cancel the curve
    ["cancel", 10],                 // Tone's attack and release are dropped
    ["set", 0, 10],
    ["ramp", 0.1, 10.1],            // the first anchor, no sooner than the attack
    ["ramp", 0.5, 11],
    ["ramp", 0.3, 13],
    ["ramp", 0.3, 14],              // held to the end of the note
    ["ramp", 0, 14.8],              // then released from where the curve is
  ]);
});

test("anchors past the note's end are cut at the end", async () => {
  const { applyAmplitudeAnchorsToSampler } = await import("../src/voices.js");
  const gain = fakeGain();
  applyAmplitudeAnchorsToSampler(
    fakeSampler(gain), 60, 0,
    [{ time: 0, value: 0 }, { time: 1, value: 1 }, { time: 5, value: 0 }],
    { seconds: 2, velocity: 1, release: 0.5 },
  );
  assert.deepEqual(gain.calls.slice(-3), [["ramp", 1, 1], ["ramp", 0.75, 2], ["ramp", 0, 2.5]],
    "the note ends where the curve is at that moment, a quarter of the way down");
});

test("shapeVoices takes the instrument's own attack and release", async () => {
  const { shapeVoices } = await import("../src/index.js");
  const gain = fakeGain();
  const node = { ...fakeSampler(gain), attack: 0.3, release: 1.5, toSeconds: (v) => v };
  assert.equal(shapeVoices(node, 60, 0, [{ time: 0, value: 1 }], { seconds: 2, velocity: 1 }), true);
  assert.deepEqual(gain.calls.slice(3), [["ramp", 1, 0.3], ["ramp", 1, 2], ["ramp", 0, 3.5]]);
  assert.equal(shapeVoices({}, 60, 0, [{ time: 0, value: 1 }], { seconds: 1 }), false,
    "an instrument that is not a Sampler is left alone");
});

test("a shaped voice is taken off the sounding list, as triggerRelease would", async () => {
  // Otherwise a later triggerRelease of the same pitch stops it again, and a
  // stop cancels every gain value scheduled after the attack: the curve.
  const { applyAmplitudeAnchorsToSampler } = await import("../src/voices.js");
  const gain = fakeGain();
  const synth = fakeSampler(gain);
  applyAmplitudeAnchorsToSampler(synth, 60, 0, [{ time: 0, value: 1 }], { seconds: 1 });
  assert.deepEqual(synth._activeSources.get(60), []);
  assert.equal(applyAmplitudeAnchorsToSampler(synth, 60, 0, [{ time: 0, value: 1 }], { seconds: 1 }), false,
    "and there is nothing left to shape");
});
