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
  "sw_lokey", "sw_hikey", "sw_last", "sw_default", "sw_down", "sw_up",
  "xfin_lokey", "xfin_hikey", "xfout_lokey", "xfout_hikey",
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
  let region = null;
  let current = null;
  const regions = [];

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
        case "group": group = {}; current = group; break;
        case "region": region = { ...global, ...master, ...group }; current = region; break;
        default: current = null; // <curve>, <effect>, <midi>: not read
      }
      continue;
    }
    if (!current) continue;
    current[token.opcode] = readValue(token.opcode, token.value);
  }
  closeRegion();

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
