/**
 * SFZ instruments: recordings played the way their author mapped them.
 *
 * A SoundFont played by spessasynth shapes a whole MIDI channel at once: one
 * expression fader, one pitch wheel per track. Here every note is its own
 * voice — a recording, an envelope, a fader — so each note of a chord can
 * swell and bend on its own, and a short note can be a different recording
 * from a long one (a real staccato rather than a sustain cut short).
 *
 * The instrument is built from Web Audio nodes in Tone's context, and plugs
 * into the host like a Tone.js instrument (connect, triggerAttack,
 * triggerRelease…), with the voice hooks the host calls between attack and
 * release (shape, bend). What an SFZ file says is read by sfz-parse.js; what
 * a region does with a note — which recording, how loud, how it starts and
 * ends — is worked out by `voicePlan`, which touches no audio.
 *
 * Opcodes read: the key and velocity ranges, crossfades, round robins
 * (seq_length, seq_position), random choice (lorand, hirand), key switches
 * (sw_*), release triggers, choke groups (group, off_by, off_mode), tuning,
 * volume, pan, velocity tracking, the amplitude envelope (ampeg_*, with
 * velocity), delays and offsets, loops (from the file or the opcodes), the
 * pitch LFO, the filter, the three-band EQ, and controllers (set_ccN, and
 * gain, volume, delay, offset and tune by controller).
 */

import { parseSfz, readWav, sfzIncludes } from "./sfz-parse.js";

/** Each recording, by URL, read once for every context: see `recording`. */
const recordings = new Map();

/** Recordings as audio buffers, per audio context: context → Map(url → AudioBuffer). */
const buffers = new WeakMap();

/** Notes shorter than this, in seconds, play the staccato file when there is one. */
const STACCATO_UNDER = 0.3;

/**
 * Seconds over which a loop's end fades into what precedes its start, when
 * the file says nothing (`loop_crossfade`): a loop point is rarely a perfect
 * splice, and without this some recordings click every time round.
 */
const LOOP_CROSSFADE = 0.02;

/** A release ends this far below the level it started from (-60 dB). */
const RELEASE_FLOOR = 0.001;

/**
 * Fetch an SFZ file and every file it includes.
 *
 * @param {string} url
 * @returns {Promise<{url: string, control: Object, regions: Array<Object>}>}
 *   each region's `sample` resolved to a URL
 */
export async function loadSfzFile(url) {
  const absolute = new URL(url, globalThis.location?.href ?? "file:///").href;
  const texts = {};
  const fetchText = async (fileUrl) => {
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`Could not load the SFZ file ${fileUrl} (${response.status})`);
    return response.text();
  };
  const main = await fetchText(absolute);
  const pending = sfzIncludes(main);
  while (pending.length) {
    const path = pending.shift();
    if (path in texts) continue;
    texts[path] = await fetchText(new URL(samplePath(path), absolute).href);
    pending.push(...sfzIncludes(texts[path]));
  }
  const { control, regions } = parseSfz(main, { include: (path) => texts[path] });
  for (const region of regions) {
    if (region.sample) region.sample = new URL(samplePath(region.sample), absolute).href;
  }
  return { url: absolute, control, regions: regions.filter((r) => r.sample && !r.sample.startsWith("*")) };
}

/** A relative path as a URL path: `#` and spaces are part of file names. */
function samplePath(path) {
  return path.split("/").map((part) => (part === ".." || part === "." ? part : encodeURIComponent(part))).join("/");
}

/**
 * A recording, fetched once: a WAV as its samples and loop (see readWav),
 * anything else (FLAC, Ogg) as bytes for the browser to decode.
 */
function recording(url) {
  if (!recordings.has(url)) {
    recordings.set(url, fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`Could not load the recording ${url} (${response.status})`);
      const bytes = await response.arrayBuffer();
      const wav = readWav(bytes);
      if (!wav) return { bytes, loop: null };
      if (wav.loop) crossfadeLoop(wav, LOOP_CROSSFADE);
      return wav;
    }));
  }
  return recordings.get(url);
}

