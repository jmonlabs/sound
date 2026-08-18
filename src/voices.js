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
 *     recording does not run out of sound.
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
 * @param {number} [baseCents=0] — baseline detune (e.g. microtuning * 100)
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
  // encoder's fade-out lives. Both ends land on a rising zero crossing.
  const from = zeroCrossingNear(data, Math.floor(data.length * 0.45), Math.floor(data.length * 0.50));
  const to = zeroCrossingNear(data, Math.floor(data.length * 0.90), Math.floor(data.length * 0.95));

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
  const fade = Math.min(Math.round(rate * 0.05), start, end - start);
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
 * Hold a sampled note for as long as it is written, by looping the sample's
 * sustaining region.
 *
 * Every FluidR3 sample is a fixed 3.19-second render, so a longer note used to
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
function zeroCrossingNear(data, index, limit) {
  const end = Math.min(data.length - 1, limit);
  for (let i = Math.max(1, index); i < end; i++) {
    if (data[i - 1] <= 0 && data[i] > 0) return i;
  }
  return index;
}
