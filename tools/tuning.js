// How far each recording of an instrument is from its note, and the correction that brings it back.
//
//   node tools/tuning.js "<instrument.sfz or preset.dspreset>" [out.json]
//
// Every recording is decoded (ffmpeg), its pitch followed over the steady part of the sound (the
// second half, at most 3 s, where a slurred transition has reached its note and a bow its speed),
// and the median compared with the note the file says it is (`pitch_keycenter`, and its `tune`).
// The output is a table, recording path as the file writes it → cents to add:
//
//   { "Samples/D4.flac": -12, … }
//
// A track plays it with `tuning` beside its `sfz` or `dspreset` (a URL, or the table itself), and an
// ison source the same way. Recordings within 3 cents, those whose pitch cannot be followed (noise, a
// chord), and those more than 30 cents off (more likely a bad measurement; they are listed) are left out.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { dspresetToSfz } from "../src/dspreset.js";
import { parseSfz } from "../src/sfz-parse.js";

const RATE = 44100;

/**
 * The median pitch of a sound, in cents from `expected` Hz, and how clearly
 * it has a pitch (0 to 1), from a normalised autocorrelation every 25 ms,
 * looking only within a semitone and a half of `expected` (no octave errors).
 *
 * @param {Float32Array} x - mono samples at 44.1 kHz
 * @param {number} expected - Hz
 * @returns {{cents: number, clarity: number}|null}
 */
export function medianPitch(x, expected) {
  const W = 2048;
  const from = Math.floor(x.length / 2), to = Math.min(x.length - 2 * W, from + 3 * RATE);
  const lo = Math.floor(RATE / (expected * 2 ** (1.5 / 12))), hi = Math.ceil(RATE / (expected / 2 ** (1.5 / 12)));
  const cents = [], clarities = [];
  for (let s = from; s < to; s += Math.round(RATE / 40)) {
    let energy = 0;
    for (let i = 0; i < W; i++) energy += x[s + i] * x[s + i];
    if (energy < 1e-6) continue;
    const at = (lag) => {
      let c = 0, e = 0;
      for (let i = 0; i < W; i++) { c += x[s + i] * x[s + i + lag]; e += x[s + i + lag] * x[s + i + lag]; }
      return (2 * c) / (energy + e);
    };
    let best = -Infinity, lag = 0;
    for (let l = lo; l <= hi; l++) { const c = at(l); if (c > best) { best = c; lag = l; } }
    const a = at(lag - 1), z = at(lag + 1);
    const exact = lag + (a - z) / (2 * (a - 2 * best + z) || 1);
    cents.push(1200 * Math.log2(RATE / exact / expected));
    clarities.push(best);
  }
  if (cents.length < 3) return null;
  const median = (list) => [...list].sort((p, q) => p - q)[Math.floor(list.length / 2)];
  return { cents: median(cents), clarity: median(clarities) };
}

function decode(file) {
  const bytes = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
}

const main = () => {
  const [file, out] = process.argv.slice(2);
  if (!file) { console.error('usage : node tools/tuning.js "<instrument.sfz | preset.dspreset>" [out.json]'); process.exit(1); }
  const text = readFileSync(file, "utf8");
  const sfz = /\.dspreset$/i.test(file) ? dspresetToSfz(text) : text;
  const { regions } = parseSfz(sfz, { include: (path) => readFileSync(join(dirname(file), path), "utf8") });
  const table = {};
  const seen = new Set();
  let measured = 0, unclear = 0;
  const doubtful = [];
  for (const region of regions) {
    if (!region.sample || seen.has(region.sample)) continue;
    seen.add(region.sample);
    const key = region.pitch_keycenter ?? 60;
    const expected = 440 * 2 ** ((key - 69 + (region.tune ?? 0) / 100) / 12);
    let pitch;
    try { pitch = medianPitch(decode(join(dirname(file), region.sample)), expected); } catch { pitch = null; }
    if (!pitch || pitch.clarity < 0.8) { unclear++; continue; }
    measured++;
    const correction = -Math.round(pitch.cents);
    // More than 30 cents off is more likely a measurement gone wrong (a very short sound, a scrape) than a recording that far out.
    if (Math.abs(correction) > 30) { doubtful.push(`${region.sample} ${correction}`); continue; }
    if (Math.abs(correction) >= 3) table[region.sample] = correction;
  }
  const destination = out ?? file.replace(/\.(sfz|dspreset)$/i, ".tuning.json");
  writeFileSync(destination, JSON.stringify(table, null, 1) + "\n");
  console.log(`${measured} recordings measured, ${unclear} without a clear pitch, ${Object.keys(table).length} corrected → ${destination}`);
  if (doubtful.length) console.log(`left alone, more than 30 cents off (check by ear): ${doubtful.join(", ")}`);
};

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) main();
