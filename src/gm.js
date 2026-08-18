/**
 * General MIDI programs 0-127, mapped to their FluidR3 sample folder.
 *
 * The folder names are data, not a rule: most are the instrument name
 * lowercased with underscores, but `honkytonk_piano-mp3` drops its hyphen,
 * `lead_8_bass__lead-mp3` keeps a double underscore where the name had
 * " + ", and `fx_8_scifi-mp3` loses its hyphen entirely. Every entry below
 * was checked against the CDN rather than derived.
 *
 * Half the table used to be missing — 50-55, 59-63 and everything from 75 up,
 * which is all the synth leads and pads, the ethnic and percussive banks and
 * the sound effects. Those programs fell through to the piano.
 */
export const GM_INSTRUMENTS = {
  0: { name: "Acoustic Grand Piano", folder: "acoustic_grand_piano-mp3" },
  1: { name: "Bright Acoustic Piano", folder: "bright_acoustic_piano-mp3" },
  2: { name: "Electric Grand Piano", folder: "electric_grand_piano-mp3" },
  3: { name: "Honky-tonk Piano", folder: "honkytonk_piano-mp3" },
  4: { name: "Electric Piano 1", folder: "electric_piano_1-mp3" },
  5: { name: "Electric Piano 2", folder: "electric_piano_2-mp3" },
  6: { name: "Harpsichord", folder: "harpsichord-mp3" },
  7: { name: "Clavinet", folder: "clavinet-mp3" },
  8: { name: "Celesta", folder: "celesta-mp3" },
  9: { name: "Glockenspiel", folder: "glockenspiel-mp3" },
  10: { name: "Music Box", folder: "music_box-mp3" },
  11: { name: "Vibraphone", folder: "vibraphone-mp3" },
  12: { name: "Marimba", folder: "marimba-mp3" },
  13: { name: "Xylophone", folder: "xylophone-mp3" },
  14: { name: "Tubular Bells", folder: "tubular_bells-mp3" },
  15: { name: "Dulcimer", folder: "dulcimer-mp3" },
  16: { name: "Drawbar Organ", folder: "drawbar_organ-mp3" },
  17: { name: "Percussive Organ", folder: "percussive_organ-mp3" },
  18: { name: "Rock Organ", folder: "rock_organ-mp3" },
  19: { name: "Church Organ", folder: "church_organ-mp3" },
  20: { name: "Reed Organ", folder: "reed_organ-mp3" },
  21: { name: "Accordion", folder: "accordion-mp3" },
  22: { name: "Harmonica", folder: "harmonica-mp3" },
  23: { name: "Tango Accordion", folder: "tango_accordion-mp3" },
  24: { name: "Acoustic Guitar (nylon)", folder: "acoustic_guitar_nylon-mp3" },
  25: { name: "Acoustic Guitar (steel)", folder: "acoustic_guitar_steel-mp3" },
  26: { name: "Electric Guitar (jazz)", folder: "electric_guitar_jazz-mp3" },
  27: { name: "Electric Guitar (clean)", folder: "electric_guitar_clean-mp3" },
  28: { name: "Electric Guitar (muted)", folder: "electric_guitar_muted-mp3" },
  29: { name: "Overdriven Guitar", folder: "overdriven_guitar-mp3" },
  30: { name: "Distortion Guitar", folder: "distortion_guitar-mp3" },
  31: { name: "Guitar Harmonics", folder: "guitar_harmonics-mp3" },
  32: { name: "Acoustic Bass", folder: "acoustic_bass-mp3" },
  33: { name: "Electric Bass (finger)", folder: "electric_bass_finger-mp3" },
  34: { name: "Electric Bass (pick)", folder: "electric_bass_pick-mp3" },
  35: { name: "Fretless Bass", folder: "fretless_bass-mp3" },
  36: { name: "Slap Bass 1", folder: "slap_bass_1-mp3" },
  37: { name: "Slap Bass 2", folder: "slap_bass_2-mp3" },
  38: { name: "Synth Bass 1", folder: "synth_bass_1-mp3" },
  39: { name: "Synth Bass 2", folder: "synth_bass_2-mp3" },
  40: { name: "Violin", folder: "violin-mp3" },
  41: { name: "Viola", folder: "viola-mp3" },
  42: { name: "Cello", folder: "cello-mp3" },
  43: { name: "Contrabass", folder: "contrabass-mp3" },
  44: { name: "Tremolo Strings", folder: "tremolo_strings-mp3" },
  45: { name: "Pizzicato Strings", folder: "pizzicato_strings-mp3" },
  46: { name: "Orchestral Harp", folder: "orchestral_harp-mp3" },
  47: { name: "Timpani", folder: "timpani-mp3" },
  48: { name: "String Ensemble 1", folder: "string_ensemble_1-mp3" },
  49: { name: "String Ensemble 2", folder: "string_ensemble_2-mp3" },
  50: { name: "Synth Strings 1", folder: "synth_strings_1-mp3" },
  51: { name: "Synth Strings 2", folder: "synth_strings_2-mp3" },
  52: { name: "Choir Aahs", folder: "choir_aahs-mp3" },
  53: { name: "Voice Oohs", folder: "voice_oohs-mp3" },
  54: { name: "Synth Choir", folder: "synth_choir-mp3" },
  55: { name: "Orchestra Hit", folder: "orchestra_hit-mp3" },
  56: { name: "Trumpet", folder: "trumpet-mp3" },
  57: { name: "Trombone", folder: "trombone-mp3" },
  58: { name: "Tuba", folder: "tuba-mp3" },
  59: { name: "Muted Trumpet", folder: "muted_trumpet-mp3" },
  60: { name: "French Horn", folder: "french_horn-mp3" },
  61: { name: "Brass Section", folder: "brass_section-mp3" },
  62: { name: "Synth Brass 1", folder: "synth_brass_1-mp3" },
  63: { name: "Synth Brass 2", folder: "synth_brass_2-mp3" },
  64: { name: "Soprano Sax", folder: "soprano_sax-mp3" },
  65: { name: "Alto Sax", folder: "alto_sax-mp3" },
  66: { name: "Tenor Sax", folder: "tenor_sax-mp3" },
  67: { name: "Baritone Sax", folder: "baritone_sax-mp3" },
  68: { name: "Oboe", folder: "oboe-mp3" },
  69: { name: "English Horn", folder: "english_horn-mp3" },
  70: { name: "Bassoon", folder: "bassoon-mp3" },
  71: { name: "Clarinet", folder: "clarinet-mp3" },
  72: { name: "Piccolo", folder: "piccolo-mp3" },
  73: { name: "Flute", folder: "flute-mp3" },
  74: { name: "Recorder", folder: "recorder-mp3" },
  75: { name: "Pan Flute", folder: "pan_flute-mp3" },
  76: { name: "Blown Bottle", folder: "blown_bottle-mp3" },
  77: { name: "Shakuhachi", folder: "shakuhachi-mp3" },
  78: { name: "Whistle", folder: "whistle-mp3" },
  79: { name: "Ocarina", folder: "ocarina-mp3" },
  80: { name: "Lead 1 (square)", folder: "lead_1_square-mp3" },
  81: { name: "Lead 2 (sawtooth)", folder: "lead_2_sawtooth-mp3" },
  82: { name: "Lead 3 (calliope)", folder: "lead_3_calliope-mp3" },
  83: { name: "Lead 4 (chiff)", folder: "lead_4_chiff-mp3" },
  84: { name: "Lead 5 (charang)", folder: "lead_5_charang-mp3" },
  85: { name: "Lead 6 (voice)", folder: "lead_6_voice-mp3" },
  86: { name: "Lead 7 (fifths)", folder: "lead_7_fifths-mp3" },
  87: { name: "Lead 8 (bass + lead)", folder: "lead_8_bass__lead-mp3" },
  88: { name: "Pad 1 (new age)", folder: "pad_1_new_age-mp3" },
  89: { name: "Pad 2 (warm)", folder: "pad_2_warm-mp3" },
  90: { name: "Pad 3 (polysynth)", folder: "pad_3_polysynth-mp3" },
  91: { name: "Pad 4 (choir)", folder: "pad_4_choir-mp3" },
  92: { name: "Pad 5 (bowed)", folder: "pad_5_bowed-mp3" },
  93: { name: "Pad 6 (metallic)", folder: "pad_6_metallic-mp3" },
  94: { name: "Pad 7 (halo)", folder: "pad_7_halo-mp3" },
  95: { name: "Pad 8 (sweep)", folder: "pad_8_sweep-mp3" },
  96: { name: "FX 1 (rain)", folder: "fx_1_rain-mp3" },
  97: { name: "FX 2 (soundtrack)", folder: "fx_2_soundtrack-mp3" },
  98: { name: "FX 3 (crystal)", folder: "fx_3_crystal-mp3" },
  99: { name: "FX 4 (atmosphere)", folder: "fx_4_atmosphere-mp3" },
  100: { name: "FX 5 (brightness)", folder: "fx_5_brightness-mp3" },
  101: { name: "FX 6 (goblins)", folder: "fx_6_goblins-mp3" },
  102: { name: "FX 7 (echoes)", folder: "fx_7_echoes-mp3" },
  103: { name: "FX 8 (sci-fi)", folder: "fx_8_scifi-mp3" },
  104: { name: "Sitar", folder: "sitar-mp3" },
  105: { name: "Banjo", folder: "banjo-mp3" },
  106: { name: "Shamisen", folder: "shamisen-mp3" },
  107: { name: "Koto", folder: "koto-mp3" },
  108: { name: "Kalimba", folder: "kalimba-mp3" },
  109: { name: "Bagpipe", folder: "bagpipe-mp3" },
  110: { name: "Fiddle", folder: "fiddle-mp3" },
  111: { name: "Shanai", folder: "shanai-mp3" },
  112: { name: "Tinkle Bell", folder: "tinkle_bell-mp3" },
  113: { name: "Agogo", folder: "agogo-mp3" },
  114: { name: "Steel Drums", folder: "steel_drums-mp3" },
  115: { name: "Woodblock", folder: "woodblock-mp3" },
  116: { name: "Taiko Drum", folder: "taiko_drum-mp3" },
  117: { name: "Melodic Tom", folder: "melodic_tom-mp3" },
  118: { name: "Synth Drum", folder: "synth_drum-mp3" },
  119: { name: "Reverse Cymbal", folder: "reverse_cymbal-mp3" },
  120: { name: "Guitar Fret Noise", folder: "guitar_fret_noise-mp3" },
  121: { name: "Breath Noise", folder: "breath_noise-mp3" },
  122: { name: "Seashore", folder: "seashore-mp3" },
  123: { name: "Bird Tweet", folder: "bird_tweet-mp3" },
  124: { name: "Telephone Ring", folder: "telephone_ring-mp3" },
  125: { name: "Helicopter", folder: "helicopter-mp3" },
  126: { name: "Applause", folder: "applause-mp3" },
  127: { name: "Gunshot", folder: "gunshot-mp3" },
};