/**
 * Blend the end of a loop into the audio just before its start, so that
 * coming round from the end to the start is seamless: the last frame of the
 * loop becomes the frame that precedes its first. Equal power, since the two
 * are different moments of the same sound rather than the same wave.
 */
export function crossfadeLoop({ channels, sampleRate, loop }, seconds) {
  const length = Math.min(Math.round(seconds * sampleRate), loop.start, Math.floor((loop.end - loop.start) / 2));
  if (length < 2) return;
  for (const samples of channels) {
    for (let i = 0; i < length; i++) {
      const w = (i + 1) / length; // reaches 1 on the loop's last frame
      const at = loop.end - length + 1 + i;
      samples[at] = samples[at] * Math.cos(w * Math.PI / 2) + samples[loop.start - length + i] * Math.sin(w * Math.PI / 2);
    }
  }
}

/** A recording as an audio buffer of a context, at the recording's own rate. */
function bufferIn(context, url) {
  if (!buffers.has(context)) buffers.set(context, new Map());
  const made = buffers.get(context);
  if (!made.has(url)) {
    made.set(url, recording(url).then((file) => {
      // decodeAudioData takes the bytes it is given: each context decodes a copy.
      if (!file.channels) return context.decodeAudioData(file.bytes.slice(0));
      const buffer = context.createBuffer(file.channels.length, file.channels[0].length, file.sampleRate);
      file.channels.forEach((samples, c) => buffer.copyToChannel(samples, c));
      return buffer;
    }));
  }
  return made.get(url);
}

/**
 * Whether a region answers a note, and how much (a crossfade may play it
 * partly).
 *
 * @param {Object} region
 * @param {Object} note
 * @param {number} note.key - MIDI key
 * @param {number} note.velocity - 1 to 127
 * @param {string} note.trigger - "attack" or "release"
 * @param {number} note.random - 0 to 1, the same for every region of a note
 * @param {number} note.round - how many times this key has been played before
 * @param {number|null} note.keyswitch - the last key switch pressed
 * @returns {number} the region's share of the note, 0 when it is silent
 */
export function regionWeight(region, { key, velocity, trigger, random, round, keyswitch }) {
  if (key < (region.lokey ?? 0) || key > (region.hikey ?? 127)) return 0;
  if (velocity < (region.lovel ?? 1) || velocity > (region.hivel ?? 127)) return 0;
  if ((region.trigger ?? "attack") !== trigger) return 0;
  if (random < (region.lorand ?? 0) || random >= (region.hirand ?? 1.0001)) return 0;
  if (region.seq_length > 1 && (round % region.seq_length) + 1 !== (region.seq_position ?? 1)) return 0;
  if (typeof region.sw_last === "number" && keyswitch !== null && keyswitch !== region.sw_last) return 0;
  const byVelocity = crossfade(velocity, region.xfin_lovel, region.xfin_hivel, region.xfout_lovel, region.xfout_hivel, region.xf_velcurve);
  const byKey = crossfade(key, region.xfin_lokey, region.xfin_hikey, region.xfout_lokey, region.xfout_hikey, region.xf_keycurve);
  return byVelocity * byKey;
}

/** A fade in over [inLow, inHigh] and out over [outLow, outHigh], equal power unless "gain". */
function crossfade(value, inLow, inHigh, outLow, outHigh, curve = "power") {
  let share = 1;
  if (inHigh !== undefined && value < inHigh) {
    share *= Math.max(0, (value - (inLow ?? 0)) / Math.max(1, inHigh - (inLow ?? 0)));
  }
  if (outLow !== undefined && value > outLow) {
    share *= Math.max(0, ((outHigh ?? 127) - value) / Math.max(1, (outHigh ?? 127) - outLow));
  }
  return curve === "gain" ? share : Math.sqrt(share);
}

/** The value a controller-driven opcode adds: `gain_cc1=34` adds 34 × cc1/127. */
function byControllers(region, names, controllers) {
  let total = 0;
  for (const [opcode, amount] of Object.entries(region)) {
    const match = /^(\w+?)_(?:on)?cc(\d+)$/.exec(opcode);
    if (match && names.includes(match[1])) total += amount * ((controllers[match[2]] ?? 0) / 127);
  }
  return total;
}

