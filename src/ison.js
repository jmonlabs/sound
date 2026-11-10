/**
 * ison: an instrument said in words rather than built, the way a piece is
 * said in JMON. A JSON object (the schema is at github.com/jmonlabs/ison)
 * that names the sounds the instrument takes (`sources`: anything this
 * package already plays, a SoundFont program, an SFZ file, a Faust DSP, a
 * General MIDI program, a Tone synth), the ways it is played (`modes`, one
 * source and what to ask of it each, chosen per note with `variant`), how it
 * is played (`play`: how long a bow lasts, when the vibrato comes, the shape of
 * a stroke), its level and envelope, and its continuous controls by name.
 *
 * Two halves, kept apart on purpose:
 *
 *   - `performIson` is pure: the notes of a track, played the way the
 *     instrument says. A host calls it before scheduling (see `performPiece`
 *     in index.js), so the strokes and the variants it writes are then played
 *     like any note.
 *   - `createIsonInstrument` builds the instrument: one node per source (a
 *     SoundFont's modes are one node with `variants`), a note going to its
 *     mode's node, all of them into one output at the instrument's level.
 */

/** Whether a track's `synth` is an ison object. */
export function isIsonSpec(spec) {
  return Boolean(spec) && typeof spec === "object" && spec.format === "ison";
}

/**
 * An ison with some of its values changed: a piece's own settings over the
 * instrument's, as a preset is turned on a synthesizer. Objects are merged
 * level by level, so `ison(violin, { play: { bow: { gap: 0.05 } } })` changes
 * the gap and nothing else; anything that is not an object (a number, a
 * string, a list) replaces. Neither argument is touched.
 *
 * @param {Object} base - an ison
 * @param {Object} [changes] - the same shape, partial
 * @returns {Object} a new ison
 */
export function ison(base, changes = {}) {
  return merge(base, changes);
}

