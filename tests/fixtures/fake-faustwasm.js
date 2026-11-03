/**
 * A stand-in for faustwasm, for tests/faust.test.js: it compiles nothing and
 * records what the instrument asks of its nodes. A `.dsp` whose text contains
 * "nvoices" is polyphonic, one containing "mistake" does not compile.
 */

/** The AudioWorkletNode class on globalThis when this module was loaded. */
export const loadedWith = globalThis.AudioWorkletNode;
/** Every node built, in order. */
export const nodes = [];
/** How many times a `.dsp` was compiled, by name. */
export const compiles = {};

class Param {
  constructor() { this.events = []; }
  setValueAtTime(value, time) { this.events.push(["set", value, time]); }
  linearRampToValueAtTime(value, time) { this.events.push(["linear", value, time]); }
  exponentialRampToValueAtTime(value, time) { this.events.push(["exponential", value, time]); }
  cancelScheduledValues(time) { this.events.push(["cancel", time]); }
}

class Node {
  constructor(name) {
    this.sent = [];
    // An effect has its own controls; a voice has the note controls and one of its own.
    const paths = name.endsWith("_effect") ? ["room"] : ["freq", "gain", "gate", "bright"];
    this.parameters = new Map(paths.map((p) => [`/${name}/${p}`, new Param()]));
    nodes.push(this);
  }
  getParams() { return [...this.parameters.keys()]; }
  setParamValue(path, value, time) { this.sent.push(["param", path, value, time]); }
  ctrlChange(channel, ctrl, value, time) { this.sent.push(["cc", channel, ctrl, value, time]); }
  pitchWheel(channel, wheel, time) { this.sent.push(["wheel", channel, wheel, time]); }
  disconnect() {}
  destroy() { this.destroyed = true; }
}

export class FaustMonoDspGenerator {
  async compile(compiler, name, code) {
    if (code.includes("mistake")) throw new Error(`${name}:1 : ERROR : syntax error`);
    compiles[name] = (compiles[name] ?? 0) + 1;
    this.name = name;
    this.voices = code.includes("nvoices") ? 4 : 0;
    return this;
  }
  getMeta() {
    return { meta: [{ name: this.name }, ...(this.voices ? [{ options: `[midi:on][nvoices:${this.voices}]` }] : [])] };
  }
  async createNode() { return new Node(this.name); }
}

export const instantiateFaustModuleFromFile = async () => ({});
export class LibFaust {}
export class FaustCompiler {}
