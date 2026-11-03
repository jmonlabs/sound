// Les presets d'un SoundFont, et ce que chacun pèse (ses instruments, ses échantillons, en Mo).
//
//   deno run --allow-read tools/sf2-presets.js banque.sf2
import { readSf2, usedBy } from "./sf2.js";
const sf = readSf2(Deno.readFileSync(Deno.args[0]));
console.log(sf.info, "| chunks :", Object.keys(sf.chunks).join(" "));
for (let i = 0; i < sf.phdr.length - 1; i++) {
  const p = sf.phdr[i];
  const { instruments, samples } = usedBy(sf, i);
  let bytes = 0;
  for (const s of samples) bytes += (sf.shdr[s].end - sf.shdr[s].start) * 2;
  console.log(`${p.bank}:${String(p.program).padStart(3)}  ${p.name.padEnd(22)} ${String(instruments.size).padStart(2)} instr. ${String(samples.size).padStart(4)} éch. ${(bytes / 1e6).toFixed(0).padStart(4)} Mo`);
}
