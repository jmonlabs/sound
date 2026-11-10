// Measures of a recording, shared by tools/tuning.js and tools/inspect.js: its pitch over time, how
// clearly it has one, and how long it takes to speak.
import { execFileSync } from "node:child_process";

export const RATE = 44100;

/** A recording as mono samples at 44.1 kHz (ffmpeg decodes WAV, FLAC, Ogg…). */
export function decode(file) {
  const bytes = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
}

/**
 * The pitch of a sound every `step` seconds between `from` and `to` (seconds),
 * in cents from `expected` Hz, with how clearly it has a pitch (0 to 1): a
 * normalised autocorrelation that looks only within a semitone and a half of
 * `expected`, so it never jumps an octave.
 *
 * @returns {Array<{time: number, cents: number, clarity: number}>}
 */
export function pitchTrack(x, expected, { from = 0, to = x.length / RATE, step = 0.025 } = {}) {
  // About three periods: long enough to find the pitch, short enough to follow a vibrato.
  const W = Math.max(512, Math.min(4096, Math.round((3 * RATE) / expected)));
  const lo = Math.floor(RATE / (expected * 2 ** (1.5 / 12))), hi = Math.ceil(RATE / (expected / 2 ** (1.5 / 12)));
  const out = [];
  const end = Math.min(x.length - W - hi - 2, Math.floor(to * RATE));
  for (let s = Math.floor(from * RATE); s < end; s += Math.round(step * RATE)) {
    let energy = 0;
    for (let i = 0; i < W; i++) energy += x[s + i] * x[s + i];
    if (energy < 1e-6) continue;
    const at = (lag) => {
      let c = 0, e = 0;
      for (let i = 0; i < W; i++) { c += x[s + i] * x[s + i + lag]; e += x[s + i + lag] * x[s + i + lag]; }
      return (2 * c) / (energy + e);
    };
    let best = -Infinity, lag = lo;
    for (let l = lo; l <= hi; l++) { const c = at(l); if (c > best) { best = c; lag = l; } }
    const a = at(lag - 1), z = at(lag + 1);
    const shift = (a - z) / (2 * (a - 2 * best + z) || 1);
    if (!(Math.abs(shift) <= 1)) continue; // the peak is not a peak: no pitch here
    const exact = lag + shift;
    const cents = 1200 * Math.log2(RATE / exact / expected);
    if (Number.isFinite(cents) && Number.isFinite(best)) out.push({ time: s / RATE, cents, clarity: best });
  }
  return out;
}

const median = (list) => [...list].sort((p, q) => p - q)[Math.floor(list.length / 2)];
const quantile = (list, k) => [...list].sort((p, q) => p - q)[Math.floor(k * (list.length - 1))];

/**
 * The median pitch of the steady part of a sound (its second half, at most
 * 3 s: a slurred transition has reached its note, a bow its speed), in cents
 * from `expected`, and how clearly it has a pitch.
 *
 * @returns {{cents: number, clarity: number}|null}
 */
export function medianPitch(x, expected) {
  const length = x.length / RATE;
  const track = pitchTrack(x, expected, { from: length / 2, to: Math.min(length, length / 2 + 3) });
  if (track.length < 3) return null;
  return { cents: median(track.map((p) => p.cents)), clarity: median(track.map((p) => p.clarity)) };
}

/**
 * A recorded vibrato: how wide (cents either way) and how fast (Hz) the pitch
 * swings around its slower drift, over the held part of a sound (from 0.3 s,
 * at most 3 s). Null for a sound too short or without a clear pitch.
 *
 * @returns {{depth: number, rate: number}|null}
 */
export function vibratoOf(x, expected) {
  const length = x.length / RATE;
  if (length < 1.2) return null;
  // Only a held sound: a plucked or struck one that dies away wavers as it fades (strings beating), which is not a vibrato.
  const level = (t0, t1) => { let e = 0; const a = Math.floor(t0 * RATE), b = Math.min(x.length, Math.floor(t1 * RATE)); for (let i = a; i < b; i++) e += x[i] * x[i]; return e / Math.max(1, b - a); };
  const end = Math.min(length, 4.3);
  if (10 * Math.log10(level(0.3, 0.8) / (level(end - 0.5, end) || 1e-12)) > 12) return null;
  const track = pitchTrack(x, expected, { from: 0.3, to: Math.min(length, 4.3), step: 0.01 });
  if (track.length < 50 || median(track.map((p) => p.clarity)) < 0.8) return null;
  const cents = track.map((p) => p.cents);
  // the drift: a moving mean over 1 s (several swings); the vibrato is what swings around it
  const half = 50;
  const swing = cents.map((c, i) => {
    const near = cents.slice(Math.max(0, i - half), i + half + 1);
    return c - near.reduce((sum, v) => sum + v, 0) / near.length;
  });
  const depth = (quantile(swing, 0.95) - quantile(swing, 0.05)) / 2;
  let crossings = 0;
  for (let i = 1; i < swing.length; i++) if ((swing[i - 1] < 0) !== (swing[i] < 0)) crossings++;
  return { depth: Math.round(depth), rate: +((crossings / 2) / (track.length * 0.01)).toFixed(1) };
}

/** How long a sound takes to speak: from its first sound (-40 dB of its peak) to -6 dB, in ms. */
export function speechOf(x) {
  const W = 441, env = [];
  for (let i = 0; i + W < Math.min(x.length, 2 * RATE); i += W) {
    let e = 0;
    for (let j = i; j < i + W; j++) e += x[j] * x[j];
    env.push(Math.sqrt(e / W));
  }
  const peak = Math.max(...env);
  if (!(peak > 0)) return null;
  const first = env.findIndex((v) => v > peak / 100);
  const spoken = env.findIndex((v) => v > peak / 2);
  return (spoken - first) * 10;
}
