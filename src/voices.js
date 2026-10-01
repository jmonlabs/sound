/**
 * What happens to a sampled instrument's sounding voices.
 *
 * These reach into a Tone.Sampler's `_activeSources` — the `ToneBufferSource`
 * objects it keeps for the notes currently playing. That is Tone-internal, so
 * every entry point is feature-detected and returns `false` rather than
 * throwing if a future version moves it. The caller then falls back to
 * whatever it would have done without this package.
 *
 * Two things live here, and both are things a soundfont engine does that a
 * plain sample player does not:
 *
 *   - **bend**: ramp a voice's playbackRate, so a glissando resamples the
 *     instrument instead of handing the note to a substitute synth;
 *   - **hold**: loop a sample's sustaining region, so a note longer than the
 *     recording does not run out of sound;
 *   - **shape**: move a voice's loudness through the note, so a held string
 *     swells and eases off instead of sitting at one level like a tape loop.
 */

/** Analysis is per buffer and never changes, so compute it once. */
const sustainAnalyses = new WeakMap();

/**
 * True when an instrument's sounding voices can be resampled — which is how a
 * `Sampler` slides without losing its timbre.
 *
 * Tone's `Sampler` exposes no `detune` Signal, so a curve on a sampled
 * instrument would otherwise go to a substitute synth and a violin glissando
 * would not sound like a violin. It does keep its sounding
 * `ToneBufferSource`s in `_activeSources`, and each one's `playbackRate` is an
 * automatable Param. Ramping that resamples the instrument instead of
 * replacing it — the same lever a soundfont engine pulls to bend a note.
 *
 * `_activeSources` is Tone-internal, so this is feature-detected: a future
 * version that moves it simply falls back to the glide voice.
 */
export function canResample(synth) {
  return typeof synth?._activeSources?.get === "function";
}

/**
 * Schedule a compiled pitch curve on a Sampler's sounding voices.
 *
 * Unlike a shared `detune` Signal, these voices belong to this note alone and
 * are discarded when it ends, so there is nothing to reset afterwards.
 *
 * @param {Object} synth — a Tone.Sampler
 * @param {number} midi — the note's MIDI number, which keys `_activeSources`
 * @param {number} startTime — absolute time in seconds of the note start
 * @param {Array<{time:number,value:number}>} anchors — time in seconds
 *   relative to `startTime`, value in cents relative to the written pitch
 * @param {number} [baseCents=0] — baseline detune (e.g. tuning * 100)
 * @returns {boolean} whether any voice was reached
 */
export function applyPitchAnchorsToSampler(synth, midi, startTime, anchors, baseCents = 0) {
  if (!Array.isArray(anchors) || anchors.length === 0) return false;
  const sources = synth?._activeSources?.get?.(Math.round(midi));
  if (!Array.isArray(sources) || sources.length === 0) return false;

  const ratioAt = (cents) => Math.pow(2, (baseCents + cents) / 1200);
  let applied = false;

  for (const source of sources) {
    const rate = source?.playbackRate;
    if (!rate || typeof rate.linearRampToValueAtTime !== "function") continue;

    const base = rate.value ?? 1;
    if (typeof rate.cancelScheduledValues === "function") {
      rate.cancelScheduledValues(startTime);
    }
    rate.setValueAtTime(
      base * ratioAt(anchors[0].value),
      startTime + Math.max(0, anchors[0].time),
    );
    for (let k = 1; k < anchors.length; k++) {
      rate.linearRampToValueAtTime(base * ratioAt(anchors[k].value), startTime + anchors[k].time);
    }
    applied = true;
  }
  return applied;
}

/**
 * Schedule a loudness curve on a Sampler's sounding voices, and let them go.
 *
 * Each voice is a `ToneBufferSource` whose output gain Tone automates: a ramp
 * from 0 to the velocity over the Sampler's `attack`, and a ramp to 0 over its
 * `release` when the voice is stopped. Stopping a voice cancels whatever gain
 * values were scheduled after its attack, so a curve can only survive if
 * nothing stops the voice after it is laid.
 *
 * This therefore does the letting go itself: it stops each voice at the note's
 * end (which schedules the sound to end after the release), then replaces the
 * whole gain path — from 0, through the anchors, to the level the curve has at
 * the note's end, then down to 0 over `release` — and takes the voices off the
 * Sampler's list of sounding notes, as `triggerRelease` would. A host calls it
 * between `triggerAttack` and where it would have called `triggerRelease`, and
 * skips the release when this returns true: `triggerAttackRelease` empties the
 * list at once, so a voice would never be found.
 *
 * @param {Object} synth — a Tone.Sampler
 * @param {number} midi — the note's MIDI number, which keys `_activeSources`
 * @param {number} startTime — absolute time in seconds of the note start
 * @param {Array<{time:number,value:number}>} anchors — time in seconds
 *   relative to `startTime`, value as a multiple of the note's velocity
 * @param {Object} options
 * @param {number} options.seconds — the note's duration in seconds
 * @param {number} [options.velocity=1] — the level the Sampler started it at
 * @param {number} [options.attack=0] — shortest time to the first anchor, so a
 *   curve that starts loud still does not click
 * @param {number} [options.release=0] — fade after the note, in seconds
 * @returns {boolean} whether any voice was reached (and so released)
 */
