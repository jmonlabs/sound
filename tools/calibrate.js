// Calibrate an instrument said in ison, in one command: every recording in tune and level, every
// note heard on its beat. Nothing to compute by hand: the results are written into the ison.
//
//   node tools/calibrate.js "<instrument.ison.json>"
//
// For each source played from samples (`sfz` or `dspreset`):
// - its recordings' pitch is measured, and the corrections (cents by recording) go to
//   `tuning.json` beside the ison, which the source names (`tuning`);
// - the recordings that play its notes are levelled (dB by recording, `levels.json`, named by
//   `gain`), and a recording much duller than its neighbours (a muffled take: more than 5 dB less
//   above 3 kHz than the two on each side) is avoided: its keys are played by the nearest
//   recording (`avoid`);
// - for each mode played from it, the time each key takes to be heard (the bow catching the
//   string, the breath of a wind) becomes the mode's `speech`: each note then starts that much
//   earlier and sounds on its beat, its attack whole. A single delay for the whole instrument would
//   not do: it changes from one recording to the next (25 to 90 ms for one violin).
//
// Every recording is decoded once, several at a time. Paths: "/__files/samples/…" is the samples
// disk (SAMPLES, /Volumes/instruments/jmon by default), "/__files/…" the jmon folder.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dspresetToSfz } from "../src/dspreset.js";
import { parseSfz } from "../src/sfz-parse.js";
import { avoidRecordings } from "../src/sfz.js";
import { RATE, colourOf, decodeLater, eachAtOnce, heardAt, medianPitch } from "./measure.js";

const jmon = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const samples = process.env.SAMPLES ?? "/Volumes/instruments/jmon";
const onDisk = (url) => (url.startsWith("/__files/samples/") ? join(samples, url.slice("/__files/samples/".length)) : url.startsWith("/__files/") ? join(jmon, url.slice("/__files/".length)) : url);
const asUrl = (path) => `/__files/${relative(jmon, path)}`;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const isPlain = (r) => ["attack", "first"].includes(r.trigger ?? "attack") && r.sw_previous === undefined && r.sample;

