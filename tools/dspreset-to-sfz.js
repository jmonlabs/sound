// Un preset Decent Sampler (.dspreset) traduit en SFZ, que jmon/sound joue.
//
//   node tools/dspreset-to-sfz.js "chemin/vers/Instrument.dspreset"
//
// Le .dspreset est un fichier XML posé à côté de ses WAV : des groupes, des
// échantillons avec leurs notes, leurs vélocités, leurs boucles et leurs
// enveloppes, des prises alternées. Tout cela se dit presque mot pour mot en
// SFZ. Ce qui ne se traduit pas, c'est l'interface du preset (boutons, images)
// ; à la place :
//
// - les groupes que le preset fond l'un dans l'autre avec un bouton (des
//   tables de volume, `translationTable`) deviennent un fondu à la molette
//   (CC1), `xfin_locc1` / `xfout_locc1` ;
// - les groupes que le preset allume un à un (des articulations, des micros)
//   deviennent un .sfz chacun, à côté du preset : « Instrument - Groupe.sfz ».
//   Le fichier « Instrument.sfz » garde les groupes allumés au chargement.
//
// Rien n'est modifié : ni le preset, ni les WAV. Les chemins restent relatifs,
// les .sfz sont écrits dans le dossier du preset.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, basename, join } from "node:path";

const file = process.argv[2];
if (!file) {
  console.error('usage : node tools/dspreset-to-sfz.js "Instrument.dspreset"');
  process.exit(1);
}
const xml = readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "");
const folder = dirname(file);
const name = basename(file, ".dspreset");

