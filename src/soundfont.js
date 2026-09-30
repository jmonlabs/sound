/**
 * General MIDI instruments played by a real SoundFont engine.
 *
 * The midi-js banks this package loads by default are a few seconds of audio
 * per note, rendered from a SoundFont; holding a note means looping that
 * audio, and a loop guessed from the audio is never as good as the one the
 * bank's author set. A SoundFont engine plays the bank as it was made: its
 * loop points, its envelopes, its velocity layers, its vibrato.
 *
 * The engine is spessasynth (https://github.com/spessasus/spessasynth_lib,
 * Apache-2.0). It runs as an AudioWorklet in the same audio context as Tone.js
 * — its node is created through Tone's context, so it plugs into Tone's graph
 * like any instrument — and it has one output per MIDI channel. Each track gets
 * a channel of a synthesizer shared by every track of that context, and a
 * Tone.Gain as its output, which the host connects to the track's bus as it
 * would a Sampler: panning, effects and mastering are unchanged.
 *
 * Two ways in, both after useSoundfont() has said where the engine is:
 *
 *   - `{ gm: 40 }`, when useSoundfont() also names a bank: General MIDI
 *     programs are played by that bank (a spec may opt out with
 *     `soundfont: false`);
 *   - `{ sf2: "…/bank.sf2", program: 40, bankSelect: 0 }`: any bank, per track, so
 *     one piece can take its violin from one bank and its piano from another.
 *
 * Each bank file has a synthesizer of its own, so every bank keeps its own
 * bank numbers and 15 channels.
 */

let settings = null;
let libraryModule = null;

/** Each bank file's bytes, fetched once: url → Promise<ArrayBuffer>. */
const bankBytes = new Map();

/**
 * Shared synthesizers, per Tone context and bank file:
 * context → Map(url → { ready: Promise<synth>, channels: Set<number> }).
 */
const shared = new WeakMap();

/** Semitones the pitch wheel covers either way. */
const BEND_RANGE = 12;

/** Channel 9 is General MIDI's drum channel; outputs beyond 16 wrap around. */
const CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

/**
 * CC 73 (attack time) by family, 64 being the bank's own attack. Bowed strings
 * and string ensembles start a little softer than the banks make them.
 */
const ATTACKS = [
  [40, 44, 100], // bowed strings
  [48, 54, 100], // string ensembles and choirs
];

/**
 * Say where the SoundFont engine is, and which bank plays General MIDI
 * programs, if any; or stop (null).
 *
 * @param {Object|null} options
 * @param {string} options.library - URL of spessasynth_lib as one ES module
 * @param {string} options.processor - URL of spessasynth's AudioWorklet processor
 * @param {string} [options.bank] - URL of an SF2, SF3 or DLS file for `{ gm }`
 *   tracks; without it they stay Samplers, and only `{ sf2 }` tracks use the
 *   engine
 */
export function useSoundfont(options) {
  settings = options ? { ...options } : null;
  libraryModule = null;
  bankBytes.clear();
}

/** True when GM instruments are played by a SoundFont bank. */
export function soundfontInUse() {
  return Boolean(settings?.bank);
}

/** The default attack (CC 73) of a GM program. */
export function defaultSoundfontAttack(program) {
  const row = ATTACKS.find(([first, last]) => program >= first && program <= last);
  return row ? row[2] : 64;
}

/**
 * A SoundFont instrument, or null when none can be made (no engine, or every
 * channel of this bank's synthesizer taken).
 *
 * @param {Object} Tone
 * @param {Object} preset
 * @param {number} preset.program - 0 to 127
 * @param {string} [preset.bank] - the bank file; the one useSoundfont() names
 *   by default, whose General MIDI programs start with the family's attack
 *   (see defaultSoundfontAttack)
 * @param {number} [preset.bankSelect=0] - the bank number inside the file,
 *   where a bank keeps variations of its programs
 * @param {Object} [preset.controllers] - controller number → 0..127
 */
export function createSoundfontInstrument(Tone, { program, bank, bankSelect = 0, controllers = {} }) {
  if (!settings?.library || !settings?.processor || !Tone?.getContext) {
    console.warn("A SoundFont track needs useSoundfont({ library, processor }) first.");
    return null;
  }
  const url = bank ?? settings.bank;
  if (!url) return null;
  const context = Tone.getContext();
  const entry = sharedFor(context, url);
  const channel = CHANNELS.find((c) => !entry.channels.has(c));
  if (channel === undefined) return null;
  entry.channels.add(channel);
  const familyAttack = bank === undefined ? { 73: defaultSoundfontAttack(program) } : {};
  return new SoundfontInstrument(Tone, context, entry, channel, program, bankSelect, {
    ...familyAttack,
    ...controllers,
  });
}