/**
 * The sample banks the midi-js soundfont set publishes, all three rendered by
 * the same process and laid out identically — same folder names, same 128
 * programs, same fixed sample length. They differ in the recordings.
 *
 * Measured tail level, as a fraction of each recording's peak — which is what
 * decides whether a note can be held by looping (see `analyseSustain`):
 *
 *     strings   FluidR3 103%   Musyng 81%   FatBoy 41%
 *     violin            93%           98%          43%
 *     organ             91%           87%          76%
 *     piano              4%            7%           4%
 *
 * FatBoy's sustained instruments fade noticeably inside the sample, so they
 * loop less convincingly. FluidR3 is the default because it is the most
 * even; MusyngKite is generally the better-sounding set.
 */
export const BANKS = ["FluidR3_GM", "MusyngKite", "FatBoy"];

/** Where the banks are served from, in preference order. */
export const CDN_ROOTS = [
  "https://raw.githubusercontent.com/jmonlabs/midi-js-soundfonts/gh-pages",
  "https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@gh-pages",
];

let activeBank = BANKS[0];

/**
 * CDN sources for the current bank, in preference order.
 * raw.githubusercontent.com is more reliable for parallel audio file loading;
 * jsDelivr is the fallback. See {@link resolveSoundfontBase}, which picks
 * between them at runtime rather than trusting the first one to be up.
 */