/**
 * What a region does with a note, in numbers: no audio is touched, so this is
 * where the SFZ's meaning lives, and what the tests read.
 *
 * @param {Object} region
 * @param {Object} note
 * @param {number} note.key
 * @param {number} note.velocity - 1 to 127
 * @param {number} note.weight - from regionWeight
 * @param {Object} note.controllers - controller number → 0..127
 * @param {() => number} note.random - uniform in [0, 1)
 * @param {Object} [note.envelope] - the track's own envelope, overriding the
 *   region's: `{ attack, hold, decay, sustain, release }`, seconds, and
 *   sustain as a proportion
 * @param {number} [note.volume=0] - the track's own volume, dB
 */
export function voicePlan(region, { key, velocity, weight, controllers, random, envelope = {}, volume = 0 }) {
  const byVelocity = (opcode) => (region[`ampeg_vel2${opcode}`] ?? 0) * (velocity / 127);
  const spread = (opcode) => (region[opcode] ?? 0) * (random() * 2 - 1);

  const semitones = (key - (region.pitch_keycenter ?? 60)) * ((region.pitch_keytrack ?? 100) / 100) + (region.transpose ?? 0);
  const cents = (region.tune ?? 0) + spread("pitch_random") + byControllers(region, ["tune", "pitch"], controllers);

  const veltrack = (region.amp_veltrack ?? 100) / 100;
  const velocityDb = velocity > 0 ? veltrack * 40 * Math.log10(velocity / 127) : -Infinity;
  const decibels = (region.volume ?? 0) + (region.gain ?? 0) + volume + velocityDb + spread("amp_random")
    + byControllers(region, ["gain", "volume"], controllers);
  const amplitude = (region.amplitude ?? 100) / 100;

  const seconds = (value) => Math.max(0, value);
  return {
    sample: region.sample,
    rate: 2 ** (semitones / 12),
    cents,
    gain: weight * amplitude * 10 ** (decibels / 20),
    pan: (region.pan ?? 0) / 100,
    delay: seconds((region.delay ?? 0) + (region.delay_random ?? 0) * random() + byControllers(region, ["delay"], controllers)),
    offset: seconds((region.offset ?? 0) + (region.offset_random ?? 0) * random() + byControllers(region, ["offset"], controllers)),
    loopMode: region.loop_mode ?? null,
    loopStart: region.loop_start ?? null,
    loopEnd: region.loop_end ?? null,
    group: region.group ?? 0,
    offBy: region.off_by ?? null,
    offMode: region.off_mode ?? "fast",
    envelope: {
      delay: seconds(envelope.delay ?? (region.ampeg_delay ?? 0) + byVelocity("delay")),
      attack: seconds(envelope.attack ?? (region.ampeg_attack ?? 0) + byVelocity("attack")),
      hold: seconds(envelope.hold ?? (region.ampeg_hold ?? 0) + byVelocity("hold")),
      decay: seconds(envelope.decay ?? (region.ampeg_decay ?? 0) + byVelocity("decay")),
      sustain: Math.min(1, seconds(envelope.sustain ?? ((region.ampeg_sustain ?? 100) + byVelocity("sustain")) / 100)),
      release: Math.max(0.005, envelope.release ?? (region.ampeg_release ?? 0) + byVelocity("release")),
    },
    vibrato: region.pitchlfo_depth
      ? {
        rate: region.pitchlfo_freq ?? 5,
        cents: region.pitchlfo_depth,
        delay: region.pitchlfo_delay ?? 0,
        fade: region.pitchlfo_fade ?? 0,
      }
      : null,
    filter: filterPlan(region, velocity),
    eq: [1, 2, 3]
      .map((band) => ({
        frequency: region[`eq${band}_freq`] ?? [50, 500, 5000][band - 1],
        octaves: region[`eq${band}_bw`] ?? 1,
        gain: region[`eq${band}_gain`] ?? 0,
      }))
      .filter((band) => band.gain !== 0),
  };
}