export function applyAmplitudeAnchorsToSampler(synth, midi, startTime, anchors, options = {}) {
  if (!Array.isArray(anchors) || anchors.length === 0) return false;
  const sources = synth?._activeSources?.get?.(Math.round(midi));
  if (!Array.isArray(sources) || sources.length === 0) return false;

  const velocity = options.velocity ?? 1;
  const seconds = Math.max(0, options.seconds ?? 0);
  const attack = Math.max(0.005, options.attack ?? 0);
  const release = Math.max(0.005, options.release ?? 0);
  const end = startTime + seconds;

  // The level at the note's end, read off the curve (held after its last anchor).
  const levelAt = (t) => {
    if (t <= anchors[0].time) return anchors[0].value;
    for (let k = 1; k < anchors.length; k++) {
      const a = anchors[k - 1];
      const b = anchors[k];
      if (t <= b.time) return a.value + (b.value - a.value) * ((t - a.time) / (b.time - a.time || 1));
    }
    return anchors.at(-1).value;
  };

  const shaped = [];
  for (const source of sources) {
    const gain = source?._gainNode?.gain;
    if (!gain || typeof gain.linearRampToValueAtTime !== "function" || typeof source.stop !== "function") continue;

    source.stop(end);   // first: stopping later would cancel the curve
    gain.cancelScheduledValues(startTime);
    gain.setValueAtTime(0, startTime);
    let last = startTime;
    anchors.forEach((a, k) => {
      const at = startTime + Math.max(a.time, k === 0 ? attack : 0);
      if (at <= last || at >= end) return;   // forward in time, and inside the note
      gain.linearRampToValueAtTime(velocity * a.value, at);
      last = at;
    });
    // The note's end, at the level the curve has reached there.
    gain.linearRampToValueAtTime(velocity * levelAt(seconds), end);
    gain.linearRampToValueAtTime(0, end + release);
    shaped.push(source);
  }
  // Released, so no longer the Sampler's to stop: a later triggerRelease of
  // the same pitch must not reach these voices and cancel their curve.
  if (shaped.length > 0) {
    synth._activeSources.set(Math.round(midi), sources.filter((source) => !shaped.includes(source)));
  }
  return shaped.length > 0;
}

/**
 * Decide whether a sample can be looped to hold a note, and where.
 *
 * A soundfont stores loop points; a folder of MP3s does not, so they are
 * measured. The test is whether the recording still has energy at the end: a
 * string, organ, flute or pad holds 60-95% of its peak level there and loops
 * cleanly, while a piano has decayed to a few percent and would loop as an
 * obviously stuck note.
 *
 * The window is measured over 250 ms rather than a few cycles, because these
 * recordings carry their own vibrato — a short window chases the modulation
 * instead of the envelope.
 *
 * @param {Object} buffer — a Tone.ToneAudioBuffer
 * @param {Object} [options]
 * @param {number} [options.threshold=0.25] — tail level, relative to peak,
 *   above which the sample counts as sustaining
 * @returns {{loops: boolean, loopStart: number, loopEnd: number}|null}
 */
export function analyseSustain(buffer, options = {}) {
  if (!buffer || typeof buffer.getChannelData !== "function") return null;
  if (sustainAnalyses.has(buffer)) return sustainAnalyses.get(buffer);

  const { threshold = 0.25 } = options;
  let data;
  try {
    data = buffer.getChannelData(0);
  } catch {
    return null;
  }
  const duration = buffer.duration || 0;
  if (!data || data.length === 0 || duration <= 0) return null;

  const rate = data.length / duration;
  const window = Math.max(1, Math.floor(rate * 0.05));
  const levels = [];
  for (let i = 0; i + window <= data.length; i += window) {
    levels.push(rms(data, i, i + window));
  }
  if (levels.length < 4) return null;

  const peak = Math.max(...levels);
  const tail = levels[levels.length - 1];
  const loops = peak > 0 && tail / peak >= threshold;

  // Loop the steady part: past the attack, short of the very end, where an
  // encoder's fade-out lives. The loop starts on a rising zero crossing and
  // ends where the recording repeats what follows its start; failing that,
  // on a zero crossing near the end. A long loop turns less often: one that
  // started halfway through a 3.13-second recording came round every 1.4 s,
  // and on a low accordion note each turn was heard as a lurch.
  const from = zeroCrossingNear(data, Math.floor(data.length * 0.20), Math.floor(data.length * 0.25));
  const last = Math.floor(data.length * 0.95);
  const to = repeatEnd(data, from, last, rate)
    ?? zeroCrossingNear(data, Math.floor(data.length * 0.90), last);

  const analysis = {
    loops: loops && to > from,
    loopStart: from / rate,
    loopEnd: to / rate,
    startSample: from,
    endSample: to,
    prepared: false,
  };
  sustainAnalyses.set(buffer, analysis);
  return analysis;
}