export const CDN_SOURCES = CDN_ROOTS.map((root) => `${root}/${BANKS[0]}`);

/** The source currently in use. Changed only by resolveSoundfontBase/setSoundfontBase. */
let activeBase = CDN_SOURCES[0];

/** The base URL samples are currently loaded from. */
export function getSoundfontBase() {
  return activeBase;
}

/**
 * Force a base URL — your own mirror, or a local copy of the sample set.
 * Passing `null` restores the default bank and re-enables probing.
 */
export function setSoundfontBase(url) {
  activeBase = url || `${CDN_ROOTS[0]}/${activeBank}`;
  pendingProbe = url ? Promise.resolve(activeBase) : null;
}

/** Which bank is in use. */
export function getSoundfontBank() {
  return activeBank;
}

/**
 * Choose a sample bank. The layout is identical across all three, so this is
 * only a change of recording — nothing downstream has to know.
 *
 * Re-arms the CDN probe, so the next `resolveSoundfontBase()` checks the new
 * bank rather than trusting a source that answered for the old one.
 *
 * @param {string} bank - One of {@link BANKS}
 * @returns {string} The base URL now in use
 */
export function setSoundfontBank(bank) {
  if (!BANKS.includes(bank)) {
    throw new Error(`Unknown sample bank "${bank}". Choose one of: ${BANKS.join(", ")}.`);
  }
  activeBank = bank;
  activeBase = `${CDN_ROOTS[0]}/${bank}`;
  pendingProbe = null;
  return activeBase;
}