const FILTER_TYPES = {
  lpf_1p: "lowpass", lpf_2p: "lowpass", lpf_4p: "lowpass", lpf_6p: "lowpass",
  hpf_1p: "highpass", hpf_2p: "highpass", hpf_4p: "highpass", hpf_6p: "highpass",
  bpf_1p: "bandpass", bpf_2p: "bandpass", brf_1p: "notch", brf_2p: "notch",
};

function filterPlan(region, velocity) {
  if (region.cutoff === undefined) return null;
  const cents = (region.fil_veltrack ?? 0) * (velocity / 127);
  return {
    type: FILTER_TYPES[region.fil_type ?? "lpf_2p"] ?? "lowpass",
    frequency: Math.min(20000, region.cutoff * 2 ** (cents / 1200)),
    // resonance is in dB; a biquad's Q is a ratio.
    Q: 10 ** ((region.resonance ?? 0) / 20) * Math.SQRT1_2,
  };
}

/**
 * The amplitude envelope's level, `t` seconds after the voice starts: linear
 * attack, hold, then an exponential approach to the sustain level.
 */
export function envelopeLevel({ delay, attack, hold, decay, sustain }, t) {
  if (t < delay) return 0;
  const sinceStart = t - delay;
  if (sinceStart < attack) return sinceStart / attack;
  const sinceHold = sinceStart - attack - hold;
  if (sinceHold < 0) return 1;
  if (decay === 0) return sustain;
  return sustain + (1 - sustain) * Math.exp(-sinceHold / (decay / 5));
}

/** The playback rate that raises a pitch by `cents`. */
function centsRatio(cents) {
  return 2 ** (cents / 1200);
}

/** A small, seeded random generator: the same piece renders the same every time. */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * An SFZ instrument for one track.
 *
 * @param {Object} Tone
 * @param {Object} spec
 * @param {string} spec.sfz - the SFZ file, played for every note by default
 * @param {string} [spec.staccato] - an SFZ file for short notes
 * @param {number} [spec.staccatoUnder=0.3] - seconds: notes shorter than
 *   this play the staccato file
 * @param {Object} [spec.envelope] - `{ attack, hold, decay, sustain,
 *   release }`, overriding the file's own envelope
 * @param {number} [spec.volume=0] - dB
 * @param {Object} [spec.controllers] - starting controller values, over the
 *   file's own `set_ccN`
 */
export function createSfzInstrument(Tone, spec) {
  return new SfzInstrument(Tone, spec);
}

class SfzInstrument {
  constructor(Tone, { sfz, staccato = null, staccatoUnder = STACCATO_UNDER, envelope = {}, volume = 0, controllers = {} }) {
    this.Tone = Tone;
    this.context = Tone.getContext();
    this.isSfz = true;
    this.output = new Tone.Gain(1);
    this.envelope = envelope;
    this.volume = volume;
    this.staccatoUnder = staccatoUnder;
    this.random = seededRandom(1);
    this.voices = [];
    this.rounds = new Map();
    this.files = null;
    this.disposed = false;
    this.controllers = controllers;

    this.loaded = Promise.all([sfz, staccato].map((url) => (url ? loadSfzFile(url) : null)))
      .then(async ([sustain, short]) => {
        const all = [sustain, short].filter(Boolean);
        const urls = new Set(all.flatMap((file) => file.regions.map((r) => r.sample)));
        this.buffers = new Map();
        this.recordings = new Map();
        await Promise.all([...urls].map(async (url) => {
          this.buffers.set(url, await bufferIn(this.context, url));
          this.recordings.set(url, await recording(url));
        }));
        this.files = {
          sustain: this.readyFile(sustain),
          staccato: short ? this.readyFile(short) : null,
        };
      });
  }

