/**
 * jmon/sound — sampled instruments for jmon/algo.
 *
 * `jmon/algo` composes and schedules; this plays the result with real
 * instrument samples. It is injected the same way Tone.js and Verovio are:
 *
 *     import jm from "https://cdn.jsdelivr.net/gh/jmonlabs/algo@main/src/index.js";
 *     import sound from "https://cdn.jsdelivr.net/gh/jmonlabs/sound@main/src/index.js";
 *     import * as Tone from "npm:tone";
 *
 *     jm.play(piece, { Tone, sound });
 *
 * Without it, `jm.play` still works — a track asking for a General MIDI
 * program falls back to a synth. What this adds is the sampled instrument and
 * the two things a soundfont engine does with one: bending a note by
 * resampling rather than substituting, and holding a note past the end of the
 * recording by looping its sustain.
 *
 * ESM source, served from GitHub via jsDelivr. No build step, no npm package,
 * and no dependency of its own — Tone is passed in by the caller.
 *
 * @license GPL-3.0-or-later
 */

import {
  BANKS,
  CDN_ROOTS,
  CDN_SOURCES,
  GM_INSTRUMENTS,
  GM_SAMPLE_SECONDS,
  createGMInstrumentNode,
  defaultEnvelope,
  findGMProgramByName,
  generateCompleteSamplerUrls,
  generateSamplerUrls,
  getPopularInstruments,
  getSamplingStrategy,
  getSoundfontBank,
  getSoundfontBase,
  getSoundfontFormat,
  getSoundfontSources,
  gmMaxBeats,
  resolveSoundfontBase,
  setSamplingStrategy,
  setSoundfontBank,
  setSoundfontBase,
  setSoundfontFormat,
  setSoundfontSources,
} from "./gm.js";

import {
  DRUM_BANK_KITS,
  drumKits,
  drumSampleUrls,
  getDrumSamples,
  GM_DRUM_KITS,
  setDrumSamples,
  getDrumBank,
  getDrumKit,
  parseDrumKitSpec,
  registerDrumKit,
  setDrumBank,
  setDrumKitSource,
} from "./drumkits.js";

import {
  createSoundfontInstrument,
  defaultSoundfontAttack,
  soundfontInUse,
  useSoundfont,
} from "./soundfont.js";

import { createSfzInstrument } from "./sfz.js";
import { createFaustInstrument, useFaust } from "./faust.js";
import { createIsonInstrument, hasLayers, ison, isIsonSpec, performIson } from "./ison.js";
export { dspresetToSfz, dspresetGroups } from "./dspreset.js";

import {
  analyseSustain,
  applyAmplitudeAnchorsToSampler,
  applyPitchAnchorsToSampler,
  canResample,
  prepareLoopRegion,
  prepareSamplerLoops,
  sustainSampledNote,
} from "./voices.js";

export const VERSION = "1.4.0";

