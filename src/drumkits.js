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

export const drumKits = {
  /**
   * Tone.js's own acoustic kit. CORS-friendly (GitHub Pages).
   * Sparse coverage: only kick, snare, hihat, and 3 toms — no openhat,
   * crash, ride, clap, or rim. The Drummer's `ambient` preset uses just
   * kick/snare/hihat so this kit is sufficient for most use cases.
   * Source: https://github.com/Tonejs/audio/tree/master/drum-samples/acoustic-kit
   */
  acoustic: {
    baseUrl: "https://tonejs.github.io/audio/drum-samples/acoustic-kit/",
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
    baseUrl: "https://tonejs.github.io/audio/drum-samples/R8/",
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
  if (typeof synthSpec !== "string" || !synthSpec.startsWith("drumkit:")) {
    return null;
  }
  const name = synthSpec.slice("drumkit:".length);
  const kit = drumKits[name];
  if (!kit) {
    return { name, kit: null };
  }
  return { name, kit };
}