  /** A loaded file with its controllers and its key switch state. */
  readyFile(file) {
    const controllers = {};
    for (const [opcode, value] of Object.entries(file.control)) {
      const match = /^set_cc(\d+)$/.exec(opcode);
      if (match) controllers[match[1]] = value;
    }
    Object.assign(controllers, this.controllers);
    const switches = file.regions.filter((r) => typeof r.sw_lokey === "number");
    return {
      ...file,
      controllers,
      switchLow: switches.length ? Math.min(...switches.map((r) => r.sw_lokey)) : null,
      switchHigh: switches.length ? Math.max(...switches.map((r) => r.sw_hikey)) : null,
      keyswitch: file.regions.find((r) => typeof r.sw_default === "number")?.sw_default ?? null,
    };
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

  /** A note name, frequency or MIDI number, as the MIDI key it sounds. */
  midiOf(note) {
    return Math.round(this.exactMidiOf(note));
  }

  /** The same, unrounded: a microtuned note arrives as a frequency. */
  exactMidiOf(note) {
    if (typeof note === "number" && note < 128) return note;
    const hertz = typeof note === "number" ? note : this.Tone.Frequency(note).toFrequency();
    return 69 + 12 * Math.log2(hertz / 440);
  }

  timeOf(time) {
    if (time === undefined) return this.context.currentTime;
    return typeof time === "number" ? time : this.Tone.Time(time).toSeconds();
  }

  /**
   * Start notes.
   *
   * @param {*} notes - one note or several
   * @param {number} [time]
   * @param {number} [velocity=1] - 0 to 1
   * @param {number} [seconds] - how long the notes will last, when known:
   *   a short one plays the staccato file, if it has that key
   */
  triggerAttack(notes, time, velocity = 1, seconds = Infinity) {
    if (!this.files) return this;
    const at = this.timeOf(time);
    const short = this.files.staccato && seconds < this.staccatoUnder;
    const vel = Math.max(1, Math.min(127, Math.round(velocity * 127)));
    for (const note of [].concat(notes)) {
      const exact = this.exactMidiOf(note);
      const key = Math.round(exact);
      const round = this.rounds.get(key) ?? 0;
      this.rounds.set(key, round + 1);
      const attack = { key, velocity: vel, trigger: "attack", round, cents: (exact - key) * 100 };
      const played = short ? this.startNote(this.files.staccato, attack, at) : 0;
      if (played === 0) this.startNote(this.files.sustain, attack, at);
    }
    return this;
  }

  /** @returns {number|null} how many voices the note started; null for a key switch, which sounds nothing */
  startNote(file, attack, at) {
    // A key switch changes what the next notes play and makes no sound.
    if (file.switchLow !== null && attack.key >= file.switchLow && attack.key <= file.switchHigh) {
      file.keyswitch = attack.key;
      return null;
    }
    return this.startRegions(file, attack, at).length;
  }

  startRegions(file, { key, velocity, trigger, round, cents = 0 }, at) {
    const random = this.random();
    const note = { key, velocity, trigger, random, round, keyswitch: file.keyswitch };
    const started = [];
    for (const region of file.regions) {
      const weight = regionWeight(region, note);
      if (weight === 0) continue;
      const plan = voicePlan(region, {
        key,
        velocity,
        weight,
        controllers: file.controllers,
        random: this.random,
        envelope: this.envelope,
        volume: this.volume,
      });
      plan.cents += cents;
      this.chokeGroup(plan.group, at);
      started.push(this.startVoice(plan, key, velocity, at, file));
    }
    return started;
  }

  /** A voice of group `group` starting silences the voices it turns off (off_by). */
  chokeGroup(group, at) {
    if (!group) return;
    for (const voice of this.voices) {
      if (voice.plan.offBy === group && voice.start < at && voice.releasedAt > at) {
        this.releaseVoice(voice, at, voice.plan.offMode === "normal" ? voice.plan.envelope.release : 0.006);
      }
    }
  }

  startVoice(plan, key, velocity, at, file) {
    const ctx = this.context;
    const buffer = this.buffers.get(plan.sample);
    const fileLoop = this.recordings.get(plan.sample).loop;
    const frameRate = buffer.sampleRate;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    // Firefox's buffer sources have no `detune`: tuning, bends and vibrato
    // all move the playback rate.
    const rate = plan.rate * centsRatio(plan.cents);
    source.playbackRate.value = rate;
    const loopMode = plan.loopMode ?? (fileLoop || plan.loopStart !== null ? "loop_continuous" : "no_loop");
    if (loopMode === "loop_continuous" || loopMode === "loop_sustain") {
      const start = plan.loopStart ?? fileLoop?.start;
      const end = plan.loopEnd ?? fileLoop?.end;
      if (start !== undefined && end !== undefined && end > start) {
        source.loop = true;
        source.loopStart = start / frameRate;
        source.loopEnd = (end + 1) / frameRate;
      }
    }

    // source → filter → EQ → envelope → shape → pan → the track
    const chain = [source];
    if (plan.filter) {
      const filter = ctx.createBiquadFilter();
      filter.type = plan.filter.type;
      filter.frequency.value = plan.filter.frequency;
      filter.Q.value = plan.filter.Q;
      chain.push(filter);
    }
    for (const band of plan.eq) {
      const eq = ctx.createBiquadFilter();
      eq.type = "peaking";
      eq.frequency.value = band.frequency;
      eq.Q.value = 1 / (2 * Math.sinh((Math.LN2 / 2) * band.octaves));
      eq.gain.value = band.gain;
      chain.push(eq);
    }
    const envelopeGain = ctx.createGain();
    // Silent until its envelope starts: a gain is 1 before its first event,
    // and a recording that begins mid-wave would click for a frame.
    envelopeGain.gain.value = 0;
    const shapeGain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, plan.pan));
    chain.push(envelopeGain, shapeGain, panner);
    for (let k = 0; k + 1 < chain.length; k++) chain[k].connect(chain[k + 1]);
    panner.connect(this.output.input);

