// Calibrate an instrument said in ison, in one command: every recording in tune, every note heard
// on its beat. Nothing to compute by hand, the results are written into the ison itself.
//
//   node tools/calibrate.js "<instrument.ison.json>"
//
// For each source played from samples (`sfz` or `dspreset`):
// - its recordings' pitch is measured, and the corrections (cents by recording) go to
//   `tuning.json` beside the ison, which the source names (`tuning`): see tools/tuning.js;
// - for each mode played from it, the time each key takes to be heard (the bow catching the
//   string, the breath of a wind) becomes the mode's `speech`: each note then starts that much
//   earlier and sounds on its beat, its attack whole. A single delay for the whole instrument would
//   not do: it changes from one recording to the next (25 to 90 ms for one violin).
//
// Paths: "/__files/samples/…" is the samples disk (SAMPLES, /Volumes/instruments/jmon by default),
// "/__files/…" the jmon folder this package sits in.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { tuningTable } from "./tuning.js";
import { speechTable } from "./speech.js";

const jmon = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const samples = process.env.SAMPLES ?? "/Volumes/instruments/jmon";
const onDisk = (url) => (url.startsWith("/__files/samples/") ? join(samples, url.slice("/__files/samples/".length)) : url.startsWith("/__files/") ? join(jmon, url.slice("/__files/".length)) : url);
const asUrl = (path) => `/__files/${relative(jmon, path)}`;

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
const tuningPath = join(dirname(resolve(file)), "tuning.json");
const tuning = {};
for (const [name, source] of Object.entries(ison.sources ?? {})) {
  const url = source.sfz ?? source.dspreset;
  if (typeof url !== "string") continue;
  const path = onDisk(url);
  const { table, measured, unclear, doubtful } = tuningTable(path);
  Object.assign(tuning, table);
  source.tuning = asUrl(tuningPath);
  console.log(`${name}: ${measured} recordings in tune within 3 cents or corrected (${Object.keys(table).length} corrections), ${unclear} without a clear pitch${doubtful.length ? `, left alone (over 30 cents, check by ear): ${doubtful.join(", ")}` : ""}`);
  const speech = speechTable(path);
  for (const [modeName, mode] of Object.entries(ison.modes ?? {})) {
    if ((mode.source ?? Object.keys(ison.sources)[0]) !== name) continue;
    mode.speech = speech;
    const values = Object.values(speech);
    if (values.length) console.log(`  mode ${modeName}: heard after ${Math.round(Math.min(...values) * 1000)} to ${Math.round(Math.max(...values) * 1000)} ms, by key`);
  }
}
writeFileSync(tuningPath, JSON.stringify(tuning, null, 1) + "\n");
writeFileSync(file, write(ison) + "\n");
console.log(`→ ${file} and ${tuningPath}`);
