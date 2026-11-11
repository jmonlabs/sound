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
  <midi><cc number="1"><binding level="ui" type="control" parameter="VALUE" position="0" /></cc></midi>
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

// A preset in the manner of Zauberstrings: one recorded force, the others
// made by the mod wheel (a level on the recordings' tag, a peak filter on the
// group, a shorter attack), an expression knob on CC11, a loop crossfade.
const modelled = `<?xml version="1.0"?>
<DecentSampler>
  <midi>
    <cc number="1"><binding level="ui" type="control" parameter="VALUE" position="0" /></cc>
    <cc number="11"><binding level="ui" type="control" parameter="VALUE" position="1" /></cc>
  </midi>
  <groups volume="1" ampVelTrack="0">
    <group name="Sustain" enabled="false">
      <effects><effect type="peak" frequency="4000.0" q="0.5" gain="1.0" /></effects>
      <sample path="Files/D4-Long1.flac" tags="sustain,L1" rootNote="62" loNote="62" hiNote="63" loopEnabled="true" loopStart="44100" loopEnd="220500" loopCrossfade="12000" volume="1.0" />
    </group>
  </groups>
  <ui><tab>
    <labeled-knob label="Dynamic" minValue="0" maxValue="1" value="1">
      <binding type="amp" level="tag" identifier="L1" parameter="AMP_VOLUME" translation="table" translationTable="0,0.251; 1,1.0" />
      <binding type="effect" level="group" groupIndex="0" effectIndex="0" parameter="FX_GAIN" translation="linear" translationOutputMin="0.016" translationOutputMax="1.0" />
      <binding type="amp" level="group" groupIndex="0" parameter="ENV_ATTACK" modBehavior="add" translation="linear" translationOutputMin="0.1" translationOutputMax="0.0" />
    </labeled-knob>
    <labeled-knob label="Expression" minValue="0" maxValue="1" value="1">
      <binding level="group" position="0" type="amp" parameter="AMP_VOLUME" translation="linear" translationOutputMin="0.0" translationOutputMax="1.0" />
    </labeled-knob>
    <labeled-knob label="Attack" minValue="0" maxValue="2.5" value="0"><binding level="group" position="0" parameter="ENV_ATTACK" type="amp" /></labeled-knob>
    <labeled-knob label="Release" minValue="0" maxValue="2.5" value="0.65"><binding level="group" position="0" parameter="ENV_RELEASE" type="amp" /></labeled-knob>
  </tab></ui>
</DecentSampler>`;

test("a preset whose forces are made by the mod wheel: level, filter and attack follow CC1", () => {
  const { control, regions } = parseSfz(dspresetToSfz(modelled));
  assert.equal(regions.length, 1, "a preset with no group on at load plays all of them");
  const [r] = regions;
  assert.equal(control.set_cc1, 127, "the controllers start where the knobs do");
  assert.equal(control.set_cc11, 127);
  assert.equal(r.volume, undefined, "a bare volume is a factor: 1.0 is 0 dB");
  assert.equal(r.amp_veltrack, 0, "what <groups> says, every group inherits");
  assert.equal(r.amplitude_oncc1, 100, "the tag's level follows the wheel…");
  assert.ok(Array.isArray(r.amplitude_curvecc1) && Math.abs(r.amplitude_curvecc1[0] - 0.251) < 1e-3 && r.amplitude_curvecc1[127] === 1, "…from a quarter to full, on the table's curve");
  assert.equal(r.ampeg_attack, 0.1, "the attack knob (0) plus the wheel's lowest addition");
  assert.equal(r.ampeg_attack_oncc1, -0.1, "the wheel up, no attack at all");
  assert.equal(r.ampeg_release, 0.65);
  assert.deepEqual([r.xfin_locc11, r.xfin_hicc11], [0, 127], "expression on CC11");
  assert.equal(r.eq1_freq, 4000);
  assert.equal(r.eq1_bw, 2.543, "q 0.5, in octaves");
  assert.equal(r.eq1_gain, -35.918, "the filter's lowest gain (0.016), in dB");
  assert.equal(r.eq1_gain_oncc1, 35.918);
  assert.ok(Array.isArray(r.eq1_gain_curvecc1) && r.eq1_gain_curvecc1.length === 128, "on a curve: the preset turns a factor, not decibels");
  assert.ok(r.eq1_gain_curvecc1[64] > 0.8, "half way up the wheel, the filter has given back most of its cut");
  assert.equal(r.loop_crossfade, 0.272, "12000 frames at 44.1 kHz");
});

test("legato: a phrase's first note, a transition recorded from the previous note, and the notes it silences", () => {
  const legato = `<?xml version="1.0"?>
<DecentSampler>
  <groups volume="1" ampVelTrack="0">
    <group name="Start" trigger="first" silencedByTags="legato" silencingMode="normal" enabled="false">
      <sample path="D4.flac" tags="sustain" rootNote="62" loNote="62" hiNote="63" />
    </group>
    <group name="Transition" trigger="legato" attack="0.3" decay="0.7" sustain="0" volume="0.35" start="1500" enabled="false">
      <sample path="legato_C4_D4.flac" tags="legato,legato_transition" rootNote="62" loNote="62" hiNote="62" loCC1="0" hiCC1="127" previousNotes="60" />
    </group>
    <group name="Sustain" trigger="legato" attack="2.5" silencedByTags="legato" silencingMode="normal" enabled="false">
      <sample path="D4.flac" tags="legato-sustain" rootNote="62" loNote="62" hiNote="63" start="22050" />
    </group>
  </groups>
</DecentSampler>`;
  const [start, transition, sustain] = parseSfz(dspresetToSfz(legato)).regions;
  assert.equal(start.trigger, "first");
  assert.deepEqual([start.off_by, start.off_mode], [1, "normal"], "a transition starting lets the first note go, through its release");
  assert.equal(transition.trigger, "legato");
  assert.equal(transition.sw_previous, 60, "the transition from do4");
  assert.equal(transition.group, 1, "the recordings tagged legato are the choke group");
  assert.equal(transition.offset, 1500, "the group's start");
  assert.equal(transition.volume, -9.119, "0.35 as a factor");
  assert.deepEqual([transition.locc1, transition.hicc1], [0, 127]);
  assert.equal(sustain.off_by, 1);
  assert.equal(sustain.offset, 22050);
});