/**
 * Make a sample's loop join cleanly, by editing the recording once.
 *
 * Looping raw audio leaves two audible seams, both measured on the FluidR3
 * set rather than assumed:
 *
 *   - a **level step**, because the recording decays across the loop window.
 *     A warm pad jumped 4.6 dB every time round. A gain ramp across the loop
 *     brings its end up to its start, so the cycle is level by construction.
 *   - a **waveform step** at the join. Landing on a zero crossing removes the
 *     click but not the discontinuity in the partials. Crossfading the audio
 *     arriving at `loopEnd` into the audio that precedes `loopStart` makes the
 *     join exact — the measured step goes to zero.
 *
 *         pad     -4.64 dB -> -1.09 dB    step 0.00050 -> 0.00000
 *         strings -0.25 dB ->  0.11 dB    step 0.00039 -> 0.00000
 *
 * The edit is done once per buffer, in place, and every channel is treated the
 * same so a stereo image survives. A voice already sounding this buffer will
 * hear the edit; it happens on the first held note and never again.
 *
 * @param {Object} buffer — a Tone.ToneAudioBuffer
 * @param {Object} analysis — from {@link analyseSustain}
 * @returns {boolean} whether the buffer is ready to loop
 */
export function prepareLoopRegion(buffer, analysis) {
  if (!analysis || !analysis.loops) return false;
  if (analysis.prepared) return true;
  analysis.prepared = true;   // set first: a failed edit still loops, just less neatly

  const channels = buffer.numberOfChannels || 1;
  const { startSample: start, endSample: end } = analysis;
  const rate = (buffer.length || 0) / (buffer.duration || 1);
  // A long crossfade: 50 ms joined the waveform but not the slow beating of
  // an accordion's reeds, which was heard at every turn; 300 ms was not.
  const fade = Math.min(Math.round(rate * 0.3), start, Math.floor((end - start) / 3));
  if (!(end > start) || fade <= 0) return true;

  const measure = Math.min(Math.round(rate * 0.25), end - start);

  for (let channel = 0; channel < channels; channel++) {
    let data;
    try {
      data = buffer.getChannelData(channel);
    } catch {
      continue;
    }
    if (!data || data.length < end) continue;

    // 1. Level the loop: ramp its gain so the end matches the start.
    const head = rms(data, start, start + measure);
    const tail = rms(data, end - measure, end);
    if (tail > 0 && head > 0) {
      const gain = head / tail;
      for (let i = start; i < end; i++) {
        data[i] *= 1 + (gain - 1) * ((i - start) / (end - start));
      }
    }

    // 2. Crossfade, equal-power, so the join is continuous in the waveform.
    const before = data.slice(start - fade, start);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      data[end - fade + i] = data[end - fade + i] * Math.cos(t * Math.PI / 2)
        + before[i] * Math.sin(t * Math.PI / 2);
    }
  }
  return true;
}

/**
 * Get every sustaining recording of a Sampler ready to loop, as soon as the
 * recordings have loaded and before any note plays them.
 *
 * The loop join is smoothed by editing the recording (prepareLoopRegion). An
 * edit made once a voice has started is not heard: the Web Audio API takes
 * its own copy of a buffer's contents when a source starts, so the first
 * notes to loop, and every voice already sounding, clicked at the loop point.
 * Preparing at load time means every voice plays the edited recording.
 *
 * @param {Object} synth — a Tone.Sampler, once loaded
 * @param {Object} [options] — passed to analyseSustain
 * @returns {number} how many recordings were made ready to loop
 */
export function prepareSamplerLoops(synth, options = {}) {
  const buffers = synth?._buffers?._buffers;
  if (!(buffers instanceof Map)) return 0;
  let prepared = 0;
  for (const buffer of buffers.values()) {
    if (prepareLoopRegion(buffer, analyseSustain(buffer, options))) prepared++;
  }
  return prepared;
}

