// Extrait quelques presets d'un SoundFont dans un nouveau fichier, bien plus petit.
//
//   deno run --allow-read --allow-write tools/sf2-extract.js source.sf2 sortie.sf2 "Nom de la banque" 0:0 0:4 1:15 …
//
// Chaque preset est donné par banque:programme. Seuls les instruments et les échantillons qu'ils utilisent sont copiés, une seule fois.
import { readSf2, usedBy } from "./sf2.js";

const [source, target, name, ...wanted] = Deno.args;
const sf = readSf2(Deno.readFileSync(source));
const bytes = sf.bytes;

// Les presets demandés, dans l'ordre du fichier.
const presetIndexes = [];
for (let i = 0; i < sf.phdr.length - 1; i++) {
  const p = sf.phdr[i];
  if (wanted.includes(`${p.bank}:${p.program}`)) presetIndexes.push(i);
}
const missing = wanted.filter((w) => !presetIndexes.some((i) => `${sf.phdr[i].bank}:${sf.phdr[i].program}` === w));
if (missing.length) throw new Error(`presets introuvables : ${missing.join(" ")}`);

const instrumentSet = new Set();
const sampleSet = new Set();
for (const i of presetIndexes) {
  const { instruments, samples } = usedBy(sf, i);
  for (const x of instruments) instrumentSet.add(x);
  for (const x of samples) sampleSet.add(x);
}
const instruments = [...instrumentSet].sort((a, b) => a - b);
const samples = [...sampleSet].sort((a, b) => sf.shdr[a].start - sf.shdr[b].start);
const newInstrument = new Map(instruments.map((old, i) => [old, i]));
const newSample = new Map(samples.map((old, i) => [old, i]));

// Des écritures binaires, petit-boutiennes.
const parts = { phdr: [], pbag: [], pmod: [], pgen: [], inst: [], ibag: [], imod: [], igen: [], shdr: [] };
const u16 = (n) => new Uint8Array([n & 255, (n >> 8) & 255]);
const u32 = (n) => new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
const name20 = (s) => { const b = new Uint8Array(20); for (let i = 0; i < Math.min(19, s.length); i++) b[i] = s.charCodeAt(i) & 127; return b; };
const genRecord = (g) => new Uint8Array([...u16(g.oper), ...u16(g.amount)]);

// Les échantillons : copiés à la suite, chacun suivi de 46 mots de silence, comme le format le demande.
const smpl = sf.chunks["sdta/smpl"];
const sampleParts = [];
let position = 0; // en mots de 16 bits
for (const old of samples) {
  const h = sf.shdr[old];
  const words = h.end - h.start;
  sampleParts.push(bytes.subarray(smpl.at + h.start * 2, smpl.at + h.end * 2), new Uint8Array(46 * 2));
  const shift = position - h.start;
  parts.shdr.push(new Uint8Array([
    ...name20(h.name), ...u32(position), ...u32(position + words), ...u32(h.startLoop + shift), ...u32(h.endLoop + shift),
    ...u32(h.rate), h.pitch, h.correction & 255, ...u16(h.type & 0x0e ? newSample.get(h.link) ?? 0 : h.link), ...u16(h.type),
  ]));
  position += words + 46;
}
parts.shdr.push(new Uint8Array([...name20("EOS"), ...new Uint8Array(26)]));

