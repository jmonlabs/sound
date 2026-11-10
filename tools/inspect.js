// What an instrument holds, measured before anything is built on it: does it have a recorded
// vibrato, how many forces and takes, how fast its notes speak, how in tune its recordings are.
//
//   node tools/inspect.js "<instrument.sfz or preset.dspreset>"   one instrument, in words
//   node tools/inspect.js --index <folder> [library…]              every instrument of index.json
//                                                                   (tools/sfz-index.js), or of the
//                                                                   libraries named, into inspect.json
//
// The layout comes from the file (keys, velocity layers, round robins, controller crossfades,
// legato, release sounds, key switches). The sound is measured on a few recordings spread over the
// range, at the loudest layer: their pitch over time (tuning, vibrato) and their speech (from the
// first sound to -6 dB of the peak).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dspresetToSfz } from "../src/dspreset.js";
import { parseSfz, readWav } from "../src/sfz-parse.js";
import { decode, medianPitch, speechOf, vibratoOf } from "./measure.js";

const MEASURED = 6;

const read = (file) => {
  const text = readFileSync(file, "utf8");
  const sfz = /\.dspreset$/i.test(file) ? dspresetToSfz(text) : text;
  return parseSfz(sfz, { include: (path) => readFileSync(join(dirname(file), path), "utf8") });
};

/** The layout of an instrument, from its regions alone. */
export function layoutOf(regions) {
  const attacks = regions.filter((r) => !["release", "release_key"].includes(r.trigger ?? "attack"));
  const keys = attacks.flatMap((r) => [r.lokey ?? 0, r.hikey ?? 127]);
  const layers = new Map(); // key → distinct velocity ranges
  const rounds = new Map(); // key + velocity range → takes
  for (const r of attacks) {
    if (r.sw_previous !== undefined || r.trigger === "legato") continue;
    for (let k = r.lokey ?? 0; k <= (r.hikey ?? 127) && k <= 127; k++) {
      const range = `${r.lovel ?? 1}-${r.hivel ?? 127}`;
      (layers.get(k) ?? layers.set(k, new Set()).get(k)).add(range);
      // takes of the same note at the same force: the regions that differ only by round robin or chance
      const fades = Object.keys(r).filter((o) => /^xf/.test(o)).sort().map((o) => `${o}=${r[o]}`).join(" ");
      const take = `${k}|${range}|${fades}|${r.trigger ?? "attack"}`;
      rounds.set(take, (rounds.get(take) ?? 0) + 1);
    }
  }
  const crossfaded = new Set();
  const wheelLayers = new Map(); // controller|key → the different fades it makes (one per recorded force)
  for (const r of attacks) {
    const numbers = new Set();
    for (const opcode of Object.keys(r)) {
      const m = /^xf(?:in|out)_(?:lo|hi)cc(\d+)$/.exec(opcode) ?? /^amplitude_(?:on)?cc(\d+)$/.exec(opcode);
      if (m) { crossfaded.add(Number(m[1])); if (/^xf/.test(opcode)) numbers.add(m[1]); }
    }
    for (const n of numbers) {
      const fade = ["xfin_locc", "xfin_hicc", "xfout_locc", "xfout_hicc"].map((o) => r[`${o}${n}`]).join(",");
      for (let k = r.lokey ?? 0; k <= (r.hikey ?? 127) && k <= 127; k++) {
        const id = `${n}|${k}`;
        (wheelLayers.get(id) ?? wheelLayers.set(id, new Set()).get(id)).add(fade);
      }
    }
  }
  const most = (map) => Math.max(0, ...[...map.values()].map((v) => (v instanceof Set ? v.size : v)));
  return {
    keys: keys.length ? [Math.max(0, Math.min(...keys)), Math.min(127, Math.max(...keys))] : null,
    recordings: new Set(regions.map((r) => r.sample)).size,
    velocityLayers: most(layers),
    // forces recorded apart and faded into one another by a controller (the mod wheel), not by velocity
    wheelLayers: most(wheelLayers) > 1 ? most(wheelLayers) : 1,
    takes: Math.max(1, Math.min(most(rounds), Math.max(1, ...attacks.map((r) => r.seq_length ?? 1)) * (attacks.some((r) => r.lorand !== undefined || r.hirand !== undefined) ? 8 : 1))),
    controllers: [...crossfaded].sort((a, b) => a - b),
    legato: regions.some((r) => r.trigger === "legato" || r.sw_previous !== undefined),
    releaseSounds: regions.some((r) => r.trigger === "release"),
    keyswitches: regions.some((r) => r.sw_lokey !== undefined || r.sw_last !== undefined),
    loops: regions.some((r) => r.loop_mode === "loop_continuous" || r.loop_mode === "loop_sustain" || r.loop_start !== undefined),
  };
}