let pendingProbe = null;

/**
 * Pick a working CDN by asking each one for a single file, in order.
 *
 * `CDN_SOURCES` listed a fallback that nothing ever used: the URL builder
 * always returned the primary, with a comment saying a real mechanism was
 * left for later. This is that mechanism. One request decides for the whole
 * session — the result is memoised — and every sample URL built afterwards
 * uses the winner.
 *
 * If no source answers, the primary is kept: failing to load samples is a
 * better outcome than failing to build the player.
 *
 * @param {Object} [options]
 * @param {Array<string>} [options.sources=CDN_SOURCES] - Bases to try, in order
 * @param {Function} [options.fetchImpl=globalThis.fetch] - Injectable for tests
 * @returns {Promise<string>} The chosen base URL
 */
export function resolveSoundfontBase(options = {}) {
  if (pendingProbe) return pendingProbe;

  const { sources = CDN_ROOTS.map((root) => `${root}/${activeBank}`), fetchImpl = globalThis.fetch } = options;
  const probePath = `${GM_INSTRUMENTS[0].folder}/C4.mp3`;

  pendingProbe = (async () => {
    if (typeof fetchImpl !== "function") return activeBase;

    for (const source of sources) {
      try {
        const response = await fetchImpl(`${source}/${probePath}`, { method: "HEAD" });
        if (response && response.ok) {
          activeBase = source;
          return source;
        }
      } catch {
        // Try the next one.
      }
    }
    return activeBase;
  })();

  return pendingProbe;
}

/**
 * Build the Tone.js Sampler URL map for a GM program.
 *
 * `Sampler` resamples to fill the gaps, which is what a soundfont engine does
 * anyway, so there is no need for a file per semitone. The default strategy is
 * `balanced` — every major third, about 25 files — rather than `complete`,
 * which is 88 requests per instrument and made a four-instrument piece fetch
 * 352 files before its first note.
 *
 * Ask for `complete` explicitly when a sustained instrument's resampling
 * artefacts matter more than load time.
 *
 * @param {number} gmProgram - GM program number (0-127)
 * @param {string} baseUrl - Base CDN URL (default: the resolved source)
 * @param {Array<number>} noteRange - MIDI note range to map [min, max]
 * @param {string} strategy - 'minimal' (9), 'balanced' (25), 'quality' (30), 'complete' (88)
 * @returns {Object} Sampler URLs object for Tone.js
 */