function sharedFor(context, url) {
  if (!shared.has(context)) shared.set(context, new Map());
  const synths = shared.get(context);
  if (!synths.has(url)) synths.set(url, { ready: startSynth(context, url), channels: new Set() });
  return synths.get(url);
}

async function startSynth(context, bank) {
  const { library, processor } = settings;
  libraryModule ??= import(library);
  if (!bankBytes.has(bank)) {
    bankBytes.set(bank, fetch(bank).then((r) => {
      if (!r.ok) throw new Error(`Could not load the SoundFont bank ${bank} (${r.status})`);
      return r.arrayBuffer();
    }));
  }
  const [{ WorkletSynthesizer }, bytes] = await Promise.all([libraryModule, bankBytes.get(bank)]);
  await context.addAudioWorkletModule(processor, "spessasynth");
  const synth = new WorkletSynthesizer(context.rawContext, {
    audioNodeCreators: { worklet: (_, name, options) => context.createAudioWorkletNode(name, options) },
  });
  // The bank is handed to the worklet, which may take the buffer: each
  // context gets its own copy.
  await synth.soundBankManager.addSoundBank(bytes.slice(0), "main");
  await synth.isReady;
  return synth;
}

/** A proportion as a 7-bit MIDI value. */
function midiValue(value) {
  return Math.max(0, Math.min(127, Math.round(value * 127)));
}

/**
 * One track's instrument: a MIDI channel of the shared synthesizer, shaped
 * like a Tone.js instrument for the host (connect, triggerAttack,
 * triggerRelease, triggerAttackRelease, releaseAll, dispose).
 */
class SoundfontInstrument {
  constructor(Tone, context, entry, channel, program, bankSelect, controllers) {
    this.Tone = Tone;
    this.context = context;
    this.channel = channel;
    this.isSoundfont = true;
    this.disposed = false;
    this.shaped = false;
    this.output = new Tone.Gain(1);
    this.synth = null;
    this._entry = entry;
    // What the host awaits before scheduling, like a Sampler's buffers.
    this.loaded = entry.ready.then((synth) => {
      if (this.disposed) return;
      this.synth = synth;
      synth.connectChannel(this.output.input, channel);
      if (bankSelect) synth.controllerChange(channel, 0, bankSelect);
      synth.programChange(channel, program);
      // Room for a glissando of an octave either way (see bend).
      synth.pitchWheelRange(channel, BEND_RANGE);
      // Dry: the track's bus and the piece's reverb do the room.
      synth.controllerChange(channel, 91, 0);
      synth.controllerChange(channel, 93, 0);
      for (const [controller, value] of Object.entries(controllers)) {
        synth.controllerChange(channel, Number(controller), value);
      }
    });
  }

  connect(destination) {
    this.output.connect(destination);
    return this;
  }

  disconnect() {
    this.output.disconnect();
    return this;
  }

  toDestination() {
    this.output.toDestination();
    return this;
  }

  set() {
    return this;
  }

  /** A note name, frequency or MIDI number, as the MIDI note it sounds. */
  midiOf(note) {
    return typeof note === "number" && note < 128 ? Math.round(note) : Math.round(this.Tone.Frequency(note).toMidi());
  }

  timeOf(time) {
    if (time === undefined) return this.context.currentTime;
    return typeof time === "number" ? time : this.Tone.Time(time).toSeconds();
  }

  triggerAttack(notes, time, velocity = 1) {
    if (!this.synth) return this;
    const at = this.timeOf(time);
    // A note with no loudness curve starts at rest, not at the last one's level.
    if (this.shaped) this.synth.controllerChange(this.channel, 11, 127, { time: at });
    const vel = Math.max(1, Math.min(127, Math.round(velocity * 127)));
    for (const note of [].concat(notes)) this.synth.noteOn(this.channel, this.midiOf(note), vel, { time: at });
    return this;
  }

  triggerRelease(notes, time) {
    if (!this.synth) return this;
    const at = this.timeOf(time);
    for (const note of [].concat(notes)) this.synth.noteOff(this.channel, this.midiOf(note), { time: at });
    return this;
  }

  triggerAttackRelease(notes, duration, time, velocity = 1) {
    const at = this.timeOf(time);
    this.triggerAttack(notes, at, velocity);
    this.triggerRelease(notes, at + this.timeOf(duration));
    return this;
  }

