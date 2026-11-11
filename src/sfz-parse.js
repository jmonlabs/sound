/**
 * Reading SFZ files: https://sfzformat.com
 *
 * An SFZ instrument is a text file and a folder of recordings. The text says,
 * for each recording, which keys and velocities it answers, how it is tuned,
 * how loud it is, how it starts and ends. Headers set opcodes for what
 * follows them, each level inheriting from the one above:
 *
 *     <control>  default_path, set_ccN (a controller's starting value)
 *     <global>   for the whole file
 *     <master>   for the groups after it
 *     <group>    for the regions after it
 *     <region>   one recording
 *     <curve>    a shape a controller follows (curve_index, v000…v127)
 *
 * This file only reads: parseSfz turns the text into a flat list of regions,
 * each with every opcode it inherits, and nothing here touches audio.
 */

const NOTE_OFFSETS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/**
 * A key as SFZ writes it — a MIDI number or a note name, middle C being c4 —
 * as a MIDI number.
 *
 * @param {string|number} value - "60", "c4", "c#4", "db4"
 * @returns {number|null}
 */
export function sfzKey(value) {
  const text = String(value).trim().toLowerCase();
  if (/^-?\d+$/.test(text)) return Number(text);
  const match = /^([a-g])([#b]?)(-?\d+)$/.exec(text);
  if (!match) return null;
  const [, letter, accidental, octave] = match;
  const shift = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  return (Number(octave) + 1) * 12 + NOTE_OFFSETS[letter] + shift;
}

/** Opcodes whose value is a key, read as MIDI numbers. */
const KEY_OPCODES = new Set([
  "key", "lokey", "hikey", "pitch_keycenter",
  "sw_lokey", "sw_hikey", "sw_last", "sw_default", "sw_down", "sw_up", "sw_previous",
  "xfin_lokey", "xfin_hikey", "xfout_lokey", "xfout_hikey", "fil_keycenter",
]);

/** Opcodes whose value is text; the rest are numbers. */
const TEXT_OPCODES = new Set([
  "sample", "default_path", "trigger", "loop_mode", "off_mode", "fil_type",
  "group_label", "sw_label", "xf_velcurve", "xf_keycurve",
]);

/**
 * The words of an SFZ file: headers and `opcode=value` pairs, comments
 * removed. A value runs up to the next opcode, so a sample path may contain
 * spaces ("Solo Contrabass/…wav").
 */
function tokens(text) {
  const out = [];
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const rawLine of withoutComments.split(/\r?\n|\r/)) {
    const line = rawLine.replace(/\/\/.*$/, "");
    const pattern = /<(\w+)>|([A-Za-z0-9_$]+)=/g;
    const marks = [...line.matchAll(pattern)];
    marks.forEach((mark, k) => {
      if (mark[1]) {
        out.push({ header: mark[1].toLowerCase() });
        return;
      }
      const end = k + 1 < marks.length ? marks[k + 1].index : line.length;
      out.push({ opcode: mark[2], value: line.slice(mark.index + mark[0].length, end).trim() });
    });
  }
  return out;
}

/** An opcode's value, as the type the rest of the package expects. */
function readValue(opcode, value) {
  if (TEXT_OPCODES.has(opcode)) return value;
  if (KEY_OPCODES.has(opcode)) return sfzKey(value);
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

/**
 * Parse an SFZ file.
 *
 * `#define $NAME value` is substituted; `#include "file"` is resolved with
 * the `include` callback, which returns that file's text (the loader fetches
 * it; tests pass a table).
 *
 * @param {string} text
 * @param {Object} [options]
 * @param {(path: string) => string} [options.include]
 * @returns {{ control: Object, regions: Array<Object> }} each region has
 *   every opcode it inherits, and `sample` joined to `default_path` with
 *   forward slashes
 */
export function parseSfz(text, { include } = {}) {
  const defines = {};
  const expanded = expandDirectives(text, defines, include);

  const control = {};
  let global = {};
  let master = {};
  let group = {};
  let groups = 0; // each <group> header gets a number, `group_index` in its regions: two groups may play the same recording
  let region = null;
  let current = null;
  const regions = [];
  const curves = [];

  const closeRegion = () => {
    if (region) regions.push(region);
    region = null;
  };

  for (const token of tokens(expanded)) {
    if (token.header) {
      closeRegion();
      switch (token.header) {
        case "control": current = control; break;
        case "global": global = {}; master = {}; group = {}; current = global; break;
        case "master": master = {}; group = {}; current = master; break;
        case "group": groups++; group = {}; current = group; break;
        case "region": region = { ...global, ...master, ...group, group_index: groups }; current = region; break;
        case "curve": current = {}; curves.push(current); break;
        default: current = null; // <effect>, <midi>: not read
      }
      continue;
    }
    if (!current) continue;
    current[token.opcode] = readValue(token.opcode, token.value);
  }
  closeRegion();

  // A curve (`<curve> curve_index=7 v000=0 … v127=1`) is the shape a
  // controller's opcode follows (`eq1_gain_curvecc1=7`): the region carries
  // the 128 points instead of the number.
  const shapes = {};
  for (const c of curves) if (typeof c.curve_index === "number") shapes[c.curve_index] = curvePoints(c);
  for (const r of regions) {
    for (const [opcode, value] of Object.entries(r)) {
      if (/_curvecc\d+$/.test(opcode) && shapes[value]) r[opcode] = shapes[value];
    }
  }

  for (const r of regions) {
    // `key` is shorthand for a single key, tuned to itself.
    if (typeof r.key === "number") {
      r.lokey ??= r.key;
      r.hikey ??= r.key;
      r.pitch_keycenter ??= r.key;
    }
    if (typeof r.sample === "string") {
      r.sample = `${control.default_path ?? ""}${r.sample}`.replace(/\\/g, "/");
    }
  }
  return { control, regions };
}

/** A curve's 128 values, the ones it does not give drawn as straight lines between those it does. */
function curvePoints(curve) {
  const given = [];
  for (const [opcode, value] of Object.entries(curve)) {
    const m = /^v(\d+)$/.exec(opcode);
    if (m && typeof value === "number") given.push([Number(m[1]), value]);
  }
  given.sort((a, b) => a[0] - b[0]);
  if (!given.length) return null;
  const points = [];
  for (let x = 0; x < 128; x++) {
    const after = given.findIndex(([at]) => at >= x);
    if (after === -1) points.push(given[given.length - 1][1]);
    else if (after === 0 || given[after][0] === x) points.push(given[after][1]);
    else {
      const [x0, y0] = given[after - 1], [x1, y1] = given[after];
      points.push(y0 + (y1 - y0) * (x - x0) / (x1 - x0));
    }
  }
  return points;
}

/** Apply `#define` and `#include`, recursively. */
function expandDirectives(text, defines, include, depth = 0) {
  if (depth > 16) throw new Error("SFZ #include nested too deep");
  const lines = [];
  for (const line of text.split(/\r?\n|\r/)) {
    const define = /^\s*#define\s+(\$\w+)\s+(.*?)\s*$/.exec(line);
    if (define) {
      defines[define[1]] = define[2];
      continue;
    }
    const substituted = line.replace(/\$\w+/g, (name) => defines[name] ?? name);
    const included = /^\s*#include\s+"([^"]+)"/.exec(substituted);
    if (included) {
      if (!include) throw new Error(`SFZ #include "${included[1]}" with no way to read it`);
      lines.push(expandDirectives(include(included[1]), defines, include, depth + 1));
      continue;
    }
    lines.push(substituted);
  }
  return lines.join("\n");
}

/** The `#include` paths of a file, so a loader can fetch them first. */
export function sfzIncludes(text) {
  return [...text.matchAll(/^\s*#include\s+"([^"]+)"/gm)].map((m) => m[1]);
}

/**
 * A WAV file's audio and the loop its `smpl` chunk carries.
 *
 * Read here rather than by the browser's decodeAudioData, which resamples a
 * recording to the context's rate: Firefox then smears the last samples, and
 * a loop that ends on the file's last frame clicks every time it comes round.
 * A buffer kept at the file's own rate is resampled while it plays, across
 * the loop's join like anywhere else.
 *
 * @param {ArrayBuffer} bytes - the whole file
 * @returns {{sampleRate: number, channels: Float32Array[], loop: {start: number, end: number}|null}|null}
 *   `null` when the file is not PCM or float WAV; loop in sample frames, `end`
 *   being the loop's last frame, included
 */
export function readWav(bytes) {
  const view = new DataView(bytes);
  if (view.byteLength < 12 || view.getUint32(0, false) !== 0x52494646) return null; // "RIFF"
  let format = null;
  let data = null;
  let loop = null;
  for (let at = 12; at + 8 <= view.byteLength;) {
    const id = view.getUint32(at, false);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 0x666d7420) { // "fmt "
      format = {
        code: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
      // WAVE_FORMAT_EXTENSIBLE keeps the real code in its sub-format.
      if (format.code === 0xfffe && size >= 26) format.code = view.getUint16(body + 24, true);
    }
    if (id === 0x64617461) data = { at: body, size: Math.min(size, view.byteLength - body) }; // "data"
    if (id === 0x736d706c && size >= 36 && view.getUint32(body + 28, true) > 0 && body + 60 <= view.byteLength) { // "smpl"
      loop = { start: view.getUint32(body + 44, true), end: view.getUint32(body + 48, true) };
    }
    at = body + size + (size & 1);
  }
  if (!format || !data) return null;
  const { code, channels: count, sampleRate, bits } = format;
  const read = {
    "1:8": (o) => (view.getUint8(o) - 128) / 128,
    "1:16": (o) => view.getInt16(o, true) / 32768,
    "1:24": (o) => ((view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getInt8(o + 2) << 16))) / 8388608,
    "1:32": (o) => view.getInt32(o, true) / 2147483648,
    "3:32": (o) => view.getFloat32(o, true),
  }[`${code}:${bits}`];
  if (!read) return null;
  const width = bits / 8;
  const frames = Math.floor(data.size / (width * count));
  const channels = Array.from({ length: count }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) channels[c][i] = read(data.at + (i * count + c) * width);
  }
  if (loop && loop.end >= frames) loop.end = frames - 1;
  if (loop && loop.end <= loop.start) loop = null;
  return { sampleRate, channels, loop };
}

/**
 * An AIFF (or uncompressed AIFF-C) file's audio and the sustain loop its
 * `INST` and `MARK` chunks carry, in the shape readWav gives. Browsers do not
 * decode AIFF at all: some libraries record in it (Antz, at 24 bits).
 *
 * @param {ArrayBuffer} bytes - the whole file
 * @returns {{sampleRate: number, channels: Float32Array[], loop: {start: number, end: number}|null}|null}
 */
export function readAiff(bytes) {
  const view = new DataView(bytes);
  if (view.byteLength < 12 || view.getUint32(0, false) !== 0x464f524d) return null; // "FORM"
  const kind = view.getUint32(8, false);
  if (kind !== 0x41494646 && kind !== 0x41494643) return null; // "AIFF", "AIFC"
  let format = null, data = null, inst = null;
  const markers = new Map();
  for (let at = 12; at + 8 <= view.byteLength;) {
    const id = view.getUint32(at, false);
    const size = view.getUint32(at + 4, false);
    const body = at + 8;
    if (id === 0x434f4d4d) { // "COMM"
      // the rate is an 80-bit extended float: sign and exponent, then a 64-bit mantissa
      const exponent = (view.getUint16(body + 8, false) & 0x7fff) - 16383;
      const mantissa = view.getUint32(body + 10, false) * 2 ** 32 + view.getUint32(body + 14, false);
      format = {
        channels: view.getInt16(body, false),
        frames: view.getUint32(body + 2, false),
        bits: view.getInt16(body + 6, false),
        sampleRate: Math.round(mantissa * 2 ** (exponent - 63)),
        compression: kind === 0x41494643 && size >= 22 ? view.getUint32(body + 18, false) : 0x4e4f4e45, // "NONE"
      };
    }
    if (id === 0x53534e44) data = body + 8 + view.getUint32(body, false); // "SSND": offset, block size, then the frames
    if (id === 0x4d41524b) { // "MARK"
      let m = body + 2;
      for (let k = 0; k < view.getUint16(body, false) && m + 7 <= body + size; k++) {
        markers.set(view.getUint16(m, false), view.getUint32(m + 2, false));
        const length = view.getUint8(m + 6);
        m += 6 + 1 + length + ((length + 1) & 1);
      }
    }
    if (id === 0x494e5354 && size >= 20) inst = { mode: view.getInt16(body + 8, false), begin: view.getUint16(body + 10, false), end: view.getUint16(body + 12, false) }; // "INST": its sustain loop
    at = body + size + (size & 1);
  }
  if (!format || data === null) return null;
  const { channels: count, frames: declared, bits, sampleRate, compression } = format;
  const little = compression === 0x736f7774; // "sowt"
  if (compression !== 0x4e4f4e45 && !little && compression !== 0x666c3332) return null; // "NONE", "sowt", "fl32"
  const read = compression === 0x666c3332 ? (o) => view.getFloat32(o, false) : {
    8: (o) => view.getInt8(o) / 128,
    16: (o) => view.getInt16(o, little) / 32768,
    24: little
      ? (o) => (view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getInt8(o + 2) << 16)) / 8388608
      : (o) => ((view.getInt8(o) << 16) | (view.getUint8(o + 1) << 8) | view.getUint8(o + 2)) / 8388608,
    32: (o) => view.getInt32(o, little) / 2147483648,
  }[bits];
  if (!read) return null;
  const width = Math.ceil(bits / 8);
  const frames = Math.min(declared, Math.floor((view.byteLength - data) / (width * count)));
  const channels = Array.from({ length: count }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) channels[c][i] = read(data + (i * count + c) * width);
  }
  let loop = null;
  if (inst && inst.mode !== 0 && markers.has(inst.begin) && markers.has(inst.end)) {
    loop = { start: markers.get(inst.begin), end: Math.min(frames - 1, markers.get(inst.end) - 1) };
    if (loop.end <= loop.start) loop = null;
  }
  return { sampleRate, channels, loop };
}