/** A few recordings to measure: the loudest layer's, spread over the range, one per key centre. */
function chosen(regions) {
  const plain = regions.filter((r) => ["attack", "first"].includes(r.trigger ?? "attack") && r.sw_previous === undefined && r.sample);
  const top = Math.max(0, ...plain.map((r) => r.hivel ?? 127));
  const loud = plain.filter((r) => (r.hivel ?? 127) === top);
  const byKey = new Map();
  for (const r of loud) if (!byKey.has(r.pitch_keycenter ?? 60)) byKey.set(r.pitch_keycenter ?? 60, r);
  const list = [...byKey.values()].sort((a, b) => (a.pitch_keycenter ?? 60) - (b.pitch_keycenter ?? 60));
  if (list.length <= MEASURED) return list;
  return Array.from({ length: MEASURED }, (_, i) => list[Math.round((i * (list.length - 1)) / (MEASURED - 1))]);
}

/** One instrument: its layout and what its recordings sound like. */
export function inspect(file) {
  const { regions } = read(file);
  const layout = layoutOf(regions);
  const sound = { tuning: [], vibrato: [], speech: [] };
  for (const r of chosen(regions)) {
    const path = join(dirname(file), r.sample);
    if (!existsSync(path)) continue;
    let x;
    try { x = decode(path); } catch { continue; }
    const expected = 440 * 2 ** (((r.pitch_keycenter ?? 60) - 69 + (r.tune ?? 0) / 100) / 12);
    const pitch = medianPitch(x, expected);
    if (pitch && pitch.clarity >= 0.8) sound.tuning.push(Math.round(pitch.cents));
    const vibrato = vibratoOf(x, expected);
    if (vibrato) sound.vibrato.push(vibrato);
    const speech = speechOf(x);
    if (speech !== null) sound.speech.push(speech);
    // a loop written in the WAV file itself (its smpl chunk), which the SFZ need not repeat
    if (/\.wav$/i.test(path) && !layout.loops) {
      const bytes = readFileSync(path);
      if (readWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length))?.loop) layout.loops = true;
    }
  }
  const vibrating = sound.vibrato.filter((v) => v.depth >= 5 && v.rate >= 3.5 && v.rate <= 8.5);
  return {
    ...layout,
    measured: sound.speech.length,
    tuning: sound.tuning.length ? [Math.min(...sound.tuning), Math.max(...sound.tuning)] : null,
    vibrato: sound.vibrato.length === 0 ? null : vibrating.length >= Math.ceil(sound.vibrato.length / 2)
      ? { depth: Math.round(vibrating.reduce((s, v) => s + v.depth, 0) / vibrating.length), rate: +(vibrating.reduce((s, v) => s + v.rate, 0) / vibrating.length).toFixed(1) }
      : false,
    speech: sound.speech.length ? [Math.min(...sound.speech), Math.max(...sound.speech)] : null,
  };
}

/** One line, in French, for the explorer and for a person deciding. */
export function summary(i) {
  const parts = [];
  if (i.vibrato) parts.push(`vibrato enregistré (±${i.vibrato.depth} cents, ${i.vibrato.rate} Hz)`);
  else if (i.vibrato === false) parts.push("pas de vibrato enregistré");
  const forces = Math.max(i.velocityLayers, i.wheelLayers ?? 1);
  parts.push(forces > 1 ? `${forces} forces${i.wheelLayers > 1 ? " (à la molette)" : ""}` : "1 force");
  if (i.controllers.length) parts.push(`molette : CC${i.controllers.join(", CC")}`);
  if (i.takes > 1) parts.push(`${i.takes} prises`);
  if (i.legato) parts.push("legato");
  if (i.releaseSounds) parts.push("sons de relâche");
  if (i.keyswitches) parts.push("articulations par touches");
  if (i.speech) parts.push(`parle en ${i.speech[0]}–${i.speech[1]} ms`);
  if (i.tuning) parts.push(`justesse ${i.tuning[0] > 0 ? "+" : ""}${i.tuning[0]} à ${i.tuning[1] > 0 ? "+" : ""}${i.tuning[1]} cents`);
  if (!i.loops) parts.push("sans boucle");
  return parts.join(", ");
}

const main = () => {
  const args = process.argv.slice(2);
  if (args[0] === "--index") {
    const [, root, ...libraries] = args;
    const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8"));
    const out = existsSync(join(root, "inspect.json")) ? JSON.parse(readFileSync(join(root, "inspect.json"), "utf8")) : {};
    for (const item of index) {
      if (libraries.length && !libraries.some((l) => item.library === l || item.library.startsWith(`${l}/`))) continue;
      try {
        const found = inspect(join(root, item.path));
        out[item.path] = { ...found, summary: summary(found) };
        console.log(`${item.path}: ${out[item.path].summary}`);
      } catch (error) {
        console.log(`${item.path}: ${error.message}`);
      }
      writeFileSync(join(root, "inspect.json"), JSON.stringify(out, null, 1));
    }
    return;
  }
  if (!args[0]) { console.error('usage : node tools/inspect.js "<instrument.sfz | preset.dspreset>"  |  --index <dossier> [bibliothèque…]'); process.exit(1); }
  const found = inspect(args[0]);
  console.log(summary(found));
  console.log(JSON.stringify(found));
};

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) main();