  /**
   * A note's loudness curve, as CC 11 (expression) on the channel, then its
   * release. The fader is the channel's: a curve that rises from silence is
   * the note's attack, which the instrument already gives, and would mute
   * the end of the note before, so it holds its first level from the onset.
   *
   * @param {number} midi
   * @param {number} startTime - seconds
   * @param {Array<{time:number,value:number}>} anchors - seconds from the
   *   start, values as a proportion of the velocity
   * @param {{seconds:number}} options
   * @returns {boolean} true: the note is released here
   */
  shape(midi, startTime, anchors, { seconds }) {
    if (!this.synth || !Array.isArray(anchors) || anchors.length === 0) return false;
    let points = anchors.map((a) => ({ time: a.time, value: Math.max(0, Math.min(1, a.value)) }));
    if (points.length > 1 && points[0].value === 0) points = [{ time: 0, value: points[1].value }, ...points.slice(1)];
    const levelAt = (t) => {
      if (t <= points[0].time) return points[0].value;
      for (let k = 1; k < points.length; k++) {
        const a = points[k - 1];
        const b = points[k];
        if (t <= b.time) return a.value + (b.value - a.value) * ((t - a.time) / (b.time - a.time || 1));
      }
      return points.at(-1).value;
    };
    this.shaped = true;
    let last = -1;
    for (let t = 0; t < seconds; t += 0.03) {
      const value = Math.round(levelAt(t) * 127);
      if (value !== last) this.synth.controllerChange(this.channel, 11, value, { time: startTime + t });
      last = value;
    }
    this.synth.noteOff(this.channel, midi, { time: startTime + seconds });
    return true;
  }

  /**
   * A note's pitch curve (glissando, portamento, bend, pitch envelope) as the
   * channel's pitch wheel, every 20 ms, back to the centre just after the
   * curve. The wheel is the channel's: two overlapping notes on one track bend
   * together, which a monophonic line never does.
   *
   * @param {number} midi - unused: the channel bends as a whole
   * @param {number} startTime - seconds
   * @param {Array<{time:number,value:number}>} anchors - seconds from the
   *   start, cents from the written pitch
   * @param {number} [baseCents=0] - a constant offset (the note's tuning)
   * @returns {boolean} true: the note bends
   */
  bend(midi, startTime, anchors, baseCents = 0) {
    if (!this.synth || !Array.isArray(anchors) || anchors.length === 0) return false;
    const wheel = (cents) => Math.max(0, Math.min(16383, Math.round(8192 + ((baseCents + cents) / 100 / BEND_RANGE) * 8192)));
    const centsAt = (t) => {
      if (t <= anchors[0].time) return anchors[0].value;
      for (let k = 1; k < anchors.length; k++) {
        const a = anchors[k - 1];
        const b = anchors[k];
        if (t <= b.time) return a.value + (b.value - a.value) * ((t - a.time) / (b.time - a.time || 1));
      }
      return anchors.at(-1).value;
    };
    const end = anchors.at(-1).time;
    let last = -1;
    for (let t = Math.max(0, anchors[0].time); t <= end; t += 0.02) {
      const value = wheel(centsAt(t));
      if (value !== last) this.synth.pitchWheel(this.channel, value, { time: startTime + t });
      last = value;
    }
    // The arrival itself: steps of 20 ms need not land on the curve's end.
    const arrival = wheel(centsAt(end));
    if (arrival !== last) this.synth.pitchWheel(this.channel, arrival, { time: startTime + end });
    this.synth.pitchWheel(this.channel, 8192, { time: startTime + end + 0.05 });
    return true;
  }

  /**
   * A controller move from the piece (see io's controllerEvents), sent to the
   * channel as it is: the bank decides what it does (CC 1 vibrato or
   * dynamics, CC 74 brightness…).
   *
   * @param {number} controller - 0..127
   * @param {number} value - 0..1
   * @param {number} [time] - seconds
   */
  controllerChange(controller, value, time) {
    if (!this.synth) return this;
    this.synth.controllerChange(this.channel, controller, midiValue(value), { time: this.timeOf(time) });
    return this;
  }

  /**
   * A pitch bend from the piece: -1..1 is two semitones either way, as the
   * JMON schema defines it, whatever range the wheel has for glissandi.
   */
  pitchBend(value, time) {
    if (!this.synth) return this;
    const wheel = Math.round(8192 + Math.max(-1, Math.min(1, value)) * (2 / BEND_RANGE) * 8191);
    this.synth.pitchWheel(this.channel, wheel, { time: this.timeOf(time) });
    return this;
  }

  /** Channel pressure (aftertouch) from the piece, 0..1. */
  channelPressure(value, time) {
    if (!this.synth) return this;
    this.synth.channelPressure(this.channel, midiValue(value), { time: this.timeOf(time) });
    return this;
  }

  releaseAll() {
    this.synth?.controllerChange(this.channel, 123, 0);
    return this;
  }

  dispose() {
    if (this.disposed) return this;
    this.disposed = true;
    if (this.synth) {
      this.synth.controllerChange(this.channel, 120, 0); // all sound off
      this.synth.controllerChange(this.channel, 121, 0); // reset controllers
      try { this.synth.disconnectChannel(this.output.input, this.channel); } catch { /* already */ }
    }
    this._entry.channels.delete(this.channel);
    this.output.dispose();
    return this;
  }
}