export function generateSamplerUrls(
  gmProgram,
  baseUrl = getSoundfontBase(),
  noteRange = [21, 108],
  strategy = "balanced",
) {
  const instrument = GM_INSTRUMENTS[gmProgram];
  if (!instrument) {
    console.warn(
      `GM program ${gmProgram} not found, using Acoustic Grand Piano`,
    );
    return generateSamplerUrls(0, baseUrl, noteRange, strategy);
  }

  const urls = {};
  const [minNote, maxNote] = noteRange;
  let selectedMidis = [];

  switch (strategy) {
    case "minimal":
      // Sample every octave + one middle note (5-8 samples total)
      // Good for: Simple melodies, testing, low bandwidth
      for (let midi = minNote; midi <= maxNote; midi += 12) {
        selectedMidis.push(midi);
      }
      selectedMidis.push(60); // Always include middle C
      break;

    case "balanced":
      // Sample every major third (4 semitones) - optimal quality/size ratio
      // Good for: Most musical applications, ~12-16 samples
      for (let midi = minNote; midi <= maxNote; midi += 4) {
        selectedMidis.push(midi);
      }
      // Add a few key notes to ensure coverage
      [60, 64, 67].forEach((key) => {
        if (key >= minNote && key <= maxNote && !selectedMidis.includes(key)) {
          selectedMidis.push(key);
        }
      });
      break;

    case "quality":
      // Sample every minor third (3 semitones) - high quality
      // Good for: Professional applications, ~16-20 samples
      for (let midi = minNote; midi <= maxNote; midi += 3) {
        selectedMidis.push(midi);
      }
      break;

    case "complete":
      // Sample every semitone - maximum quality but heavy
      // Good for: When quality is critical, 48+ samples
      for (let midi = minNote; midi <= maxNote; midi++) {
        selectedMidis.push(midi);
      }
      break;

    default:
      console.warn(`Unknown sampling strategy '${strategy}', using 'balanced'`);
      return generateSamplerUrls(gmProgram, baseUrl, noteRange, "balanced");
  }

  // Remove duplicates and sort
  selectedMidis = [...new Set(selectedMidis)].sort((a, b) => a - b);

  // Generate URLs for selected notes
  for (const midi of selectedMidis) {
    const noteName = midiToNoteName(midi);
    urls[noteName] = sampleUrl(instrument.folder, noteName, baseUrl);
  }

  return urls;
}

/**
 * Build one sample URL. Choosing *which* CDN happens once per session in
 * {@link resolveSoundfontBase}, not per file — a URL string cannot fall back
 * on its own, which is why the earlier attempt here did nothing.
 */
function sampleUrl(folder, noteName, baseUrl) {
  return `${baseUrl}/${folder}/${noteName}.mp3`;
}

/**
 * Generate comprehensive Sampler URLs for high-quality instruments
 * @param {number} gmProgram - GM program number
 * @param {string} baseUrl - Base CDN URL
 * @param {Array<number>} noteRange - Full note range
 * @returns {Object} Complete sampler URLs
 */
export function generateCompleteSamplerUrls(
  gmProgram,
  baseUrl = getSoundfontBase(),
  noteRange = [21, 108],
) {
  const instrument = GM_INSTRUMENTS[gmProgram];
  if (!instrument) {
    console.warn(
      `GM program ${gmProgram} not found, using Acoustic Grand Piano`,
    );
    return generateCompleteSamplerUrls(0, baseUrl, noteRange);
  }

  const urls = {};
  const [minNote, maxNote] = noteRange;

  // Generate all note names and map to URLs
  for (let midi = minNote; midi <= maxNote; midi++) {
    const noteName = midiToNoteName(midi);
    urls[noteName] = `${baseUrl}/${instrument.folder}/${noteName}.mp3`;
  }

  return urls;
}

/**
 * Convert MIDI note number to note name (e.g., 60 -> "C4")
 * @param {number} midi - MIDI note number
 * @returns {string} Note name (e.g., "C4", "F#3")
 */