/**
 * Hold a sampled note for as long as it is written, by looping the sample's
 * sustaining region.
 *
 * Every FluidR3 sample is a fixed 3.13-second render, so a longer note used to
 * run out of sound — a whole note at 60 BPM ended in silence. Tone's
 * `Sampler` schedules each voice to stop at the end of its buffer, but setting
 * `loop` on a started `ToneBufferSource` cancels exactly that stop, which is
 * the hook this uses. The note's real end is then scheduled here instead.
 *
 * Samples that decay — piano, guitar, plucked and percussive instruments — are
 * left alone: they are supposed to die away.
 *
 * @param {Object} synth — a Tone.Sampler
 * @param {number} midi — the note's MIDI number, which keys `_activeSources`
 * @param {number} startTime — absolute time in seconds of the note start
 * @param {number} seconds — the note's duration in seconds
 * @param {Object} [options] — passed to {@link analyseSustain}
 * @returns {boolean} whether any voice was made to loop
 */
export function sustainSampledNote(synth, midi, startTime, seconds, options = {}) {
  const sources = synth?._activeSources?.get?.(Math.round(midi));
  if (!Array.isArray(sources) || sources.length === 0) return false;

  let looped = false;
  for (const source of sources) {
    const buffer = source?.buffer;
    if (!buffer || typeof source.stop !== "function") continue;

    // What the voice can already play, allowing for glissando resampling.
    const rate = source.playbackRate?.value ?? 1;
    const natural = (buffer.duration || 0) / (rate || 1);
    if (!(seconds > natural)) continue;

    const analysis = analyseSustain(buffer, options);
    if (!prepareLoopRegion(buffer, analysis)) continue;

    source.loopStart = analysis.loopStart;
    source.loopEnd = analysis.loopEnd;
    source.loop = true;          // this cancels Sampler's stop-at-buffer-end
    source.stop(startTime + seconds);   // so the note has to be ended here
    looped = true;
  }
  return looped;
}

/** Root mean square of a slice. */
function rms(data, from, to) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

/** First rising zero crossing at or after `index`, giving up at `limit`. */
/**
 * Where to end a loop that starts at `from`: the furthest point, before
 * `limit`, where the recording repeats what follows `from`.
 *
 * A soundfont rendered to audio still carries the soundfont's own loop, so
 * its steady part repeats almost exactly at a fixed interval — every 0.166 s
 * for FluidR3's violin, with its vibrato. A loop whose length is a multiple of
 * that interval joins seamlessly. One of arbitrary length joins two different
 * moments of the vibrato, which no crossfade hides: the loop breaks audibly on
 * every turn.
 *
 * The search is coarse first, on 16-sample block averages, then exact to the
 * sample around the best lag, so that preparing a whole instrument on load
 * stays cheap. Returns null when nothing repeats closely enough (a recording
 * with no loop of its own), and the caller falls back to a fixed end.
 */
function repeatEnd(data, from, limit, rate) {
  const step = 16;
  const window = Math.round(rate * 0.04);
  const minLag = Math.round(rate * 0.05);
  const maxLag = limit - from - window;
  if (maxLag <= minLag) return null;

  const blocks = new Float64Array(Math.floor((maxLag + window) / step));
  for (let k = 0; k < blocks.length; k++) {
    let sum = 0;
    for (let i = 0; i < step; i++) sum += data[from + k * step + i];
    blocks[k] = sum / step;
  }
  const coarseWindow = Math.floor(window / step);
  const scores = [];
  for (let lag = Math.ceil(minLag / step); lag + coarseWindow < blocks.length; lag++) {
    scores.push([lag, similarity(blocks, 0, lag, coarseWindow)]);
  }
  const best = Math.max(...scores.map(([, score]) => score));
  if (!(best >= 0.9)) return null;
  // The longest lag that repeats about as well as the best: fewer turns.
  const coarse = Math.max(...scores.filter(([, score]) => score >= best - 0.01).map(([lag]) => lag));

  let exact = coarse * step;
  let exactScore = -1;
  for (let lag = coarse * step - step; lag <= Math.min(coarse * step + step, maxLag); lag++) {
    const score = similarity(data, from, from + lag, window);
    if (score > exactScore) [exact, exactScore] = [lag, score];
  }
  return exactScore >= 0.9 ? from + exact : null;
}

/** Normalised correlation of two windows of the same signal: 1 when identical. */
function similarity(data, a, b, length) {
  let cross = 0;
  let energyA = 0;
  let energyB = 0;
  for (let i = 0; i < length; i++) {
    cross += data[a + i] * data[b + i];
    energyA += data[a + i] * data[a + i];
    energyB += data[b + i] * data[b + i];
  }
  return cross / Math.sqrt(energyA * energyB || 1);
}

function zeroCrossingNear(data, index, limit) {
  const end = Math.min(data.length - 1, limit);
  for (let i = Math.max(1, index); i < end; i++) {
    if (data[i - 1] <= 0 && data[i] > 0) return i;
  }
  return index;
}
