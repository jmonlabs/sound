// How long each note of an instrument takes to be heard, from the moment it is played: the time
// from the start of its recording (where the file starts it) to -10 dB of its peak. A bowed note
// speaks late, the bow catching the string; an ison mode that gives these times (`speech`) starts
// each note that much earlier, so it is heard on the beat, its attack whole.
//
//   node tools/speech.js "<instrument.sfz or preset.dspreset>" [out.json]
//
// Writes { "<MIDI key>": seconds } for every key the instrument plays, from the recording that
// plays it (the loudest layer, a first or plain attack, not a legato transition).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dspresetToSfz } from "../src/dspreset.js";
import { parseSfz } from "../src/sfz-parse.js";
import { avoidRecordings } from "../src/sfz.js";
import { decode, heardAt, RATE } from "./measure.js";

/** When each key of one SFZ or preset is heard: { MIDI key: seconds }. */
export function speechTable(file, { avoid = [] } = {}) {
  const text = readFileSync(file, "utf8");
  const { regions: parsed } = parseSfz(/\.dspreset$/i.test(file) ? dspresetToSfz(text) : text, { include: (path) => readFileSync(join(dirname(file), path), "utf8") });
  const regions = avoidRecordings(parsed, avoid);
  const plain = regions.filter((r) => ["attack", "first"].includes(r.trigger ?? "attack") && r.sw_previous === undefined && r.sample);
  const top = Math.max(0, ...plain.map((r) => r.hivel ?? 127));
  const measured = new Map();
  const table = {};
  for (const r of plain.filter((r) => (r.hivel ?? 127) === top)) {
    const key = `${r.sample}|${r.offset ?? 0}`;
    if (!measured.has(key)) {
      let at = null;
      try { at = heardAt(decode(join(dirname(file), r.sample)), Math.round(((r.offset ?? 0) * RATE) / 44100)); } catch { at = null; }
      measured.set(key, at);
    }
    const at = measured.get(key);
    if (at === null) continue;
    for (let k = r.lokey ?? 0; k <= Math.min(127, r.hikey ?? 127); k++) table[k] = Math.max(table[k] ?? 0, at);
  }
  return table;
}

const main = () => {
  const [file, out] = process.argv.slice(2);
  if (!file) { console.error('usage : node tools/speech.js "<instrument.sfz | preset.dspreset>" [out.json]'); process.exit(1); }
  const table = speechTable(file);
  const destination = out ?? file.replace(/\.(sfz|dspreset)$/i, ".speech.json");
  writeFileSync(destination, JSON.stringify(table, null, 1) + "\n");
  const values = Object.values(table);
  console.log(`${values.length} keys, heard after ${Math.min(...values)}–${Math.max(...values)} s → ${destination}`);
};

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) main();
