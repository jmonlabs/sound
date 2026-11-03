/**
 * Instruments written in Faust (https://faust.grame.fr): a `.dsp` file played
 * by a track.
 *
 *     { label: "Voice", synth: { faust: "/instruments/voice.dsp", params: { bright: 0.7 } } }
 *
 * The `.dsp` is compiled in the browser the first time a track asks for it,
 * by faustwasm (https://github.com/grame-cncm/faustwasm, LGPL-3.0), shipped
 * beside this package (vendor/faustwasm). The library and its compiler, about
 * 6 MB, are only fetched then: a piece without Faust loads nothing more.
 *
 * Mono or poly is the DSP's own choice, as in Faust: `declare options
 * "[nvoices:8]";` makes it polyphonic. The DSP's `freq`, `gain` and `gate`
 * controls play the notes. A control marked `[midi:ctrl 74]` follows the
 * piece's controller 74, one marked `[midi:pitchwheel]` its pitch bend.
 *
 * Each voice is one instance of the DSP, and each of its controls an
 * AudioParam the notes are scheduled on, sample by sample: a note can glide
 * (`bend`), swell (a loudness curve) and sit between two semitones, inside the
 * DSP itself. A monophonic DSP has one voice. Notes that overlap are tied: the
 * pitch moves and `gate` stays up. Notes that only touch start again. A
 * polyphonic DSP has as many voices as it declares, and each note takes the
 * voice that has been free the longest; with none free, the one that has
 * sounded the longest. A track's `voices` overrides the DSP's. If the DSP
 * defines `effect`, as Faust allows, the effect is one instance more, after
 * the voices are mixed.
 *
 * Compiling a DSP with a mistake prints "Aborted(... exception catching is not
 * enabled ...)" in the console: the compiler's own noise, which stops nothing.
 */

/** The engine shipped with this package, beside it (vendor/faustwasm). */
const ENGINE = {
  library: new URL("../vendor/faustwasm/faustwasm.js", import.meta.url).href,
  compiler: new URL("../vendor/faustwasm/libfaust-wasm/libfaust-wasm.js", import.meta.url).href,
};
let engine = ENGINE;

/** faustwasm, loaded once per page. */
let library = null;
/** The compiler, loaded once per page: Promise<FaustCompiler>. */
let compiler = null;
/** Each `.dsp` compiled once per page: url → Promise<{ voice, voices, effect }>. */
const compiled = new Map();

/**
 * Say where faustwasm is, if not beside this package; or go back to it (null).
 * Forgets what was loaded and compiled.
 *
 * @param {Object|null} options
 * @param {string} [options.library] - URL of faustwasm as one ES module
 * @param {string} [options.compiler] - URL of `libfaust-wasm.js`, with its
 *   `.data` and `.wasm` beside it
 */
export function useFaust(options) {
  engine = options ? { ...ENGINE, ...options } : ENGINE;
  library = null;
  compiler = null;
  compiled.clear();
}

/** Seconds the gate stays down between two notes that touch, so the second one starts again. */
const RETRIGGER = 0.003;

/**
 * faustwasm's nodes extend whatever `AudioWorkletNode` is on `globalThis`
 * when the library loads. Tone builds its graph with standardized-audio-context,
 * whose nodes only connect to each other, so the library is loaded with that
 * class in place. Tone's class is found by building one throwaway node of it.
 */