    const start = at + plan.delay;
    const env = plan.envelope;
    const level = envelopeGain.gain;
    level.setValueAtTime(0, start);
    level.setValueAtTime(0, start + env.delay);
    level.linearRampToValueAtTime(plan.gain, start + env.delay + env.attack);
    const holdEnd = start + env.delay + env.attack + env.hold;
    level.setValueAtTime(plan.gain, holdEnd);
    if (env.sustain < 1) {
      if (env.decay > 0) level.setTargetAtTime(plan.gain * env.sustain, holdEnd, env.decay / 5);
      else level.setValueAtTime(plan.gain * env.sustain, holdEnd);
    }

    let vibrato = null;
    if (plan.vibrato) {
      vibrato = { oscillator: ctx.createOscillator(), depth: ctx.createGain() };
      vibrato.oscillator.frequency.value = plan.vibrato.rate;
      vibrato.depth.gain.setValueAtTime(0, start);
      vibrato.depth.gain.setValueAtTime(0, start + plan.vibrato.delay);
      // The swing, in playback rate: as many cents either way.
      const swing = rate * (centsRatio(plan.vibrato.cents) - 1);
      vibrato.depth.gain.linearRampToValueAtTime(swing, start + plan.vibrato.delay + plan.vibrato.fade);
      vibrato.oscillator.connect(vibrato.depth);
      vibrato.depth.connect(source.playbackRate);
      vibrato.oscillator.start(start);
    }

