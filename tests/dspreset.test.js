/**
 * A Decent Sampler preset read as SFZ, in memory (dspreset.js).
 *
 * Run with: deno test -A tests/dspreset.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { dspresetToSfz } from "../src/dspreset.js";
import { parseSfz } from "../src/sfz-parse.js";
import { readSpec } from "../src/index.js";

const preset = `<?xml version="1.0"?>
<DecentSampler>
  <ui><tab><labeled-knob>
    <binding type="amp" level="group" position="0" parameter="AMP_VOLUME" translation="table" translationTable="0,1;0.1,1;0.4,0;1,0" />
    <binding type="amp" level="group" position="1" parameter="AMP_VOLUME" translation="table" translationTable="0,0;0.2,1;1,1" />
  </labeled-knob>
  <labeled-knob label="attack" value="1.2"><binding type="amp" level="instrument" position="2" parameter="ENV_ATTACK" /></labeled-knob>
  <labeled-knob label="release" value="1.75"><binding type="amp" level="instrument" position="2" parameter="ENV_RELEASE" /></labeled-knob>
  </tab></ui>
  <groups>
    <group name="Soft" volume="6dB" ampVelTrack="0">
      <sample path="Samples/soft C3.wav" rootNote="48" loNote="40" hiNote="52" start="100" end="9000" loopEnabled="true" loopStart="200" loopEnd="9000" pan="-18" />
    </group>
    <group name="Loud" volume="0dB" attack="0.5" release="2" seqMode="random" seqLength="2">
      <sample path="Samples/loud C3 a.wav" rootNote="48" loNote="40" hiNote="52" seqPosition="1" />
      <sample path="Samples/loud C3 b.wav" rootNote="48" loNote="40" hiNote="52" seqPosition="2" />
    </group>
    <group name="Warp" enabled="false">
      <sample path="Samples/warp C3.wav" rootNote="48" />
      <sample path="Samples/Silence_C4.wav" rootNote="60" />
    </group>
  </groups>
</DecentSampler>`;

test("a preset's groups on at load, crossfaded at the mod wheel as its knob did", () => {
  const { regions } = parseSfz(dspresetToSfz(preset));
  assert.equal(regions.length, 3, "Soft, then Loud's two takes; Warp is off");
  const [soft, a, b] = regions;
  assert.equal(soft.sample, "Samples/soft C3.wav");
  assert.equal(soft.pitch_keycenter, 48);
  assert.equal(soft.lokey, 40);
  assert.equal(soft.offset, 100);
  assert.equal(soft.loop_start, 200);
  assert.equal(soft.volume, 6);
  assert.equal(soft.xfout_locc1, 13, "Soft fades out from 0.1…");
  assert.equal(soft.xfout_hicc1, 51, "…to 0.4 of the wheel");
  assert.equal(a.xfin_locc1, 0);
  assert.equal(a.xfin_hicc1, 25, "Loud fades in up to 0.2");
  assert.equal(soft.ampeg_attack, 1.2, "the attack knob at load, for a group that says nothing");
  assert.equal(soft.ampeg_release, 1.75);
  assert.equal(a.ampeg_attack, 0.5, "a group's own attack wins");
  assert.equal(a.ampeg_release, 2);
  assert.deepEqual([a.lorand, a.hirand, b.lorand, b.hirand], [0, 0.5, 0.5, 1], "random takes share the dice");
});

test("a group chosen by name plays alone, and a silence placeholder is left out", () => {
  const { regions } = parseSfz(dspresetToSfz(preset, { group: "Warp" }));
  assert.deepEqual(regions.map((r) => r.sample), ["Samples/warp C3.wav"]);
  assert.throws(() => dspresetToSfz(preset, { group: "Soma" }), /no group named "Soma"/);
});

test("a track's synth may name a preset, and a group of it", () => {
  const spec = readSpec({ dspreset: "/lib/Strings.dspreset", group: "Warp" });
  assert.equal(spec.kind, "sfz");
  assert.equal(spec.sfz, "/lib/Strings.dspreset");
  assert.equal(spec.group, "Warp");
});