/** The attributes of one XML tag, as an object. */
const attributes = (tag) => {
  const out = {};
  for (const m of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
};
const db = (value) => (value === undefined ? undefined : parseFloat(String(value).replace(/dB$/i, "")));

// The volume tables a control applies to groups, by group position: [[x, y], …], x and y from 0 to 1.
const tables = {};
for (const m of xml.matchAll(/<binding\b[^>]*>/g)) {
  const a = attributes(m[0]);
  if (a.type === "amp" && a.level === "group" && a.parameter === "AMP_VOLUME" && a.translationTable) {
    tables[Number(a.position)] = a.translationTable.split(";").map((pair) => pair.split(",").map(Number));
  }
}

/** A volume table as an SFZ crossfade on CC1: where it rises from 0, and where it falls back to 0. */
const crossfade = (table) => {
  const out = [];
  const cc = (x) => Math.round(Math.max(0, Math.min(1, x)) * 127);
  for (let i = 1; i < table.length; i++) {
    const [x0, y0] = table[i - 1], [x1, y1] = table[i];
    if (y0 <= 0.001 && y1 > 0.001) out.push(`xfin_locc1=${cc(x0)} xfin_hicc1=${cc(x1)}`);
    if (y0 > 0.001 && y1 <= 0.001) out.push(`xfout_locc1=${cc(x0)} xfout_hicc1=${cc(x1)}`);
  }
  return out.join(" ");
};

/** The SFZ opcodes for the attributes a group or a sample shares. */
const common = (a) => {
  const out = [];
  if (a.volume !== undefined) out.push(`volume=${db(a.volume)}`);
  if (a.tuning !== undefined && parseFloat(a.tuning) !== 0) out.push(`tune=${Math.round(parseFloat(a.tuning) * 100)}`);
  if (a.pan !== undefined && parseFloat(a.pan) !== 0) out.push(`pan=${parseFloat(a.pan)}`);
  if (a.ampVelTrack !== undefined) out.push(`amp_veltrack=${Math.round(parseFloat(a.ampVelTrack) * 100)}`);
  if (a.loNote !== undefined) out.push(`lokey=${a.loNote}`);
  if (a.hiNote !== undefined) out.push(`hikey=${a.hiNote}`);
  if (a.rootNote !== undefined) out.push(`pitch_keycenter=${a.rootNote}`);
  if (a.loVel !== undefined) out.push(`lovel=${a.loVel}`);
  if (a.hiVel !== undefined) out.push(`hivel=${a.hiVel}`);
  if (a.trigger === "release") out.push("trigger=release");
  if (a.ampEnvEnabled !== "false") {
    if (a.attack !== undefined) out.push(`ampeg_attack=${a.attack}`);
    if (a.decay !== undefined) out.push(`ampeg_decay=${a.decay}`);
    if (a.sustain !== undefined) out.push(`ampeg_sustain=${Math.round(parseFloat(a.sustain) * 100)}`);
    if (a.release !== undefined) out.push(`ampeg_release=${a.release}`);
  }
  return out;
};

// The groups, in order, with their samples.
const groups = [];
for (const m of xml.matchAll(/<group\b([^>]*)>([\s\S]*?)<\/group>/g)) {
  const a = attributes(`<group ${m[1]}>`);
  const samples = [...m[2].matchAll(/<sample\b[^>]*\/?>/g)].map((s) => attributes(s[0]));
  groups.push({ a, samples, position: groups.length });
}

/** One group as SFZ: its <group> header, then a <region> per sample whose file exists. */
const groupSfz = (group, { withCrossfade }) => {
  const a = group.a;
  const head = common(a);
  if (a.seqMode === "round_robin" || a.seqMode === "true_random" || a.seqMode === "random") {
    if (a.seqMode === "round_robin" && a.seqLength) head.push(`seq_length=${a.seqLength}`);
  }
  if (withCrossfade && tables[group.position]) head.push(crossfade(tables[group.position]));
  const lines = [`<group> ${head.join(" ")}`.trimEnd() + (a.name ? `  // ${a.name}` : "")];
  let kept = 0;
  const seqLength = Number(a.seqLength) || 1;
  for (const s of group.samples) {
    if (!s.path || !existsSync(join(folder, s.path))) continue;
    if (/silence/i.test(s.path)) continue;
    const r = [`sample=${s.path}`, ...common(s)];
    if (s.start !== undefined && Number(s.start) > 0) r.push(`offset=${s.start}`);
    if (s.end !== undefined) r.push(`end=${s.end}`);
    if (s.loopEnabled === "true" && s.loopStart !== undefined) r.push("loop_mode=loop_continuous", `loop_start=${s.loopStart}`, `loop_end=${s.loopEnd}`);
    if (s.seqPosition !== undefined && seqLength > 1) {
      const k = Number(s.seqPosition);
      if (a.seqMode === "round_robin") r.push(`seq_position=${k}`);
      else r.push(`lorand=${((k - 1) / seqLength).toFixed(4)} hirand=${(k / seqLength).toFixed(4)}`);
    }
    lines.push(`<region> ${r.join(" ")}`);
    kept++;
  }
  return kept > 0 ? lines.join("\n") : null;
};

const header = (what) => `// ${name}${what ? " - " + what : ""}\n// Traduit de « ${basename(file)} » (Decent Sampler) par jmon/sound tools/dspreset-to-sfz.js. Le preset et ses WAV ne sont pas modifiés.\n`;
const written = [];

// The main file: the groups on at load, crossfaded at the mod wheel when the preset does it.
const crossfaded = Object.keys(tables).length > 0;
const main = groups
  .filter((g) => g.a.enabled !== "false")
  .map((g) => groupSfz(g, { withCrossfade: crossfaded }))
  .filter(Boolean);
if (main.length > 0) {
  const out = join(folder, `${name}.sfz`);
  writeFileSync(out, header("") + (crossfaded ? "// Les groupes se fondent à la molette (CC1).\n" : "") + main.join("\n\n") + "\n");
  written.push(out);
}

// One file per group the preset switches on and off (an articulation, a microphone), when there are several.
const switchable = groups.filter((g) => g.a.tags || g.a.enabled === "false");
if (switchable.length > 1) {
  for (const g of switchable) {
    const body = groupSfz(g, { withCrossfade: false });
    if (!body) continue;
    const label = (g.a.name || `groupe ${g.position + 1}`).replace(/[\\/:*?"<>|]/g, "-");
    const out = join(folder, `${name} - ${label}.sfz`);
    writeFileSync(out, header(label) + body.replace(/^<group>[^\n]*/, (line) => line) + "\n");
    written.push(out);
  }
}

for (const out of written) console.log(out);
if (written.length === 0) console.log("aucun groupe n'a d'échantillon présent : rien d'écrit");