function merge(base, changes) {
  if (!isPlainObject(base) || !isPlainObject(changes)) return changes === undefined ? base : changes;
  const out = { ...base };
  for (const [key, value] of Object.entries(changes)) out[key] = merge(base[key], value);
  return out;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The mode a note plays in when it names none: `mode`, or the first of `modes`. */
export function defaultMode(ison) {
  const names = Object.keys(ison.modes ?? {});
  return ison.mode ?? names[0];
}

/**
 * The notes of a track, played the way the instrument says (`play`). Pure: a
 * new list, the notes untouched.
 *
 * - `bow`: a note longer than a bow (`max` beats, and never longer than its
 *   mode's recording `holds`) is played in equal strokes, a bow change between
 *   them: `gap` beats of silence, the next stroke at `change` of the velocity.
 *   With `grid`, the strokes are cut where the piece's time is a multiple of
 *   `grid` beats instead, so every voice changes bow together.
 * - `vibrato`: a stroke of `from` beats or more plays in the mode named,
 *   unless the note chose its own variant.
 * - `stroke`: the shape of a stroke, the four numbers `bow` in jmon/algo
 *   takes (attack, swell, peak, fade), as the note's `dynamics`; a note that
 *   has its own keeps it.
 *
 * A note whose mode has `layers` then becomes one note per layer, each in the
 * layer's mode: `transpose` semitones away, `delay` seconds later (and as much
 * shorter, so the layers end together), `db` louder or softer (through the
 * velocity), `detune` cents off. `spread` (`{ cents, delay }`) moves each
 * layer of each note by a different amount within those bounds, the same on
 * every play: two notes never sound quite alike.
 *
 * @param {Object} ison
 * @param {Array} notes - JMON notes
 * @param {{tempo?: number}} [options] - the piece's tempo, to turn the
 *   seconds a recording holds into beats
 * @returns {Array} JMON notes
 */
export function performIson(ison, notes, { tempo = 120 } = {}) {
  const play = ison.play ?? {};
  const modes = ison.modes ?? {};
  const base = defaultMode(ison);
  const holdsBeats = (name) => (modes[name]?.holds > 0 ? (modes[name].holds * tempo) / 60 : Infinity);
  const out = [];
  for (const note of notes ?? []) {
    if (!note || note.pitch === null || note.pitch === undefined || !(note.duration > 0)) {
      out.push({ ...note });
      continue;
    }
    const own = note.variant && modes[note.variant] ? note.variant : null;
    const vibrato = !own && play.vibrato?.mode && modes[play.vibrato.mode] ? play.vibrato : null;
    let strokes = [{ ...note }];
    if (play.bow && !modes[own ?? base]?.oneShot) {
      // A stroke lasts a bow at most, and not longer than what the recording
      // of any mode it may play in holds.
      let max = Math.min(play.bow.max ?? Infinity, holdsBeats(own ?? base));
      if (vibrato) max = Math.min(max, holdsBeats(vibrato.mode));
      const gap = play.bow.gap ?? 0;
      const change = play.bow.change ?? 1;
      const end = note.time + note.duration;
      // Where the strokes start: on the piece's grid, or in equal parts.
      const starts = [note.time];
      if (play.bow.grid > 0) {
        const grid = play.bow.grid;
        for (let t = (Math.floor(note.time / grid + 1e-9) + 1) * grid; t < end - 1e-9; t += grid) starts.push(t);
      } else if (Number.isFinite(max) && max > 0) {
        const count = Math.ceil(note.duration / max - 1e-9);
        for (let k = 1; k < count; k++) starts.push(note.time + (k * note.duration) / count);
      }
      // A stroke still no longer than a bow: cut again where it would be.
      if (Number.isFinite(max) && max > 0) {
        for (let k = 0; k < starts.length; k++) {
          const next = starts[k + 1] ?? end;
          if (next - starts[k] > max + 1e-9) starts.splice(k + 1, 0, starts[k] + max);
        }
      }
      if (starts.length > 1) {
        strokes = starts.map((start, k) => {
          const next = starts[k + 1] ?? end;
          return {
            ...note,
            time: start,
            duration: Math.max(0.05, next - start - (k === starts.length - 1 ? 0 : gap)),
            velocity: (note.velocity ?? 0.8) * (k === 0 ? 1 : change),
          };
        });
      }
    }
    for (const stroke of strokes) {
      if (!stroke.variant && vibrato && stroke.duration >= (vibrato.from ?? 0)) stroke.variant = vibrato.mode;
      if (play.stroke && !stroke.dynamics) stroke.dynamics = strokeShape(stroke.duration, play.stroke);
      const layers = modes[stroke.variant ?? base]?.layers;
      if (Array.isArray(layers) && layers.length > 0) out.push(...layered(stroke, layers, modes, tempo));
      else out.push(stroke);
    }
  }
  return out;
}

/** One note per layer of its mode (see performIson). */
function layered(note, layers, modes, tempo) {
  const out = [];
  layers.forEach((layer, index) => {
    if (!layer?.mode || !modes[layer.mode] || modes[layer.mode].layers) return;
    const random = seeded(`${note.time}:${note.pitch}:${index}`);
    const spreadCents = (layer.spread?.cents ?? 0) * (2 * random() - 1);
    const spreadDelay = (layer.spread?.delay ?? 0) * random();
    const delayBeats = (((layer.delay ?? 0) + spreadDelay) * tempo) / 60;
    const duration = note.duration - delayBeats;
    if (!(duration > 0.05)) return;
    const cents = (layer.detune ?? 0) + spreadCents;
    out.push({
      ...note,
      variant: layer.mode,
      pitch: note.pitch + (layer.transpose ?? 0),
      time: note.time + delayBeats,
      duration,
      velocity: Math.min(1, (note.velocity ?? 0.8) * Math.pow(10, (layer.db ?? 0) / 20)),
      ...(cents ? { tuning: (note.tuning ?? 0) + cents / 100 } : {}),
    });
  });
  return out;
}

/** A little random generator from a text: the same text, the same numbers. */
function seeded(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** Whether an ison has a mode made of layers. */
export function hasLayers(ison) {
  return Object.values(ison?.modes ?? {}).some((mode) => Array.isArray(mode?.layers) && mode.layers.length > 0);
}

/**
 * The loudness curve of one stroke, as `bow` in jmon/algo draws it: a rise,
 * a swell to the peak, an easing to the end. Beats from the stroke's start,
 * values as a proportion of its velocity.
 */
function strokeShape(duration, { attack = 0.25, swell = 0.35, peak = 0.6, fade = 0.25, minDuration = 1 } = {}) {
  const rise = Math.min(attack, duration / 3);
  if (duration < minDuration) {
    return [{ time: 0, value: 0 }, { time: rise, value: 1 }, { time: duration, value: 1 }];
  }
  return [
    { time: 0, value: 0 },
    { time: rise, value: 1 - swell },
    { time: Math.max(rise, duration * peak), value: 1 },
    { time: duration, value: 1 - fade },
  ];
}

/** The `controls` of an ison that go to a controller number, as `{ cc: 0..127 }` starting values. */
function controllerDefaults(ison) {
  const out = {};
  for (const control of Object.values(ison.controls ?? {})) {
    if (typeof control?.cc === "number" && typeof control.default === "number") {
      out[control.cc] = Math.max(0, Math.min(127, Math.round(control.default * 127)));
    }
  }
  return out;
}

/** The `controls` of an ison that go to a parameter by name, as starting values. */
function paramDefaults(ison) {
  const out = {};
  for (const control of Object.values(ison.controls ?? {})) {
    if (typeof control?.param === "string" && control.default !== undefined) out[control.param] = control.default;
  }
  return out;
}

/**
 * The instrument, as the host expects one: connect, triggerAttack,
 * triggerRelease, the voice hooks (shape, bend, hold) and the controller
 * moves, each going to the node of the note's mode.
 *
 * @param {Object} Tone
 * @param {Object} ison
 * @param {Object} options
 * @param {Function} options.create - this package's `create`, to build each
 *   source (given rather than imported, so this file does not import index.js)
 * @param {Object} options.hooks - `{ shapeVoices, bendVoices, holdVoices }`,
 *   the same, to reach a source's voices
 * @param {Array} [options.notes] - the track's notes, for a source that preloads
 */
export function createIsonInstrument(Tone, ison, { create, hooks, notes } = {}) {
  return new IsonInstrument(Tone, ison, { create, hooks, notes });
}

class IsonInstrument {
  constructor(Tone, ison, { create, hooks, notes }) {
    this.Tone = Tone;
    this.ison = ison;
    this.hooks = hooks ?? {};
    this.isIson = true;
    this.disposed = false;
    const db = ison.level?.db ?? 0;
    this.output = new Tone.Gain(Math.pow(10, db / 20));
    this.velocityCurve = ison.level?.velocity ?? "linear";
    this.nodes = []; // every source node, once
    this.byMode = {}; // mode name → node
    this.sounding = new Map(); // MIDI note → the node playing it

    const sources = ison.sources ?? {};
    const sourceNames = Object.keys(sources);
    let modes = Object.entries(ison.modes ?? {}).filter(([, mode]) => !mode?.layers); // a mode of layers has no sound of its own
    if (modes.length === 0 && sourceNames.length > 0) modes.push([sourceNames[0], { source: sourceNames[0] }]);
    const base = ison.mode ?? modes[0]?.[0];
    // Only the modes the track's notes ask for are built: a synth runs whether
    // it plays or not, and a SoundFont variant takes a channel. Without the
    // notes, every mode.
    if (Array.isArray(notes)) {
      const layersOf = (name) => (ison.modes?.[name]?.layers ?? []).map((layer) => layer.mode);
      const asked = new Set([base, ...layersOf(base), ...notes.map((note) => note?.variant).filter(Boolean)]);
      modes = modes.filter(([name]) => asked.has(name));
    }

    // The modes of one source, together: a SoundFont plays its modes as the
    // variants of one instrument; any other source is one node per mode.
    const grouped = new Map();
    for (const [name, mode] of modes) {
      const key = mode.source ?? sourceNames[0];
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push([name, mode]);
    }
    for (const [sourceName, list] of grouped) {
      const source = sources[sourceName];
      if (!source) {
        console.warn(`[ison] ${ison.name ?? "instrument"}: no source "${sourceName}" for the mode${list.length > 1 ? "s" : ""} ${list.map(([n]) => n).join(", ")}`);
        continue;
      }
      if (typeof source.sf2 === "string") {
        const [mainName, main] = list.find(([n]) => n === base) ?? list[0];
        const variants = {};
        for (const [name, mode] of list) {
          if (name === mainName) continue;
          variants[name] = { program: mode.program ?? source.program ?? 0, bankSelect: mode.bankSelect ?? source.bankSelect ?? 0, start: mode.start ?? source.start ?? 0 };
        }
        const made = create?.({
          sf2: source.sf2,
          program: main.program ?? source.program ?? 0,
          bankSelect: main.bankSelect ?? source.bankSelect ?? 0,
          controllers: { ...(source.controllers ?? {}), ...controllerDefaults(ison) },
          start: main.start ?? source.start ?? 0,
          variants,
        }, Tone, { notes });
        if (made?.node) this.register(made.node, list.map(([n]) => n), main);
        continue;
      }
      for (const [name, mode] of list) {
        const node = this.buildOne(source, mode, { create, notes });
        if (node) this.register(node, [name], mode);
      }
    }
    this.loaded = Promise.all(this.nodes.map((node) => node.loaded ?? null)).then(() => undefined);
  }

  /** One node for one mode of a source that is not a SoundFont. */
  buildOne(source, mode, { create, notes }) {
    const ison = this.ison;
    if (typeof source.sfz === "string" || typeof source.dspreset === "string") {
      const spec = {
        ...source,
        envelope: ison.envelope ?? source.envelope,
        start: mode.start ?? source.start,
        controls: { ...(source.controls ?? {}), ...(mode.controls ?? {}) },
        // The instrument's controls start where it says (`default`), as for a SoundFont.
        controllers: { ...(source.controllers ?? {}), ...controllerDefaults(ison) },
      };
      if (mode.group !== undefined) spec.group = mode.group; // a group of a Decent Sampler preset
      if (mode.keyswitch !== undefined) spec.keyswitch = mode.keyswitch;
      return create?.(spec, this.Tone, { notes })?.node ?? null;
    }
    if (typeof source.faust === "string") {
      const spec = { ...source, params: { ...(source.params ?? {}), ...paramDefaults(ison), ...(mode.params ?? {}) } };
      return create?.(spec, this.Tone, { notes })?.node ?? null;
    }
    if (typeof source.type === "string" && typeof this.Tone[source.type] === "function") {
      return new this.Tone[source.type]({ ...(source.options ?? {}), ...(mode.options ?? {}) });
    }
    // Anything else this package plays (a General MIDI program, a drum kit…)
    const spec = typeof source === "object" ? { ...source, ...(mode.options ? { options: { ...(source.options ?? {}), ...mode.options } } : {}) } : source;
    return create?.(spec, this.Tone, { notes })?.node ?? null;
  }

  /**
   * A node into the output. A mode with a `pan`, or a level that a control
   * turns, goes through its own gain and panner first.
   */
  register(node, modeNames, mode = {}) {
    const controlled = Object.values(this.ison.controls ?? {}).filter((control) => modeNames.includes(control?.mode));
    let out = node;
    if (controlled.length > 0 || typeof mode.pan === "number") {
      const level = new this.Tone.Gain(controlled.length > 0 ? controlled[0].default ?? 1 : 1);
      node.connect(level);
      out = level;
      for (const name of modeNames) (this.levels ??= {})[name] = level;
      if (typeof mode.pan === "number" && this.Tone.Panner) {
        const panner = new this.Tone.Panner(mode.pan);
        level.connect(panner);
        out = panner;
        (this.extra ??= []).push(panner);
      }
      (this.extra ??= []).push(level);
    }
    out.connect(this.output);
    this.nodes.push(node);
    for (const name of modeNames) this.byMode[name] = node;
  }

  /** The node of a mode, or of the default mode. */
  nodeFor(variant) {
    return (variant && this.byMode[variant]) || this.byMode[defaultMode(this.ison)] || this.nodes[0] || null;
  }

  /** The node a sounding note was sent to: the oldest still sounding at that pitch. */
  nodeOf(midi) {
    return this.sounding.get(midi)?.[0] ?? this.nodeFor();
  }

  /** A note starts on a node: two layers may sound the same pitch on two nodes. */
  started(midi, node) {
    if (!this.sounding.has(midi)) this.sounding.set(midi, []);
    this.sounding.get(midi).push(node);
  }

  /** The oldest note at that pitch is done. */
  ended(midi) {
    const list = this.sounding.get(midi);
    list?.shift();
    if (!list?.length) this.sounding.delete(midi);
  }

  midiOf(note) {
    return typeof note === "number" && note < 128 ? Math.round(note) : Math.round(this.Tone.Frequency(note).toMidi());
  }

  /** The velocity the source gets: the instrument's curve, for a source that hears it as MIDI does. */
  velocityOf(velocity) {
    return this.velocityCurve === "sqrt" ? Math.sqrt(velocity) : velocity;
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

  /**
   * A Tone synth of one voice (Synth, MonoSynth, FMSynth, AMSynth…) takes one
   * note, and releases without naming it. Known by what it has: a `frequency`
   * signal and no `voices`, which a PolySynth has and a Sampler lacks.
   */
  isMono(node) {
    const Tone = this.Tone;
    if (Tone.Monophonic && node instanceof Tone.Monophonic) return true;
    if (Tone.NoiseSynth && node instanceof Tone.NoiseSynth) return true;
    if (Tone.PolySynth && node instanceof Tone.PolySynth) return false;
    return node?.frequency !== undefined && node?.voices === undefined && node?.isSoundfont !== true && node?.isSfz !== true && node?.isFaust !== true;
  }

  /**
   * The controls that follow the velocity (`"velocity": true`), as each note's
   * own: `{ cc: velocity }`. The note carries them to its source, so two notes
   * sounding together (a double stop, a doubling) each keep their own force.
   * A source that cannot take a note's own controllers (a SoundFont engine
   * has one mod wheel per channel) gets a controller move instead.
   */
  velocityControls(node, velocity, time) {
    const own = {};
    for (const control of Object.values(this.ison.controls ?? {})) {
      if (control?.velocity === true && typeof control.cc === "number") own[control.cc] = Math.max(0, Math.min(1, velocity));
    }
    if (Object.keys(own).length === 0) return null;
    if (node?.isSfz) return own;
    for (const [cc, value] of Object.entries(own)) node.controllerChange?.(Number(cc), value, time ?? this.Tone.now());
    return null;
  }

  /** The options a note goes to its source with: its own controllers added, if any. */
  withOwn(options, own) {
    return own ? { ...options, controllers: { ...(options?.controllers ?? {}), ...own } } : options;
  }

  triggerAttack(notes, time, velocity = 1, duration, options) {
    const node = this.nodeFor(options?.variant);
    if (!node) return this;
    const own = this.velocityControls(node, velocity, time);
    // A synth whose last note had a loudness curve starts again at its level.
    if (this.shapedNodes?.has(node)) node.volume.setValueAtTime(this.shapedNodes.get(node), this.Tone.Time(time ?? this.Tone.now()).toSeconds());
    for (const note of [].concat(notes)) this.started(this.midiOf(note), node);
    const played = this.isMono(node) ? [].concat(notes)[0] : notes;
    node.triggerAttack(played, time, this.velocityOf(velocity), duration, this.withOwn(options, own));
    return this;
  }

  triggerRelease(notes, time) {
    for (const note of [].concat(notes)) {
      const midi = this.midiOf(note);
      const node = this.nodeOf(midi);
      if (node) this.isMono(node) ? node.triggerRelease(time) : node.triggerRelease?.(note, time);
      this.ended(midi);
    }
    return this;
  }

  triggerAttackRelease(notes, duration, time, velocity = 1, options) {
    const node = this.nodeFor(options?.variant);
    const own = node ? this.velocityControls(node, velocity, time) : null;
    node?.triggerAttackRelease(notes, duration, time, this.velocityOf(velocity), this.withOwn(options, own));
    return this;
  }

  shape(midi, startTime, anchors, options) {
    const node = this.nodeOf(midi);
    let shaped = node ? this.hooks.shapeVoices?.(node, midi, startTime, anchors, options) ?? false : false;
    // A Tone synth of one voice: its loudness curve is its volume, in dB,
    // then the note is let go at its end.
    if (!shaped && node && this.isMono(node) && typeof node.volume?.setValueAtTime === "function" && Array.isArray(anchors) && anchors.length > 0) {
      this.shapedNodes ??= new Map();
      if (!this.shapedNodes.has(node)) this.shapedNodes.set(node, node.volume.value ?? 0);
      const base = this.shapedNodes.get(node);
      let points = anchors;
      if (points.length > 1 && points[0].value === 0) points = [{ time: 0, value: points[1].value }, ...points.slice(1)];
      const db = (value) => base + (value > 0.001 ? 20 * Math.log10(value) : -60);
      node.volume.cancelScheduledValues?.(startTime);
      node.volume.setValueAtTime(db(points[0].value), startTime + Math.max(0, points[0].time));
      for (const point of points.slice(1)) node.volume.linearRampToValueAtTime(db(point.value), startTime + point.time);
      node.triggerRelease(startTime + (options?.seconds ?? points.at(-1).time));
      shaped = true;
    }
    if (shaped) this.ended(midi);
    return shaped;
  }

  bend(midi, startTime, anchors, baseCents = 0) {
    const node = this.nodeOf(midi);
    if (!node) return false;
    if (this.hooks.bendVoices?.(node, midi, startTime, anchors, baseCents)) return true;
    // A Tone synth bends through its detune, in cents, then comes back.
    const detune = node.detune;
    if (!detune || typeof detune.setValueAtTime !== "function" || !Array.isArray(anchors) || anchors.length === 0) return false;
    detune.cancelScheduledValues?.(startTime);
    detune.setValueAtTime(baseCents + anchors[0].value, startTime + Math.max(0, anchors[0].time));
    for (const anchor of anchors.slice(1)) detune.linearRampToValueAtTime(baseCents + anchor.value, startTime + anchor.time);
    detune.setValueAtTime(baseCents, startTime + anchors.at(-1).time + 0.05);
    return true;
  }

  hold(midi, startTime, seconds, options) {
    const node = this.nodeOf(midi);
    return node ? this.hooks.holdVoices?.(node, midi, startTime, seconds, options) ?? false : false;
  }

  controllerChange(controller, value, time) {
    // A control that turns a mode's level: the level follows, 0 to 1.
    for (const control of Object.values(this.ison.controls ?? {})) {
      if (control?.cc !== controller || !control.mode) continue;
      const level = this.levels?.[control.mode];
      const at = time === undefined ? this.Tone.now() : this.Tone.Time(time).toSeconds();
      if (level?.gain?.linearRampToValueAtTime) level.gain.linearRampToValueAtTime(value, at + 0.05);
      else if (level?.gain) level.gain.value = value;
    }
    for (const node of this.nodes) node.controllerChange?.(controller, value, time);
    return this;
  }

  pitchBend(value, time) {
    for (const node of this.nodes) node.pitchBend?.(value, time);
    return this;
  }

  channelPressure(value, time) {
    for (const node of this.nodes) node.channelPressure?.(value, time);
    return this;
  }

  releaseAll() {
    for (const node of this.nodes) node.releaseAll?.();
    this.sounding.clear();
    return this;
  }

  dispose() {
    if (this.disposed) return this;
    this.disposed = true;
    for (const node of this.nodes) node.dispose?.();
    for (const node of this.extra ?? []) node.dispose?.();
    this.output.dispose();
    return this;
  }
}