    source.start(start, Math.min(plan.offset / frameRate, buffer.duration));
    const voice = {
      key, velocity, start, plan, file, source, rate, level, shape: shapeGain.gain, vibrato,
      nodes: chain, oneShot: loopMode === "one_shot", releasedAt: Infinity,
    };
    source.onended = () => {
      for (const node of chain) node.disconnect();
      vibrato?.oscillator.stop();
      vibrato?.depth.disconnect();
      this.voices = this.voices.filter((v) => v !== voice);
    };
    this.voices.push(voice);
    return voice;
  }

  /**
   * Let a voice go at `at`: from wherever its envelope is then, down 60 dB
   * over `seconds`, the way a string or a room dies away.
   */
  releaseVoice(voice, at, seconds = voice.plan.envelope.release) {
    if (voice.releasedAt <= at) return;
    voice.releasedAt = at;
    const env = voice.plan.envelope;
    const now = Math.max(at, voice.start);
    const reached = voice.plan.gain * envelopeLevel(env, now - voice.start);
    voice.level.cancelScheduledValues(now);
    if (now < voice.start + env.delay + env.attack) voice.level.linearRampToValueAtTime(reached, now);
    else voice.level.setValueAtTime(reached, now);
    if (reached > 0) voice.level.exponentialRampToValueAtTime(reached * RELEASE_FLOOR, now + seconds);
    voice.source.stop(now + (reached > 0 ? seconds : 0));
  }

  triggerRelease(notes, time) {
    if (!this.files) return this;
    const at = this.timeOf(time);
    for (const note of [].concat(notes)) this.releaseKey(this.midiOf(note), at);
    return this;
  }

  releaseKey(key, at) {
    const held = this.voices.filter((v) => v.key === key && v.trigger !== "release" && v.releasedAt === Infinity);
    if (held.length === 0) return;
    // A release trigger plays the sound of the note ending (the bow leaving the string).
    const { file, velocity } = held[0];
    for (const voice of held) {
      if (!voice.oneShot) this.releaseVoice(voice, at);
    }
    for (const voice of this.startRegions(file, { key, velocity, trigger: "release", round: 0 }, at)) {
      voice.trigger = "release";
    }
  }

  triggerAttackRelease(notes, duration, time, velocity = 1) {
    const at = this.timeOf(time);
    const seconds = this.timeOf(duration);
    this.triggerAttack(notes, at, velocity, seconds);
    this.triggerRelease(notes, at + seconds);
    return this;
  }

  /** The voices a note started at `startTime`. */
  voicesOf(key, startTime) {
    return this.voices.filter((v) => v.key === key && v.trigger !== "release" && Math.abs(v.start - v.plan.delay - startTime) < 1e-6);
  }

  /**
   * A note's loudness curve, on that note's own fader, then its release.
   *
   * @param {number} midi
   * @param {number} startTime - seconds
   * @param {Array<{time:number,value:number}>} anchors - seconds from the
   *   start, values as a proportion of the velocity
   * @param {{seconds:number}} options
   * @returns {boolean} true: the note is released here
   */
  shape(midi, startTime, anchors, { seconds }) {
    const voices = this.voicesOf(midi, startTime);
    if (voices.length === 0 || !Array.isArray(anchors) || anchors.length === 0) return false;
    for (const voice of voices) {
      voice.shape.setValueAtTime(Math.max(0, anchors[0].value), startTime);
      for (const point of anchors) {
        voice.shape.linearRampToValueAtTime(Math.max(0, point.value), startTime + Math.max(0, point.time));
      }
    }
    this.releaseKey(midi, startTime + seconds);
    return true;
  }

  /**
   * A note's pitch curve, on that note's own voices.
   *
   * @param {number} midi
   * @param {number} startTime - seconds
   * @param {Array<{time:number,value:number}>} anchors - seconds from the
   *   start, cents from the written pitch
   * @param {number} [baseCents=0] - a constant offset (microtuning)
   * @returns {boolean} true: the note bends
   */
  bend(midi, startTime, anchors, baseCents = 0) {
    const voices = this.voicesOf(midi, startTime);
    if (voices.length === 0 || !Array.isArray(anchors) || anchors.length === 0) return false;
    for (const voice of voices) {
      const rate = voice.source.playbackRate;
      const at = (cents) => voice.rate * centsRatio(baseCents + cents);
      rate.setValueAtTime(at(anchors[0].value), startTime + Math.max(0, anchors[0].time));
      for (const point of anchors.slice(1)) rate.linearRampToValueAtTime(at(point.value), startTime + point.time);
    }
    return true;
  }

  releaseAll(time) {
    const at = this.timeOf(time);
    for (const voice of this.voices) this.releaseVoice(voice, at);
    return this;
  }

  dispose() {
    if (this.disposed) return this;
    this.disposed = true;
    for (const voice of this.voices) {
      try { voice.source.stop(); } catch { /* not started */ }
    }
    this.voices = [];
    this.output.dispose();
    return this;
  }
}
