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
