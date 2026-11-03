// Lecture d'un SoundFont (.sf2) : ses chunks, ses presets, ses instruments, ses échantillons, et ce qu'un preset utilise.
export const str = (b) => String.fromCharCode(...b).replace(/\0.*$/, "");

export function readSf2(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (o) => v.getUint32(o, true), u16 = (o) => v.getUint16(o, true), i16 = (o) => v.getInt16(o, true);
  const id = (o) => str(bytes.subarray(o, o + 4));
  if (id(0) !== "RIFF" || id(8) !== "sfbk") throw new Error("pas un SoundFont");
  const chunks = {}; // "pdta/phdr" → { at, length } (at : le début des données)
  let at = 12;
  while (at < bytes.length) {
    const kind = id(at), length = u32(at + 4);
    if (kind === "LIST") {
      const list = id(at + 8);
      let sub = at + 12;
      while (sub < at + 8 + length) {
        const sid = id(sub), slen = u32(sub + 4);
        chunks[`${list}/${sid}`] = { at: sub + 8, length: slen };
        sub += 8 + slen + (slen % 2);
      }
    }
    at += 8 + length + (length % 2);
  }
  const records = (name, size, read) => {
    const { at, length } = chunks[`pdta/${name}`];
    const out = [];
    for (let o = at; o + size <= at + length; o += size) out.push(read(o));
    return out;
  };
  const gen = (o) => ({ oper: u16(o), amount: u16(o + 2) });
  const mod = (o) => bytes.slice(o, o + 10);
  return {
    bytes, chunks,
    info: chunks["INFO/INAM"] ? str(bytes.subarray(chunks["INFO/INAM"].at, chunks["INFO/INAM"].at + chunks["INFO/INAM"].length)) : "",
    phdr: records("phdr", 38, (o) => ({ name: str(bytes.subarray(o, o + 20)), program: u16(o + 20), bank: u16(o + 22), bag: u16(o + 24), library: u32(o + 26), genre: u32(o + 30), morphology: u32(o + 34) })),
    pbag: records("pbag", 4, (o) => ({ gen: u16(o), mod: u16(o + 2) })),
    pmod: records("pmod", 10, mod),
    pgen: records("pgen", 4, gen),
    inst: records("inst", 22, (o) => ({ name: str(bytes.subarray(o, o + 20)), bag: u16(o + 20) })),
    ibag: records("ibag", 4, (o) => ({ gen: u16(o), mod: u16(o + 2) })),
    imod: records("imod", 10, mod),
    igen: records("igen", 4, gen),
    shdr: records("shdr", 46, (o) => ({ name: str(bytes.subarray(o, o + 20)), start: u32(o + 20), end: u32(o + 24), startLoop: u32(o + 28), endLoop: u32(o + 32), rate: u32(o + 36), pitch: bytes[o + 40], correction: v.getInt8(o + 41), link: u16(o + 42), type: u16(o + 44) })),
  };
}

// Les instruments et les échantillons qu'un preset (par son index dans phdr) utilise.
export function usedBy(sf, presetIndex) {
  const instruments = new Set();
  const [p, next] = [sf.phdr[presetIndex], sf.phdr[presetIndex + 1]];
  for (let b = p.bag; b < next.bag; b++) {
    for (let g = sf.pbag[b].gen; g < sf.pbag[b + 1].gen; g++) if (sf.pgen[g].oper === 41) instruments.add(sf.pgen[g].amount);
  }
  const samples = new Set();
  for (const i of instruments) {
    for (let b = sf.inst[i].bag; b < sf.inst[i + 1].bag; b++) {
      for (let g = sf.ibag[b].gen; g < sf.ibag[b + 1].gen; g++) if (sf.igen[g].oper === 53) samples.add(sf.igen[g].amount);
    }
  }
  for (const s of [...samples]) { // l'autre canal d'un échantillon stéréo
    const h = sf.shdr[s];
    if (h.type & 0x0e && h.link < sf.shdr.length - 1) samples.add(h.link);
  }
  return { instruments, samples };
}