function midiToNoteName(midi) {
  // Use flat naming to match FluidR3 file names (e.g., Bb0.mp3, Db4.mp3)
  const noteNames = [
    "C",
    "Db",
    "D",
    "Eb",
    "E",
    "F",
    "Gb",
    "G",
    "Ab",
    "A",
    "Bb",
    "B",
  ];
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${noteNames[noteIndex]}${octave}`;
}

/**
 * Find GM program number by instrument name (case-insensitive)
 * @param {string} instrumentName - Name of the instrument (e.g., "Violin", "acoustic grand piano")
 * @returns {number|null} GM program number or null if not found
 */
export function findGMProgramByName(instrumentName) {
  const searchName = instrumentName.toLowerCase().trim();
  
  for (const [program, instrument] of Object.entries(GM_INSTRUMENTS)) {
    if (instrument.name.toLowerCase() === searchName) {
      return parseInt(program, 10);
    }
  }
  
  // Try partial matching for common variations
  for (const [program, instrument] of Object.entries(GM_INSTRUMENTS)) {
    const instName = instrument.name.toLowerCase();
    if (instName.includes(searchName) || searchName.includes(instName.split(' ')[0])) {
      return parseInt(program, 10);
    }
  }
  
  return null;
}

/**
 * Create audioGraph configuration for GM instrument
 * @param {string} id - Node ID for the audioGraph
 * @param {number|string} instrument - GM program number (0-127) OR instrument name (e.g., "Violin")
 * @param {Object} options - Sampler options (noteRange, envelope, strategy, baseUrl, etc.)
 * @param {string} target - Target node ID (default: "destination")
 * @returns {Object} AudioGraph node configuration
 */
export function createGMInstrumentNode(
  id,
  instrument,
  options = {},
  target = "destination"
) {
  let gmProgram;
  
  // Handle both number and string inputs
  if (typeof instrument === 'string') {
    gmProgram = findGMProgramByName(instrument);
    if (gmProgram === null) {
      console.warn(`GM instrument "${instrument}" not found. Available instruments:`);
      const availableNames = Object.values(GM_INSTRUMENTS).map(inst => inst.name).slice(0, 10);
      console.warn(`Examples: ${availableNames.join(', ')}...`);
      console.warn('Using Acoustic Grand Piano as fallback');
      gmProgram = 0;
    }
  } else {
    gmProgram = instrument;
  }
  
  const instrumentData = GM_INSTRUMENTS[gmProgram];
  if (!instrumentData) return null;

  const {
    baseUrl = getSoundfontBase(),
    noteRange = [21, 108],
    envelope = { attack: 0.1, release: 1.0 },
    strategy = "balanced",
  } = options;

  return {
    id,
    type: "Sampler",
    options: {
      urls: generateSamplerUrls(gmProgram, baseUrl, noteRange, strategy),
      baseUrl: "", // URLs are already complete
      envelope: {
        enabled: true,
        attack: envelope.attack,
        release: envelope.release,
      },
    },
    target,
  };
}

/**
 * Get list of popular instruments for UI selection
 * @returns {Array} Array of {program, name, category} objects
 */
export function getPopularInstruments() {
  return [
    // Piano & Keys
    { program: 0, name: "Acoustic Grand Piano", category: "Piano" },
    { program: 1, name: "Bright Acoustic Piano", category: "Piano" },
    { program: 4, name: "Electric Piano 1", category: "Piano" },
    { program: 6, name: "Harpsichord", category: "Piano" },

    // Strings
    { program: 40, name: "Violin", category: "Strings" },
    { program: 42, name: "Cello", category: "Strings" },
    { program: 48, name: "String Ensemble 1", category: "Strings" },

    // Brass
    { program: 56, name: "Trumpet", category: "Brass" },
    { program: 57, name: "Trombone", category: "Brass" },

    // Woodwinds
    { program: 65, name: "Alto Sax", category: "Woodwinds" },
    { program: 71, name: "Clarinet", category: "Woodwinds" },
    { program: 73, name: "Flute", category: "Woodwinds" },

    // Guitar & Bass
    { program: 24, name: "Acoustic Guitar (nylon)", category: "Guitar" },
    { program: 25, name: "Acoustic Guitar (steel)", category: "Guitar" },
    { program: 33, name: "Electric Bass (finger)", category: "Bass" },

    // Organ & Accordion
    { program: 16, name: "Drawbar Organ", category: "Organ" },
    { program: 21, name: "Accordion", category: "Organ" },
  ];
}

/**
 * How long a FluidR3 sample lasts, in seconds.
 *
 * Every file in the set is the same fixed-length render — measured, not
 * assumed: violin C4, violin C6 and piano C4 are all 122 MPEG frames at
 * 44.1 kHz, so 3.19 s each. This is the one place GM playback differs
 * fundamentally from a soundfont engine, which loops a sample's sustain
 * region and can hold a note forever. Here the note simply stops.
 *
 * A whole note at 60 BPM is 4 seconds, so it ends in silence.
 */
export const GM_SAMPLE_SECONDS = 3.19;

/**
 * The longest note, in quarter notes, that a GM sample can sustain at a
 * given tempo. Past this the sound runs out before the note does.
 *
 * Pair it with `jm.utils.splitLongNotes` to re-articulate what would
 * otherwise fall silent:
 *
 *     const safe = jm.utils.splitLongNotes(notes, gmMaxBeats(tempo));
 *
 * @param {number} [tempo=120] - Beats per minute
 * @returns {number} Quarter notes
 */
export function gmMaxBeats(tempo = 120) {
  const bpm = Number(tempo) > 0 ? Number(tempo) : 120;
  return GM_SAMPLE_SECONDS * bpm / 60;
}
