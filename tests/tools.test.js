/**
 * The measures of tools/ (measure.js, inspect.js), on sounds whose answer is known.
 *
 * Run with: node --test tests/tools.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { RATE, medianPitch, speechOf, vibratoOf } from "../tools/measure.js";
import { layoutOf, summary } from "../tools/inspect.js";

const tone = ({ hz = 440, cents = 0, vibrato = 0, rate = 5.5, seconds = 3, rise = 0.05 }) => {
  const x = new Float32Array(Math.round(seconds * RATE));
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE;
    const f = hz * 2 ** ((cents + vibrato * Math.sin(2 * Math.PI * rate * t)) / 1200);
    phase += (2 * Math.PI * f) / RATE;
    x[i] = Math.min(1, t / rise) * 0.5 * (Math.sin(phase) + 0.3 * Math.sin(2 * phase));
  }
  return x;
};

test("a recording 12 cents sharp is measured 12 cents sharp", () => {
  const { cents, clarity } = medianPitch(tone({ cents: 12 }), 440);
  assert.ok(Math.abs(cents - 12) < 1.5, `measured ${cents}`);
  assert.ok(clarity > 0.9);
});

test("a recorded vibrato: how wide and how fast; a straight note has none", () => {
  const vibrato = vibratoOf(tone({ vibrato: 12, rate: 5.5 }), 440);
  assert.ok(Math.abs(vibrato.depth - 12) <= 3, `depth ${vibrato.depth}`);
  assert.ok(Math.abs(vibrato.rate - 5.5) <= 0.6, `rate ${vibrato.rate}`);
  assert.ok(vibratoOf(tone({}), 440).depth <= 1, "straight");
});

test("speech: from the first sound to half its level", () => {
  const slow = speechOf(tone({ rise: 0.4 })), quick = speechOf(tone({ rise: 0.02 }));
  assert.ok(slow > 150 && slow < 250, `slow ${slow}`);
  assert.ok(quick <= 20, `quick ${quick}`);
});

test("the layout of an instrument, from its regions: forces by velocity or by the wheel, takes, legato", () => {
  const regions = [
    ...[1, 2, 3, 4].map((k) => ({ sample: `soft${k}.wav`, lokey: 60, hikey: 61, hivel: 64, seq_length: 4, seq_position: k })),
    ...[1, 2, 3, 4].map((k) => ({ sample: `loud${k}.wav`, lokey: 60, hikey: 61, lovel: 65, seq_length: 4, seq_position: k })),
    { sample: "legato.wav", lokey: 61, hikey: 61, trigger: "legato", sw_previous: 60 },
    { sample: "release.wav", lokey: 60, hikey: 61, trigger: "release" },
  ];
  const layout = layoutOf(regions);
  assert.equal(layout.velocityLayers, 2);
  assert.equal(layout.takes, 4);
  assert.equal(layout.legato, true);
  assert.equal(layout.releaseSounds, true);
  const wheel = layoutOf([
    { sample: "p.wav", lokey: 60, hikey: 60, xfout_locc1: 20, xfout_hicc1: 60 },
    { sample: "mf.wav", lokey: 60, hikey: 60, xfin_locc1: 20, xfin_hicc1: 60, xfout_locc1: 60, xfout_hicc1: 100 },
    { sample: "f.wav", lokey: 60, hikey: 60, xfin_locc1: 60, xfin_hicc1: 100 },
  ]);
  assert.equal(wheel.wheelLayers, 3, "three forces faded by the wheel");
  assert.equal(wheel.takes, 1, "not three takes");
  assert.match(summary({ ...wheel, vibrato: false, speech: [60, 90], tuning: [-3, 12], measured: 3 }), /pas de vibrato enregistré, 3 forces \(à la molette\)/);
});
