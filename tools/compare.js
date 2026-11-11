// Compare instruments of the same kind on what makes a solo voice: every recording that plays a
// note (the loudest layer, a first or plain attack) is measured, several at a time.
//
//   node tools/compare.js "<a.sfz>" "<b.dspreset>" …
//
// For each: recorded vibrato (share of recordings with one, width, speed), tuning (median and
// worst, cents), level spread from key to key (dB, 10th to 90th percentile), muffled takes (more
// than 5 dB less above 3 kHz than their neighbours), how long notes take to be heard, how long the
// recordings last, forces (velocity layers, or faded by a controller), legato.
import { readFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { dspresetToSfz } from "../src/dspreset.js";
import { parseSfz } from "../src/sfz-parse.js";
import { RATE, colourOf, decodeLater, eachAtOnce, heardAt, medianPitch, vibratoOf } from "./measure.js";
import { layoutOf } from "./inspect.js";

const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
const quantile = (v, k) => [...v].sort((a, b) => a - b)[Math.floor(k * (v.length - 1))];

export async function compare(file) {
  const text = readFileSync(file, "utf8");
  const { regions } = parseSfz(/\.dspreset$/i.test(file) ? dspresetToSfz(text) : text, { include: (p) => readFileSync(join(dirname(file), p), "utf8") });
  const layout = layoutOf(regions);
  const plain = regions.filter((r) => ["attack", "first"].includes(r.trigger ?? "attack") && r.sw_previous === undefined && r.sample);
  const top = Math.max(0, ...plain.map((r) => r.hivel ?? 127));
  const byKey = new Map();
  for (const r of plain.filter((r) => (r.hivel ?? 127) === top)) if (!byKey.has(r.pitch_keycenter ?? 60)) byKey.set(r.pitch_keycenter ?? 60, r);
  const list = [...byKey.entries()].sort((a, b) => a[0] - b[0]);
  const rows = (await eachAtOnce(list, async ([key, r]) => {
    let x; try { x = await decodeLater(join(dirname(file), r.sample)); } catch { return null; }
    const expected = 440 * 2 ** ((key - 69 - (r.tune ?? 0) / 100) / 12);
    return { key, seconds: x.length / RATE, pitch: medianPitch(x, expected), vibrato: vibratoOf(x, expected), colour: colourOf(x), heard: heardAt(x, Math.round(((r.offset ?? 0) * RATE) / 44100)) };
  })).filter(Boolean);
  const tuned = rows.filter((r) => r.pitch && r.pitch.clarity >= 0.8 && Math.abs(r.pitch.cents) <= 50).map((r) => r.pitch.cents);
  const vib = rows.filter((r) => r.vibrato);
  const vibrating = vib.filter((r) => r.vibrato.depth >= 5 && r.vibrato.rate >= 3.5 && r.vibrato.rate <= 8.5);
  const levels = rows.filter((r) => r.colour).map((r) => r.colour.level);
  let dull = 0;
  rows.forEach((r, i) => {
    const near = rows.filter((_, j) => j !== i && Math.abs(j - i) <= 2 && rows[j].colour).map((n) => n.colour.bright);
    if (r.colour && near.length >= 2 && r.colour.bright < median(near) - 5) dull++;
  });
  return {
    recordings: rows.length,
    keys: layout.keys,
    forces: Math.max(layout.velocityLayers, layout.wheelLayers ?? 1),
    legato: layout.legato,
    vibrato: vib.length ? `${vibrating.length}/${vib.length}${vibrating.length ? `, ±${median(vibrating.map((r) => r.vibrato.depth))} cents ${median(vibrating.map((r) => r.vibrato.rate))} Hz` : ""}` : "trop courts pour le dire",
    tuning: tuned.length ? `médiane ${Math.round(median(tuned))}, pire ${Math.round(Math.max(...tuned.map(Math.abs)))} cents` : "pas de hauteur claire",
    levelSpread: levels.length ? +(quantile(levels, 0.9) - quantile(levels, 0.1)).toFixed(1) : null,
    muffled: dull,
    heardMs: rows.length ? `${Math.round(Math.min(...rows.map((r) => r.heard ?? 0)) * 1000)}–${Math.round(Math.max(...rows.map((r) => r.heard ?? 0)) * 1000)}` : null,
    seconds: rows.length ? +median(rows.map((r) => r.seconds)).toFixed(1) : null,
    loops: layout.loops,
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  for (const file of process.argv.slice(2)) {
    try { console.log(`${basename(file)}: ${JSON.stringify(await compare(file))}`); } catch (e) { console.log(`${basename(file)}: ${e.message}`); }
  }
}
