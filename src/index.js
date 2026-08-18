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
  findGMProgramByName,
  generateCompleteSamplerUrls,
  generateSamplerUrls,
  getPopularInstruments,
  getSoundfontBank,
  getSoundfontBase,
  getSoundfontFormat,
  getSoundfontSources,
  gmMaxBeats,
  resolveSoundfontBase,
  setSoundfontBank,
  setSoundfontBase,
  setSoundfontFormat,
  setSoundfontSources,
} from "./gm.js";

import {
  drumKits,
  getDrumKit,
  parseDrumKitSpec,
  registerDrumKit,
} from "./drumkits.js";

import {
  analyseSustain,
  applyPitchAnchorsToSampler,
  canResample,
  prepareLoopRegion,
  sustainSampledNote,
} from "./voices.js";

export const VERSION = "1.0.0";

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
 * the sampling options beside it, and a drum kit name. Anything else — a Tone
 * class name, an inline `{ type, options }` — is not this package's business,
 * so it returns `null` and the caller builds it itself.
 *
 * @param {*} spec - A track's `synth`, after any preset has been expanded
 * @returns {{kind: 'gm'|'drumkit', ...}|null}
 */
export function readSpec(spec) {
  if (typeof spec === "number") return { kind: "gm", program: spec };

  if (typeof spec === "string") {
    const kit = parseDrumKitSpec(spec);
    return kit ? { kind: "drumkit", ...kit } : null;
  }

  if (spec && typeof spec === "object") {
    // `{ kit: "name" }` is the object form of `"drumkit:name"`, so a sample
    // set can carry options the string form has no room for. Any registered
    // kit works, not only drums: one file per key is also how you play a set
    // of spoken phrases, field recordings, or anything else one-shot.
    const kitName = spec.kit ?? spec.drumkit;
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
    };
  }

  return null;
}

/**
 * The base URL for a named bank, on the source currently in use — so a
 * per-track bank follows whichever CDN answered the probe.
 */
function bankBase(bank) {
  if (!BANKS.includes(bank)) {
    console.warn(`Unknown sample bank "${bank}". Using ${getSoundfontBank()}.`);
    return undefined;
  }
  const root = CDN_ROOTS.find((r) => getSoundfontBase().startsWith(r)) || CDN_ROOTS[0];
  return `${root}/${bank}`;
}

/**
 * Build the instrument a spec asks for.
 *
 * @param {*} spec - A track's `synth`, after preset expansion
 * @param {Object} Tone - The Tone.js namespace
 * @returns {{node: Object, isLoadable: boolean}|null} `null` when the spec is
 *   not for a sampled instrument, which tells the caller to build it itself
 */
export function create(spec, Tone) {
  const asked = readSpec(spec);
  if (!asked || !Tone?.Sampler) return null;

  if (asked.kind === "gm") {
    const urls = generateSamplerUrls(
      asked.program,
      asked.baseUrl,
      asked.noteRange,
      asked.strategy,
    );
    return {
      node: new Tone.Sampler({ urls, baseUrl: "", ...(asked.options || {}) }),
      isLoadable: true,
    };
  }

  if (!asked.kit) {
    console.warn(`Unknown drumkit "${asked.name}".`);
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
  if (!(specs || []).some((spec) => readSpec(spec) !== null)) return null;
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
 * @param {number} [baseCents=0] - Baseline detune, e.g. microtuning * 100
 * @returns {boolean} Whether any voice was reached
 */
export function bendVoices(node, midi, startTime, anchors, baseCents = 0) {
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
  if (!canResample(node)) return false;
  return sustainSampledNote(node, midi, startTime, seconds, options);
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
  readSpec,

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

  // The analysis behind holdVoices, exposed because it is the interesting part.
  analyseSustain,
  prepareLoopRegion,
  canResample,
};

export {
  analyseSustain,
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
  getSoundfontBank,
  getSoundfontBase,
  getSoundfontFormat,
  getSoundfontSources,
  GM_INSTRUMENTS,
  GM_SAMPLE_SECONDS,
  gmMaxBeats,
  parseDrumKitSpec,
  prepareLoopRegion,
  registerDrumKit,
  resolveSoundfontBase,
  setSoundfontBank,
  setSoundfontBase,
  setSoundfontFormat,
  setSoundfontSources,
  sustainSampledNote,
};

export default sound;
