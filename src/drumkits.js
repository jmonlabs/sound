/**
 * Drum kit registry — sample-based drum kits, used when a track declares
 * `synth: "drumkit:<name>"`. Sister of `gm-instruments.js` (which handles
 * the melodic GM programs 0-127).
 *
 * Why a separate registry? GM standard reserves channel 10 for drums with
 * MIDI notes mapping to specific drum sounds (36=kick, 38=snare, ...).
 * The FluidR3_GM source we use for melodic instruments doesn't include
 * drum kits, so we wire drums to a different sample source.
 *
 * Each kit defines:
 *   - `baseUrl` — where the samples live (must be CORS-friendly)
 *   - `samples` — `{ midiNote: filename }` map (use GM Drum Map numbers)
 *
 * GM Drum Map cheat-sheet:
 *   36 kick   37 rim   38 snare   39 clap   41 tom_low
 *   42 hihat  46 openhat   47 tom_mid   49 crash   50 tom_high   51 ride
 *
 * Default kits ship with the lib (see `drumKits` below). Register custom
 * kits at runtime:
 *
 *   jm.instruments.registerDrumKit('my-808', {
 *     baseUrl: 'https://example.com/808/',
 *     samples: { 36: 'kick.wav', 38: 'snare.wav', ... }
 *   });
 */

/** Where the built-in kits come from: Tone.js's audio repository, on GitHub Pages. */
const TONE_AUDIO = "https://tonejs.github.io/audio";

export const drumKits = {
  /**
   * Tone.js's own acoustic kit. CORS-friendly (GitHub Pages).
   * Sparse coverage: only kick, snare, hihat, and 3 toms — no openhat,
   * crash, ride, clap, or rim. The Drummer's `ambient` preset uses just
   * kick/snare/hihat so this kit is sufficient for most use cases.
   * Source: https://github.com/Tonejs/audio/tree/master/drum-samples/acoustic-kit
   */
  acoustic: {
    baseUrl: `${TONE_AUDIO}/drum-samples/acoustic-kit/`,
    samples: {
      36: "kick.mp3",
      38: "snare.mp3",
      42: "hihat.mp3",
      46: "hihat.mp3", // shared with closed (only one hihat sample in this kit)
      41: "tom1.mp3",
      47: "tom2.mp3",
      50: "tom3.mp3",
    },
  },

  /**
   * Tone.js's R8-style kit (Roland TR-808-ish). Same caveat: only the
   * sounds listed in the source. Adjust if you find more.
   */
  r8: {
    baseUrl: `${TONE_AUDIO}/drum-samples/R8/`,
    samples: {
      36: "kick.mp3",
      38: "snare.mp3",
      42: "hihat.mp3",
      46: "hihat.mp3",
      41: "tom1.mp3",
      47: "tom2.mp3",
      50: "tom3.mp3",
    },
  },
};

/**
 * The General MIDI drum kits of the MuseScore General bank (licence MIT),
 * kept alone in one 1.9 MB file at github.com/jmonlabs/sf (musescore/drums.sf3): every General MIDI
 * drum sound from 35 to 81 (kick, snares, claps, hi-hats, toms, cymbals,
 * cowbell, congas…). `synth: "drumkit"` plays the Standard kit, and
 * `"drumkit:<name>"` one of the others. They load like a General MIDI program:
 * nothing to install or declare.
 */
export const DRUM_BANK_KITS = Object.freeze({
  standard: 0,
  room: 8,
  power: 16,
  electronic: 24,
  808: 25,
  jazz: 32,
  brush: 40,
  orchestra: 48,
});

let drumBank = "https://cdn.jsdelivr.net/gh/jmonlabs/sf@main/musescore/drums.sf3";

/**
 * Load the drum bank from somewhere else (a local copy), or null for the
 * default at github.com/jmonlabs/sf.
 * @param {string|null} url
 */
export function setDrumBank(url) {
  drumBank = url || "https://cdn.jsdelivr.net/gh/jmonlabs/sf@main/musescore/drums.sf3";
}

/** The drum bank's URL. */
export function getDrumBank() {
  return drumBank;
}

/**
 * Load the built-in kits from somewhere else: a local copy of Tone.js's audio
 * repository, laid out the same way (`drum-samples/acoustic-kit/kick.mp3`).
 * Passing null restores GitHub Pages. Kits added with registerDrumKit keep
 * their own baseUrl.
 *
 * @param {string|null} root - The folder that contains `drum-samples/`
 */
export function setDrumKitSource(root) {
  const base = root || TONE_AUDIO;
  drumKits.acoustic.baseUrl = `${base}/drum-samples/acoustic-kit/`;
  drumKits.r8.baseUrl = `${base}/drum-samples/R8/`;
}

/**
 * Register a custom drum kit at runtime.
 * @param {string} name - Identifier used in `synth: "drumkit:<name>"`
 * @param {{baseUrl: string, samples: Record<number, string>}} kit
 */
export function registerDrumKit(name, kit) {
  if (!kit || typeof kit !== "object") {
    throw new Error("registerDrumKit: kit must be an object with baseUrl and samples");
  }
  if (typeof kit.baseUrl !== "string" || !kit.baseUrl) {
    throw new Error("registerDrumKit: kit.baseUrl is required");
  }
  if (!kit.samples || typeof kit.samples !== "object") {
    throw new Error("registerDrumKit: kit.samples is required (map midi -> filename)");
  }
  drumKits[name] = kit;
}

/**
 * Look up a kit by name. Returns undefined if not registered.
 * @param {string} name
 */
export function getDrumKit(name) {
  return drumKits[name];
}

/**
 * Parse a synth string of the form "drumkit:<name>" and return the kit,
 * or null if the string is not a drumkit reference.
 * @param {string} synthSpec
 */
export function parseDrumKitSpec(synthSpec) {
  if (synthSpec === "drumkit") return { name: "standard", program: DRUM_BANK_KITS.standard };
  if (typeof synthSpec !== "string" || !synthSpec.startsWith("drumkit:")) {
    return null;
  }
  const name = synthSpec.slice("drumkit:".length);
  if (drumKits[name] === undefined && DRUM_BANK_KITS[name] !== undefined) {
    return { name, program: DRUM_BANK_KITS[name] };
  }
  const kit = drumKits[name];
  if (!kit) {
    return { name, kit: null };
  }
  return { name, kit };
}