/** MIDI note number to the note name Tone's Sampler keys its urls by. */
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function midiToNoteName(midi) {
  const rounded = Math.round(Number(midi));
  return `${NOTE_NAMES[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
}

/**
 * Read a track's `synth` spec and say what sampled instrument it asks for.
 *
 * Recognised: a General MIDI program number, `{ gm }` or `{ program }` with
 * the sampling options beside it, a drum kit name, `{ sfz }`, an SFZ
 * instrument (see sfz.js), `{ sf2, program, bankSelect, variants }`, a program of a
 * SoundFont bank (see soundfont.js), and `{ faust }`, a Faust instrument (see
 * faust.js). Anything else — a Tone
 * class name, an inline `{ type, options }` — is not this package's business,
 * so it returns `null` and the caller builds it itself.
 *
 * @param {*} spec - A track's `synth`, after any preset has been expanded
 * @returns {{kind: 'gm'|'drums'|'drumkit'|'sfz'|'sf2'|'faust', ...}|null}
 */
export function readSpec(spec) {
  if (typeof spec === "number") return { kind: "gm", program: spec };

  // `"drums"`, or `{ drums: 32 }` for another General MIDI kit: the drums as
  // samples (see GM_DRUM_KITS).
  if (spec === "drums") return { kind: "drums", program: 0 };
  if (spec && typeof spec === "object" && typeof spec.drums === "number") {
    return { kind: "drums", program: spec.drums, options: spec.options };
  }

  if (typeof spec === "string") {
    const kit = parseDrumKitSpec(spec);
    if (kit) warnRenamed(spec);
    return kit ? { kind: "drumkit", ...kit } : null;
  }

  if (spec && typeof spec === "object") {
    // An ison: an instrument said in JSON (see ison.js).
    if (isIsonSpec(spec)) return { kind: "ison", ison: spec };

    // A Decent Sampler preset is played as SFZ, read on the way (see dspreset.js).
    if (typeof spec.sfz === "string" || typeof spec.dspreset === "string") {
      return {
        kind: "sfz",
        sfz: spec.sfz ?? spec.dspreset,
        ...(spec.group !== undefined ? { group: spec.group } : {}),
        ...(spec.tuning !== undefined ? { tuning: spec.tuning } : {}),
        ...(spec.ampVeltrack !== undefined ? { ampVeltrack: spec.ampVeltrack } : {}),
        staccato: spec.staccato,
        staccatoUnder: spec.staccatoUnder,
        envelope: spec.envelope,
        volume: spec.volume,
        controllers: spec.controllers,
        start: spec.start,
      };
    }

    if (typeof spec.faust === "string") {
      return {
        kind: "faust",
        faust: spec.faust,
        params: spec.params,
        voices: spec.voices,
        volume: spec.volume,
      };
    }
    if (typeof spec.sf2 === "string") {
      return {
        kind: "sf2",
        bank: spec.sf2,
        program: spec.program ?? 0,
        bankSelect: spec.bankSelect ?? 0,
        controllers: spec.controllers,
        variants: spec.variants,
        start: spec.start,
      };
    }

    // `{ kit: "name" }` is the object form of `"drumkit:name"`, so a sample
    // set can carry options the string form has no room for. Any registered
    // kit works, not only drums: one file per key is also how you play a set
    // of spoken phrases, field recordings, or anything else one-shot.
    const kitName = spec.kit ?? spec.drumkit;
    if (typeof spec.drumkit === "string") warnRenamed(`drumkit:${spec.drumkit}`);
    if (typeof kitName === "string") {
      return { kind: "drumkit", ...parseDrumKitSpec(`drumkit:${kitName}`), options: spec.options };
    }

    const program = typeof spec.gm === "number"
      ? spec.gm
      : (typeof spec.program === "number" ? spec.program : null);
    if (program === null) return null;
    return {
      kind: "gm",
      program,
      strategy: spec.strategy,
      noteRange: spec.noteRange,
      // A per-track bank resolves to a base URL here, so nothing downstream
      // has to know banks exist. An explicit baseUrl still wins.
      baseUrl: spec.baseUrl || (spec.bank ? bankBase(spec.bank) : undefined),
      options: spec.options,
      soundfont: spec.soundfont,
      controllers: spec.controllers,
    };
  }

  return null;
}

const renamedWarned = new Set();

/**
 * "drumkit…" still plays, but once per name it says what to write instead: the
 * drums for a General MIDI kit, the object form for a kit registered by hand.
 */
function warnRenamed(name) {
  if (renamedWarned.has(name)) return;
  renamedWarned.add(name);
  const kit = name.startsWith("drumkit:") ? name.slice("drumkit:".length) : null;
  const custom = kit && drumKits[kit] && kit !== "acoustic" && kit !== "r8";
  console.warn(custom
    ? `synth "${name}" is the old name. Write { kit: "${kit}" }.`
    : `synth "${name}" is the old name. Write "drums" for the General MIDI drums (every drum, as samples), or { drums: <kit number> } for another kit (32 jazz, 40 brush…).`);
}

/**
 * The base URL for a named bank, on the source currently in use — so a
 * per-track bank follows whichever source answered the probe, including one
 * set with setSoundfontSources (a local copy, a mirror).
 */
function bankBase(bank) {
  if (!BANKS.includes(bank)) {
    console.warn(`Unknown sample bank "${bank}". Using ${getSoundfontBank()}.`);
    return undefined;
  }
  const sources = getSoundfontSources();
  const root = sources.find((r) => getSoundfontBase().startsWith(r)) || sources[0];
  return `${root}/${bank}`;
}

/**
 * Build the instrument a spec asks for.
 *
 * @param {*} spec - A track's `synth`, after preset expansion
 * @param {Object} Tone - The Tone.js namespace
 * @param {Object} [track] - What the instrument will play
 * @param {Array<Object>} [track.notes] - The track's notes: an SFZ instrument
 *   then loads only the recordings they can sound
 * @returns {{node: Object, isLoadable: boolean}|null} `null` when the spec is
 *   not for a sampled instrument, which tells the caller to build it itself
 */
export function create(spec, Tone, { notes } = {}) {
  const asked = readSpec(spec);
  if (!asked || !Tone?.Sampler) return null;

  if (asked.kind === "sf2") {
    const { kind, ...preset } = asked;
    const node = createSoundfontInstrument(Tone, preset);
    return node ? { node, isLoadable: true } : null;
  }

  if (asked.kind === "ison") {
    const node = createIsonInstrument(Tone, asked.ison, { create, hooks: { shapeVoices, bendVoices, holdVoices }, notes });
    return { node, isLoadable: true };
  }

  if (asked.kind === "drums") {
    // A drum is a one-shot: a long release lets it ring out past a short note.
    const node = new Tone.Sampler({ urls: drumSampleUrls(asked.program, midiToNoteName), baseUrl: "", release: 4, ...(asked.options || {}) });
    return { node, isLoadable: true };
  }

  if (asked.kind === "sfz") {
    const { kind, ...options } = asked;
    return { node: createSfzInstrument(Tone, { ...options, notes }), isLoadable: true };
  }
  if (asked.kind === "faust") {
    const { kind, ...options } = asked;
    return { node: createFaustInstrument(Tone, options), isLoadable: true };
  }

  if (asked.kind === "gm") {
    // With a SoundFont bank in use, the bank plays it (see soundfont.js),
    // unless the track says `soundfont: false` or no channel is left.
    if (soundfontInUse() && asked.soundfont !== false) {
      const node = createSoundfontInstrument(Tone, { program: asked.program, controllers: asked.controllers });
      if (node) return { node, isLoadable: true };
    }
    const urls = generateSamplerUrls(
      asked.program,
      asked.baseUrl,
      asked.noteRange,
      asked.strategy,
    );
    const options = asked.options || {};
    // The loop joins are smoothed as soon as the recordings load: an edit
    // made once a note has started is not heard (see prepareSamplerLoops).
    const node = new Tone.Sampler({
      urls,
      baseUrl: "",
      ...defaultEnvelope(asked.program),
      ...options,
      onload: () => {
        prepareSamplerLoops(node);
        options.onload?.();
      },
    });
    return { node, isLoadable: true };
  }

  // A kit of the drum bank (see drumkits.js): the bank's engine plays it.
  if (asked.program !== undefined) {
    const node = createSoundfontInstrument(Tone, { bank: getDrumBank(), program: asked.program, drums: true });
    return node ? { node, isLoadable: true } : null;
  }

  if (!asked.kit) {
    console.warn(`Unknown drumkit "${asked.name}". Known: ${["drumkit", ...Object.keys(DRUM_BANK_KITS).map((k) => `drumkit:${k}`), ...Object.keys(drumKits).map((k) => `drumkit:${k}`)].join(", ")}`);
    return null;
  }
  const urls = {};
  for (const [midi, file] of Object.entries(asked.kit.samples)) {
    urls[midiToNoteName(parseInt(midi, 10))] = file;
  }
  return {
    node: new Tone.Sampler({ urls, baseUrl: asked.kit.baseUrl, ...(asked.options || {}) }),
    isLoadable: true,
  };
}

/**
 * Settle where samples come from, before any instrument is built.
 *
 * Costs one request, and only when something actually needs samples — a piece
 * of pure Tone synths should not pay for it. Never rejects: a failed probe
 * keeps the primary source.
 *
 * @param {Array<*>} specs - Every track's `synth`, after preset expansion
 * @returns {Promise<string|null>} The chosen base URL, or null if none was needed
 */
export async function prepare(specs) {
  // A Faust instrument needs no samples.
  const needsSamples = (spec) => {
    const asked = readSpec(spec);
    return asked !== null && asked.kind !== "faust";
  };
  if (!(specs || []).some(needsSamples)) return null;
  try {
    return await resolveSoundfontBase();
  } catch {
    return null;
  }
}

/**
 * Bend a sounding note by resampling, so it keeps the instrument's timbre.
 *
 * @param {Object} node - The instrument, as returned by {@link create}
 * @param {number} midi - The note's MIDI number
 * @param {number} startTime - Absolute time in seconds of the note start
 * @param {Array<{time: number, value: number}>} anchors - Time relative to
 *   `startTime`, value in cents relative to the written pitch
 * @param {number} [baseCents=0] - Baseline detune, e.g. tuning * 100
 * @returns {boolean} Whether any voice was reached
 */
export function bendVoices(node, midi, startTime, anchors, baseCents = 0) {
  if (node?.isSoundfont || node?.isSfz || node?.isFaust || node?.isIson) return node.bend(midi, startTime, anchors, baseCents);
  if (!canResample(node)) return false;
  return applyPitchAnchorsToSampler(node, midi, startTime, anchors, baseCents);
}

/**
 * Hold a sounding note past the end of its recording, by looping the sample's
 * sustaining region. Samples that decay are left alone.
 *
 * @param {Object} node - The instrument, as returned by {@link create}
 * @param {number} midi - The note's MIDI number
 * @param {number} startTime - Absolute time in seconds of the note start
 * @param {number} seconds - The note's duration
 * @param {Object} [options] - Passed to the sustain analysis
 * @returns {boolean} Whether any voice was made to loop
 */
export function holdVoices(node, midi, startTime, seconds, options = {}) {
  if (node?.isIson) return node.hold(midi, startTime, seconds, options);
  if (!canResample(node)) return false;
  return sustainSampledNote(node, midi, startTime, seconds, options);
}

/**
 * Move a sounding note's loudness through a curve, so a held string or wind
 * swells and eases off instead of sitting at one level.
 *
 * Replaces the note's whole gain path, attack and release included, and lets
 * the note go at its end. Call it after triggerAttack and holdVoices, and skip
 * triggerRelease when it returns true: stopping a voice again would cancel the
 * curve, and triggerAttackRelease leaves no voice to find.
 *
 * @param {Object} node - The instrument, as returned by {@link create}
 * @param {number} midi - The note's MIDI number
 * @param {number} startTime - Absolute time in seconds of the note start
 * @param {Array<{time: number, value: number}>} anchors - Time relative to
 *   `startTime` in seconds, value as a multiple of the note's velocity
 * @param {Object} options - `{ seconds, velocity, attack, release }`; attack
 *   and release default to the instrument's own
 * @returns {boolean} Whether any voice was reached
 */
export function shapeVoices(node, midi, startTime, anchors, options = {}) {
  if (node?.isSoundfont || node?.isSfz || node?.isFaust || node?.isIson) return node.shape(midi, startTime, anchors, options);
  if (!canResample(node)) return false;
  const seconds = (value) => (typeof node.toSeconds === "function" ? node.toSeconds(value) : Number(value) || 0);
  return applyAmplitudeAnchorsToSampler(node, midi, startTime, anchors, {
    ...options,
    attack: options.attack ?? seconds(node.attack),
    release: options.release ?? seconds(node.release),
  });
}

/**
 * Whether a host should play this instrument's notes as a separate attack and
 * release, and give the provider the note in between (holdVoices,
 * shapeVoices): a Sampler, whose voices can be held and shaped, a SoundFont
 * instrument, whose loudness curves become CC 11, an SFZ instrument, whose
 * notes are voices of their own, or a Faust instrument, whose controls move
 * inside the DSP.
 *
 * @param {Object} node - The instrument, as returned by {@link create}
 * @returns {boolean}
 */
export function handlesVoices(node) {
  return canResample(node) || node?.isSoundfont === true || node?.isSfz === true || node?.isFaust === true || node?.isIson === true;
}

/**
 * A piece whose ison tracks are played the way their instruments say: the
 * notes of every track whose `synth` is an ison with `play` rules go through
 * `performIson` (strokes, variants, the shape of a stroke). Pure: a new piece,
 * the other tracks as they were. A host calls it before it schedules anything.
 *
 * @param {Object} piece
 * @returns {Object}
 */
export function performPiece(piece) {
  if (!piece || !Array.isArray(piece.tracks)) return piece;
  const tempo = piece.tempo ?? piece.bpm ?? 120;
  let changed = false;
  const tracks = piece.tracks.map((track, index) => {
    let spec = track?.synth;
    if (!isIsonSpec(spec)) return track;
    let out = track;
    // A control the piece writes on this track (a lane, `track.cc`, a note's
    // modulations) is the piece's to move: the velocity stops turning it.
    const written = writtenControls(piece, track, index);
    const taken = Object.entries(spec.controls ?? {}).filter(([name, control]) => control?.velocity === true && (written.names.has(name) || written.ccs.has(control.cc)));
    if (taken.length) {
      const controls = { ...spec.controls };
      for (const [name, control] of taken) controls[name] = { ...control, velocity: false };
      spec = { ...spec, controls };
      out = { ...out, synth: spec };
      changed = true;
    }
    if (spec.play || hasLayers(spec) || Object.values(spec.modes ?? {}).some((mode) => mode?.speech)) {
      const key = Array.isArray(track.notes) ? "notes" : "events";
      out = { ...out, [key]: performIson(spec, track[key] ?? [], { tempo }) };
      changed = true;
    }
    return out;
  });
  return changed ? { ...piece, tracks } : piece;
}

/**
 * The controls a piece writes for one track, by name (an automation lane
 * whose target is the control's name) and by controller number (a lane on
 * `midi.ccN`, `track.cc`, a note's `modulations`).
 */
function writtenControls(piece, track, index) {
  const names = new Set(), ccs = new Set();
  const automation = piece.automation ?? {};
  const lanes = [
    ...(automation.global ?? []),
    ...(automation.tracks?.[track.label] ?? []),
    ...(automation.tracks?.[index] ?? []),
    ...(Array.isArray(track.automation) ? track.automation : []),
  ];
  for (const lane of lanes) {
    if (typeof lane?.target !== "string") continue;
    const cc = /^midi\.cc(\d+)$/.exec(lane.target);
    if (cc) ccs.add(Number(cc[1]));
    else names.add(lane.target);
  }
  for (const c of Array.isArray(track.cc) ? track.cc : []) ccs.add(Number(c?.controller ?? c?.cc));
  for (const note of track.notes ?? []) {
    for (const m of note?.modulations ?? []) if (m?.type === "cc") ccs.add(Number(m.controller));
  }
  return { names, ccs };
}

/**
 * The provider object `jm.play(piece, { Tone, sound })` expects.
 *
 * Every method is optional from the caller's side, so a partial or custom
 * implementation — an adapter over a different sample engine, say — is a
 * legitimate substitute.
 */
export const sound = {
  VERSION,

  // The contract jmon/algo calls.
  create,
  prepare,
  bendVoices,
  holdVoices,
  shapeVoices,
  handlesVoices,
  performPiece,
  ison,
  readSpec,

  // A SoundFont bank played by a real engine instead of the midi-js files.
  useSoundfont,
  soundfontInUse,
  defaultSoundfontAttack,

  // Instruments written in Faust: where its compiler is, if not here.
  useFaust,

  // General MIDI.
  GM_INSTRUMENTS,
  BANKS,
  CDN_ROOTS,
  CDN_SOURCES,
  generateSamplerUrls,
  generateCompleteSamplerUrls,
  createGMInstrumentNode,
  findGMProgramByName,
  getPopularInstruments,
  getSoundfontBase,
  setSoundfontBase,
  resolveSoundfontBase,
  getSoundfontBank,
  setSoundfontBank,
  getSoundfontSources,
  setSoundfontSources,
  getSamplingStrategy,
  setSamplingStrategy,
  defaultEnvelope,
  getSoundfontFormat,
  setSoundfontFormat,

  // Every sample in the FluidR3 set is a fixed-length render; these say how
  // long, and how many beats that buys at a given tempo.
  GM_SAMPLE_SECONDS,
  gmMaxBeats,

  // Drum kits — the registry is mutable.
  drumKits,
  registerDrumKit,
  getDrumKit,
  setDrumKitSource,
  setDrumBank,
  setDrumSamples,
  getDrumSamples,
  GM_DRUM_KITS,

  // The analysis behind holdVoices, exposed because it is the interesting part.
  analyseSustain,
  prepareLoopRegion,
  prepareSamplerLoops,
  canResample,
};

export {
  analyseSustain,
  useFaust,
  performIson,
  isIsonSpec,
  ison,
  defaultEnvelope,
  defaultSoundfontAttack,
  soundfontInUse,
  useSoundfont,
  applyAmplitudeAnchorsToSampler,
  applyPitchAnchorsToSampler,
  BANKS,
  canResample,
  CDN_ROOTS,
  CDN_SOURCES,
  createGMInstrumentNode,
  drumKits,
  findGMProgramByName,
  generateCompleteSamplerUrls,
  generateSamplerUrls,
  getDrumKit,
  getPopularInstruments,
  getSamplingStrategy,
  getSoundfontBank,
  getSoundfontBase,
  getSoundfontFormat,
  getSoundfontSources,
  GM_INSTRUMENTS,
  GM_SAMPLE_SECONDS,
  gmMaxBeats,
  parseDrumKitSpec,
  prepareLoopRegion,
  prepareSamplerLoops,
  registerDrumKit,
  resolveSoundfontBase,
  setDrumKitSource,
  setDrumBank,
  setDrumSamples,
  getDrumSamples,
  GM_DRUM_KITS,
  setSamplingStrategy,
  setSoundfontBank,
  setSoundfontBase,
  setSoundfontFormat,
  setSoundfontSources,
  sustainSampledNote,
};

export default sound;