async function loadLibrary(context) {
  const source = `registerProcessor("jmon-faust-probe", class extends AudioWorkletProcessor { process() { return false; } });`;
  await context.rawContext.audioWorklet.addModule(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
  const probe = context.createAudioWorkletNode("jmon-faust-probe", { numberOfInputs: 0, numberOfOutputs: 1 });
  const browserClass = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = probe.constructor;
  try {
    return await import(engine.library);
  } finally {
    globalThis.AudioWorkletNode = browserClass;
  }
}

function loadCompiler(faust) {
  return faust
    .instantiateFaustModuleFromFile(engine.compiler)
    .then((module) => new faust.FaustCompiler(new faust.LibFaust(module)));
}

/**
 * Compile a `.dsp` once. Each voice is an instance of it; a polyphonic DSP's
 * `effect`, if it has one, is compiled on its own, as faustwasm does.
 */
async function compile(faust, url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load the Faust instrument ${url} (${response.status})`);
  const code = await response.text();
  const name = url.split("/").pop().replace(/\.dsp$/, "").replace(/\W/g, "_");
  const voice = await new faust.FaustMonoDspGenerator().compile(await compiler, name, code, "-ftz 2");
  if (!voice) throw new Error(`Faust could not compile ${url}`);
  const voices = declaredVoices(voice.getMeta());
  const effectCode = `dsp_code = environment{\n${code}\n};\nprocess = dsp_code.effect;`;
  const effect = definesEffect(code)
    ? await new faust.FaustMonoDspGenerator().compile(await compiler, `${name}_effect`, effectCode, "-ftz 2")
    : null;
  return { voice, voices, effect };
}

/**
 * How many voices a compiled DSP declares (`[nvoices:N]` in its options), or
 * 0 for a monophonic one.
 *
 * @param {Object} meta - the DSP's JSON description
 */
export function declaredVoices(meta) {
  const options = (meta?.meta ?? []).find((m) => m.options)?.options ?? "";
  return Number(options.match(/\[nvoices:(\d+)\]/)?.[1] ?? 0);
}

/** Whether a DSP's code defines `effect`, the part a polyphonic DSP plays once, after its voices. */
export function definesEffect(code) {
  return /^\s*effect\s*=/m.test(code.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
}

/**
 * Of a DSP's voices, the one a note starting at `at` takes: the one that has
 * been free the longest, or with none free, the one that has sounded the
 * longest. Both are the voice whose last note ends first.
 *
 * @param {Array<{end: number}>} voices
 */
export function pickVoice(voices) {
  return voices.reduce((best, voice) => (voice.end < best.end ? voice : best));
}

/** One instance of the DSP, and the note it is playing. */
class Voice {
  constructor(node) {
    this.node = node;
    this.paths = {};
    for (const path of node.getParams()) {
      const control = path.split("/").pop();
      if (["freq", "gain", "gate"].includes(control)) this.paths[control] = path;
    }
    this.key = null;
    this.start = -Infinity;
    this.end = -Infinity;
  }

  /** One of the note controls, as the AudioParam its automation goes on. */
  param(control) {
    return this.paths[control] ? this.node.parameters.get(this.paths[control]) : null;
  }

  /**
   * Start a note at `at`. Tied, the gate stays up and only the pitch moves.
   * Otherwise, if the voice may still be sounding, the gate dips first, so
   * the DSP's envelope starts again.
   */
  play(hz, velocity, at, tied) {
    const gate = this.param("gate");
    // The release the last note scheduled is dropped: this note takes over.
    gate?.cancelScheduledValues(at);
    if (tied) gate?.setValueAtTime(1, at);
    else if (this.end > at - RETRIGGER) {
      gate?.setValueAtTime(0, at);
      gate?.setValueAtTime(1, at + RETRIGGER);
    } else {
      gate?.setValueAtTime(1, at);
    }
    this.param("freq")?.cancelScheduledValues(at);
    this.param("freq")?.setValueAtTime(hz, at);
    this.param("gain")?.cancelScheduledValues(at);
    this.param("gain")?.setValueAtTime(velocity, at);
  }

  release(at) {
    this.param("gate")?.setValueAtTime(0, at);
    this.end = at;
  }
}

/**
 * Build the instrument a `{ faust }` spec asks for.
 *
 * @param {Object} Tone
 * @param {Object} spec
 * @param {string} spec.faust - URL of the `.dsp` file
 * @param {Object} [spec.params] - starting values of the DSP's controls, by
 *   name: `{ bright: 0.7 }`
 * @param {number} [spec.voices] - how many notes at once, over the DSP's own
 *   `nvoices`: 2 lets a monophonic DSP play double stops
 * @param {number} [spec.volume=0] - dB
 */
export function createFaustInstrument(Tone, spec) {
  return new FaustInstrument(Tone, spec);
}

class FaustInstrument {
  constructor(Tone, { faust: url, params = {}, voices = null, volume = 0 }) {
    this.Tone = Tone;
    this.context = Tone.getContext();
    this.isFaust = true;
    this.output = new Tone.Gain(Tone.dbToGain(volume));
    this.voices = [];
    this.effect = null;
    this.poly = false;
    this.disposed = false;

    this.loaded = (async () => {
      library ??= loadLibrary(this.context);
      const faust = await library;
      compiler ??= loadCompiler(faust);
      if (!compiled.has(url)) compiled.set(url, compile(faust, url));
      const dsp = await compiled.get(url);
      if (this.disposed) return;
      const raw = this.context.rawContext;
      const count = voices ?? (dsp.voices || 1);
      this.poly = count > 1;
      for (let i = 0; i < count; i++) {
        const node = await dsp.voice.createNode(raw);
        if (!node) throw new Error(`Faust could not start ${url}`);
        this.voices.push(new Voice(node));
      }
      this.effect = dsp.effect ? await dsp.effect.createNode(raw) : null;
      for (const [name, value] of Object.entries(params)) this.setControl(name, value);
      for (const voice of this.voices) this.Tone.connect(voice.node, this.effect ?? this.output);
      if (this.effect) this.Tone.connect(this.effect, this.output);
    })();
  }

  /** Every node: the voices, then the effect. */
  get nodes() {
    return [...this.voices.map((v) => v.node), ...(this.effect ? [this.effect] : [])];
  }

  /** Set a control by its name or its path, in every node that has it. */
  setControl(name, value, time) {
    for (const node of this.nodes) {
      const path = node.getParams().find((p) => p === name || p.endsWith(`/${name}`));
      if (path) node.setParamValue(path, value, time);
    }
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

  /** Tone's instruments take options this way; a Faust instrument has its own controls. */
  set() {
    return this;
  }

  timeOf(time) {
    if (time === undefined) return this.context.currentTime;
    return typeof time === "number" ? time : this.Tone.Time(time).toSeconds();
  }

  /** A note name, or a number in Hz as Tone takes it (the player sends a tuned note that way), as Hz. */
  frequencyOf(note) {
    return typeof note === "number" ? note : this.Tone.Frequency(note).toFrequency();
  }

  /** The key a note is known by, for its release, bend and loudness curve: its nearest MIDI number. */
  keyOf(note) {
    return Math.round(this.Tone.Frequency(this.frequencyOf(note)).toMidi());
  }

  /** The voices playing a note that started at `startTime`. */
  voicesOf(midi, startTime) {
    const key = Math.round(midi);
    return this.voices.filter((v) => v.key === key && Math.abs(v.start - startTime) < 1e-6);
  }

  triggerAttack(notes, time, velocity = 1, seconds = Infinity) {
    if (this.voices.length === 0) return this;
    const at = this.timeOf(time);
    for (const note of [].concat(notes)) {
      const voice = this.poly ? pickVoice(this.voices) : this.voices[0];
      voice.play(this.frequencyOf(note), velocity, at, !this.poly && at < voice.end);
      voice.key = this.keyOf(note);
      voice.start = at;
      voice.end = at + seconds;
    }
    return this;
  }

  triggerRelease(notes, time) {
    const at = this.timeOf(time);
    for (const note of [].concat(notes)) {
      const key = this.keyOf(note);
      // The latest note of that key: in a monophonic DSP, only if no other note took over.
      const voice = this.voices
        .filter((v) => v.key === key && v.start <= at)
        .reduce((latest, v) => (!latest || v.start > latest.start ? v : latest), null);
      voice?.release(at);
    }
    return this;
  }

  triggerAttackRelease(notes, duration, time, velocity = 1) {
    const at = this.timeOf(time);
    const seconds = this.timeOf(duration);
    this.triggerAttack(notes, at, velocity, seconds);
    return this.triggerRelease(notes, at + seconds);
  }

  /** A controller move, value 0..1: reaches the controls marked `[midi:ctrl n]`. */
  controllerChange(controller, value, time) {
    const midiValue = Math.round(Math.max(0, Math.min(1, value)) * 127);
    for (const node of this.nodes) node.ctrlChange(0, controller, midiValue, this.timeOf(time));
  }

  /** A pitch bend, -1..1: reaches the controls marked `[midi:pitchwheel]`. */
  pitchBend(value, time) {
    const wheel = Math.round((Math.max(-1, Math.min(1, value)) + 1) * 8191.5);
    for (const node of this.nodes) node.pitchWheel(0, wheel, this.timeOf(time));
  }

  /**
   * Glide a sounding note along a curve, by moving its voice's `freq`.
   *
   * @param {number} midi
   * @param {number} startTime - seconds
   * @param {Array<{time:number,value:number}>} anchors - seconds from the
   *   note's start, cents from the written pitch
   * @param {number} [baseCents=0]
   */
  bend(midi, startTime, anchors, baseCents = 0) {
    const voices = this.voicesOf(midi, startTime).filter((v) => v.param("freq"));
    if (voices.length === 0 || anchors.length === 0) return false;
    const hz = (cents) => this.Tone.Frequency(midi, "midi").toFrequency() * 2 ** ((cents + baseCents) / 1200);
    for (const voice of voices) {
      const freq = voice.param("freq");
      freq.setValueAtTime(hz(anchors[0].value), startTime + Math.max(0, anchors[0].time));
      // A ramp in Hz that is exponential is a straight line in pitch.
      for (const a of anchors.slice(1)) freq.exponentialRampToValueAtTime(hz(a.value), startTime + a.time);
    }
    return true;
  }

  /**
   * Move a sounding note's loudness through a curve, by moving its voice's
   * `gain`, then let the note go at its end.
   *
   * @param {Array<{time:number,value:number}>} anchors - seconds from the
   *   note's start, as a multiple of its velocity
   */
  shape(midi, startTime, anchors, { seconds, velocity = 1 } = {}) {
    const voices = this.voicesOf(midi, startTime).filter((v) => v.param("gain"));
    if (voices.length === 0 || anchors.length === 0) return false;
    for (const voice of voices) {
      const gain = voice.param("gain");
      gain.setValueAtTime(anchors[0].value * velocity, startTime + Math.max(0, anchors[0].time));
      for (const a of anchors.slice(1)) gain.linearRampToValueAtTime(a.value * velocity, startTime + a.time);
      voice.release(startTime + seconds);
    }
    return true;
  }

  releaseAll(time) {
    const at = this.timeOf(time);
    for (const voice of this.voices) {
      voice.param("gate")?.cancelScheduledValues(at);
      voice.release(at);
    }
    return this;
  }

  dispose() {
    this.disposed = true;
    for (const node of this.nodes) {
      node.disconnect();
      node.destroy?.();
    }
    this.output.dispose();
    return this;
  }
}