/** JSON with tables of numbers on one line, so the ison stays readable. */
function write(value, indent = "") {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length && entries.every(([, v]) => typeof v === "number")) return JSON.stringify(value).replace(/,"/g, ', "').replace(/":/g, '": ');
    const inner = indent + "  ";
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${write(v, inner)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

const file = process.argv[2];
if (!file) { console.error('usage : node tools/calibrate.js "<instrument.ison.json>"'); process.exit(1); }
const ison = JSON.parse(readFileSync(file, "utf8"));
const here = dirname(resolve(file));
const tuningPath = join(here, "tuning.json"), gainPath = join(here, "levels.json");

// Every source's regions, and every recording to measure once: its expected pitch, and the offsets it is played from.
const sources = [];
const wanted = new Map(); // disk path → { expected, offsets }
for (const [name, source] of Object.entries(ison.sources ?? {})) {
  const url = source.sfz ?? source.dspreset;
  if (typeof url !== "string") continue;
  const path = onDisk(url);
  const text = readFileSync(path, "utf8");
  const { regions } = parseSfz(/\.dspreset$/i.test(path) ? dspresetToSfz(text) : text, { include: (p) => readFileSync(join(dirname(path), p), "utf8") });
  sources.push({ name, source, path, regions });
  for (const r of regions) {
    if (!r.sample) continue;
    const disk = join(dirname(path), r.sample);
    const entry = wanted.get(disk) ?? { expected: 440 * 2 ** (((r.pitch_keycenter ?? 60) - 69 + (r.tune ?? 0) / 100) / 12), offsets: new Set() };
    entry.offsets.add(r.offset ?? 0);
    wanted.set(disk, entry);
  }
}
console.log(`${wanted.size} recordings to measure…`);
const measured = new Map();
await eachAtOnce([...wanted.entries()], async ([disk, { expected, offsets }]) => {
  let x;
  try { x = await decodeLater(disk); } catch { return; }
  const heard = {};
  for (const offset of offsets) heard[offset] = heardAt(x, Math.round((offset * RATE) / 44100));
  measured.set(disk, { pitch: medianPitch(x, expected), colour: colourOf(x), heard });
});

const tuning = {}, gains = {};
for (const { name, source, path, regions } of sources) {
  const at = (r) => measured.get(join(dirname(path), r.sample));
  // in tune
  let corrected = 0, unclear = 0;
  const doubtful = [];
  for (const sample of new Set(regions.map((r) => r.sample).filter(Boolean))) {
    const m = measured.get(join(dirname(path), sample));
    if (!m?.pitch || m.pitch.clarity < 0.8) { unclear++; continue; }
    const cents = -Math.round(m.pitch.cents);
    if (Math.abs(cents) > 30) doubtful.push(`${sample.split("/").pop()} ${cents}`);
    else if (Math.abs(cents) >= 3) { tuning[sample] = cents; corrected++; }
  }
  source.tuning = asUrl(tuningPath);
  // level, and muffled takes
  const plain = regions.filter(isPlain);
  const top = Math.max(0, ...plain.map((r) => r.hivel ?? 127));
  const byKey = new Map();
  for (const r of plain.filter((r) => (r.hivel ?? 127) === top)) if (!byKey.has(r.pitch_keycenter ?? 60) && at(r)?.colour) byKey.set(r.pitch_keycenter ?? 60, r);
  const list = [...byKey.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => ({ sample: r.sample, colour: at(r).colour }));
  const avoid = [], dull = [];
  list.forEach((r, i) => {
    const near = list.filter((_, j) => j !== i && Math.abs(j - i) <= 2).map((n) => n.colour.bright);
    if (near.length >= 2 && r.colour.bright < median(near) - 5) { avoid.push(r.sample); dull.push(`${r.sample.split("/").pop()} (${(r.colour.bright - median(near)).toFixed(1)} dB above 3 kHz)`); }
  });
  const kept = list.filter((r) => !avoid.includes(r.sample));
  const level = median(kept.map((r) => r.colour.level));
  let levelled = 0;
  for (const r of kept) {
    const g = Math.round((level - r.colour.level) * 10) / 10;
    if (Math.abs(g) >= 1) { gains[r.sample] = Math.max(-6, Math.min(6, g)); levelled++; }
  }
  source.gain = asUrl(gainPath);
  if (avoid.length) source.avoid = avoid; else delete source.avoid;
  // on the beat: per key, from the recording that plays it once the muffled ones are avoided
  const speech = {};
  const playing = avoidRecordings(regions.map((r) => ({ ...r })), avoid).filter(isPlain);
  const loud = Math.max(0, ...playing.map((r) => r.hivel ?? 127));
  for (const r of playing.filter((r) => (r.hivel ?? 127) === loud)) {
    const heard = at(r)?.heard?.[r.offset ?? 0];
    if (heard === null || heard === undefined) continue;
    for (let k = r.lokey ?? 0; k <= Math.min(127, r.hikey ?? 127); k++) speech[k] = Math.max(speech[k] ?? 0, heard);
  }
  for (const [modeName, mode] of Object.entries(ison.modes ?? {})) if ((mode.source ?? Object.keys(ison.sources)[0]) === name) mode.speech = speech;
  const values = Object.values(speech);
  console.log(`${name}: ${corrected} recordings retuned, ${unclear} without a clear pitch${doubtful.length ? `, left alone (over 30 cents, check by ear): ${doubtful.join(", ")}` : ""}; ${levelled} levelled${dull.length ? `; avoided (their keys go to the nearest recording): ${dull.join(", ")}` : ""}; heard after ${Math.round(Math.min(...values) * 1000)} to ${Math.round(Math.max(...values) * 1000)} ms`);
}
writeFileSync(tuningPath, JSON.stringify(tuning, null, 1) + "\n");
writeFileSync(gainPath, JSON.stringify(gains, null, 1) + "\n");
writeFileSync(file, write(ison) + "\n");
console.log(`→ ${file}, tuning.json, levels.json`);