// Les instruments, avec leurs zones, générateurs et modulateurs.
for (const old of instruments) {
  const inst = sf.inst[old];
  parts.inst.push(new Uint8Array([...name20(inst.name), ...u16(parts.ibag.length)]));
  for (let b = inst.bag; b < sf.inst[old + 1].bag; b++) {
    parts.ibag.push(new Uint8Array([...u16(parts.igen.length), ...u16(parts.imod.length)]));
    for (let g = sf.ibag[b].gen; g < sf.ibag[b + 1].gen; g++) {
      const gen = sf.igen[g];
      parts.igen.push(genRecord(gen.oper === 53 ? { oper: 53, amount: newSample.get(gen.amount) } : gen));
    }
    for (let m = sf.ibag[b].mod; m < sf.ibag[b + 1].mod; m++) parts.imod.push(sf.imod[m]);
  }
}
parts.inst.push(new Uint8Array([...name20("EOI"), ...u16(parts.ibag.length)]));
parts.ibag.push(new Uint8Array([...u16(parts.igen.length), ...u16(parts.imod.length)]));
parts.igen.push(new Uint8Array(4));
parts.imod.push(new Uint8Array(10));

// Les presets.
for (const i of presetIndexes) {
  const p = sf.phdr[i];
  parts.phdr.push(new Uint8Array([...name20(p.name), ...u16(p.program), ...u16(p.bank), ...u16(parts.pbag.length), ...u32(p.library), ...u32(p.genre), ...u32(p.morphology)]));
  for (let b = p.bag; b < sf.phdr[i + 1].bag; b++) {
    parts.pbag.push(new Uint8Array([...u16(parts.pgen.length), ...u16(parts.pmod.length)]));
    for (let g = sf.pbag[b].gen; g < sf.pbag[b + 1].gen; g++) {
      const gen = sf.pgen[g];
      parts.pgen.push(genRecord(gen.oper === 41 ? { oper: 41, amount: newInstrument.get(gen.amount) } : gen));
    }
    for (let m = sf.pbag[b].mod; m < sf.pbag[b + 1].mod; m++) parts.pmod.push(sf.pmod[m]);
  }
}
parts.phdr.push(new Uint8Array([...name20("EOP"), ...u16(0), ...u16(0), ...u16(parts.pbag.length), ...u32(0), ...u32(0), ...u32(0)]));
parts.pbag.push(new Uint8Array([...u16(parts.pgen.length), ...u16(parts.pmod.length)]));
parts.pgen.push(new Uint8Array(4));
parts.pmod.push(new Uint8Array(10));

// Le fichier : RIFF, puis les listes INFO (copiée, avec le nouveau nom), sdta et pdta.
const concat = (list) => { const out = new Uint8Array(list.reduce((n, b) => n + b.length, 0)); let o = 0; for (const b of list) { out.set(b, o); o += b.length; } return out; };
const chunk = (id, data) => concat([new TextEncoder().encode(id), u32(data.length), data, new Uint8Array(data.length % 2)]);
const list = (kind, chunks) => chunk("LIST", concat([new TextEncoder().encode(kind), ...chunks]));

const infoChunks = [];
for (const [key, { at, length }] of Object.entries(sf.chunks)) {
  if (!key.startsWith("INFO/")) continue;
  const id = key.slice(5);
  if (id === "INAM") infoChunks.push(chunk("INAM", new TextEncoder().encode(name + "\0")));
  else if (id === "ICMT") infoChunks.push(chunk("ICMT", new TextEncoder().encode(`Extrait de ${sf.info} : ${wanted.join(" ")}. ${str(bytes.subarray(at, at + length))}\0`)));
  else infoChunks.push(chunk(id, bytes.slice(at, at + length)));
}
const pdta = list("pdta", ["phdr", "pbag", "pmod", "pgen", "inst", "ibag", "imod", "igen", "shdr"].map((id) => chunk(id, concat(parts[id]))));
const body = concat([new TextEncoder().encode("sfbk"), list("INFO", infoChunks), list("sdta", [chunk("smpl", concat(sampleParts))]), pdta]);
Deno.writeFileSync(target, concat([new TextEncoder().encode("RIFF"), u32(body.length), body]));
console.log(`${target.split("/").pop()} : ${presetIndexes.length} presets, ${instruments.length} instruments, ${samples.length} échantillons, ${(body.length / 1e6).toFixed(0)} Mo`);

function str(b) { return String.fromCharCode(...b).replace(/\0.*$/, ""); }
