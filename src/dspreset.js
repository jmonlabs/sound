/**
 * A Decent Sampler preset (.dspreset) read as SFZ, in memory: the player then
 * plays it like any SFZ file, with no converted file beside it.
 *
 * A .dspreset is an XML file beside its recordings: groups, samples with their
 * notes, velocities, loops and envelopes, round robins. All of that is said
 * almost word for word in SFZ. What is not, is the preset's interface (knobs,
 * menus, images). From it, what shapes the sound is kept:
 *
 * - a knob a MIDI controller turns (`<midi><cc>`) becomes that controller,
 *   starting where the knob starts (`set_ccN`). What it does is written on the
 *   recordings it touches: a volume table that rises from or falls to silence
 *   becomes a crossfade (`xfin_loccN`…), any other volume a level that follows
 *   the knob on the table's own curve (`amplitude_onccN`, `amplitude_curveccN`), an attack it lengthens or shortens
 *   (`ampeg_attack_onccN`), the gain of a group's peak filter (`eqK_gain_onccN`,
 *   on a curve, since the preset turns it as a plain factor). A knob may act
 *   on a group, or on every recording that carries a tag;
 * - a knob no controller turns is read at its starting value: the envelope it
 *   gives a group or the whole instrument;
 * - a group's own peak filter is a band of EQ;
 * - a loop's crossfade (`loopCrossfade`, in frames) is `loop_crossfade`;
 * - legato: a group that plays only on a phrase's first note or only on a
 *   slurred one (`trigger="first"`, `"legato"`), a transition recorded from
 *   one note (`previousNotes`, SFZ `sw_previous`), and the notes a tag
 *   silences when it sounds (`silencedByTags`, a choke group: `group`,
 *   `off_by`, `off_mode`);
 * - a group the preset switches on and off (an articulation, a microphone) is
 *   chosen by name with `group`. Without it, the groups on at load play; if
 *   none is (a preset whose single articulation a key switches on), all of them.
 *
 * The rest of the interface (reverb, delay, menus of impulse responses) is
 * left to the piece's own effects.
 */

/** The attributes of one XML tag, as an object. */
function attributes(tag) {
  const out = {};
  for (const m of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return out;
}

/** A volume as decibels: "6dB" is in decibels, a bare number is a factor (1 is 0 dB). */
function db(value) {
  const text = String(value).trim();
  if (/db$/i.test(text)) return parseFloat(text);
  const factor = parseFloat(text);
  return factor > 0 ? round(20 * Math.log10(factor)) : -144;
}

const round = (x) => Math.round(x * 1000) / 1000;

/** The SFZ opcodes for what a group or a sample says. */
function opcodes(a) {
  const out = [];
  if (a.volume !== undefined && db(a.volume) !== 0) out.push(`volume=${db(a.volume)}`);
  if (a.tuning !== undefined && parseFloat(a.tuning) !== 0) out.push(`tune=${Math.round(parseFloat(a.tuning) * 100)}`);
  if (a.pan !== undefined && parseFloat(a.pan) !== 0) out.push(`pan=${parseFloat(a.pan)}`);
  if (a.ampVelTrack !== undefined) out.push(`amp_veltrack=${Math.round(parseFloat(a.ampVelTrack) * 100)}`);
  if (a.loNote !== undefined) out.push(`lokey=${a.loNote}`);
  if (a.hiNote !== undefined) out.push(`hikey=${a.hiNote}`);
  if (a.rootNote !== undefined) out.push(`pitch_keycenter=${a.rootNote}`);
  if (a.loVel !== undefined) out.push(`lovel=${a.loVel}`);
  if (a.hiVel !== undefined) out.push(`hivel=${a.hiVel}`);
  if (a.trigger === "release" || a.trigger === "first" || a.trigger === "legato") out.push(`trigger=${a.trigger}`);
  // A recorded transition: the sample plays only after that note.
  if (a.previousNotes !== undefined && /^\d+$/.test(a.previousNotes.trim())) out.push(`sw_previous=${a.previousNotes.trim()}`);
  for (const [name, value] of Object.entries(a)) {
    const range = /^(lo|hi)CC(\d+)$/.exec(name);
    if (range) out.push(`${range[1]}cc${range[2]}=${value}`);
  }
  if (a.ampEnvEnabled !== "false") {
    if (a.attack !== undefined) out.push(`ampeg_attack=${a.attack}`);
    if (a.decay !== undefined) out.push(`ampeg_decay=${a.decay}`);
    if (a.sustain !== undefined) out.push(`ampeg_sustain=${Math.round(parseFloat(a.sustain) * 100)}`);
    if (a.release !== undefined) out.push(`ampeg_release=${a.release}`);
  }
  return out;
}

const ENVELOPE = { ENV_ATTACK: "attack", ENV_DECAY: "decay", ENV_SUSTAIN: "sustain", ENV_RELEASE: "release" };

/** The controls of the interface, in order: a `<midi>` binding names one by its position. */
function controlsOf(text) {
  const ui = text.match(/<ui\b[\s\S]*?<\/ui>/)?.[0] ?? "";
  const out = [];
  for (const m of ui.matchAll(/<(labeled-knob|knob|slider|control|button|menu|xy-pad)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g)) {
    const a = attributes(`<x ${m[2]}>`);
    out.push({
      value: a.value !== undefined ? parseFloat(a.value) : null,
      min: a.minValue !== undefined ? parseFloat(a.minValue) : 0,
      max: a.maxValue !== undefined ? parseFloat(a.maxValue) : 1,
      bindings: m[1] === "menu" ? [] : [...(m[4] ?? "").matchAll(/<binding\b[^>]*>/g)].map((b) => attributes(b[0])),
      cc: null,
    });
  }
  const midi = text.match(/<midi\b[\s\S]*?<\/midi>/)?.[0] ?? "";
  for (const m of midi.matchAll(/<cc\b([^>]*)>([\s\S]*?)<\/cc>/g)) {
    const number = Number(attributes(`<x ${m[1]}>`).number);
    for (const b of m[2].matchAll(/<binding\b[^>]*>/g)) {
      const a = attributes(b[0]);
      if (a.level === "ui" && out[Number(a.position)]) out[Number(a.position)].cc ??= number;
    }
  }
  return out;
}

/** Where a knob sits, 0 to 1, at a value of its own scale. */
const share = (control, value) => (control.max > control.min ? (value - control.min) / (control.max - control.min) : 0);

/** A binding's table, its x on the knob's 0..1, or the straight line a linear binding draws. */
function lineOf(control, binding) {
  if (binding.translationTable && binding.translation !== "linear") {
    return binding.translationTable.split(";").map((pair) => pair.split(",").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite))
      .map(([x, y]) => [share(control, x), y]);
  }
  const low = binding.translationOutputMin !== undefined ? parseFloat(binding.translationOutputMin) : 0;
  const high = binding.translationOutputMax !== undefined ? parseFloat(binding.translationOutputMax) : 1;
  return [[0, low], [1, high]];
}

/**
 * A volume line as SFZ: a crossfade where it reaches silence, otherwise a
 * level that follows the controller (`amplitude_onccN`, scaled by a curve of
 * the line's own values, `addCurve` giving its index).
 */
function volumeOpcodes(line, cc, addCurve) {
  const at = (x) => Math.round(Math.max(0, Math.min(1, x)) * 127);
  if (line.some(([, y]) => y <= 0.001)) {
    const out = [];
    for (let i = 1; i < line.length; i++) {
      const [x0, y0] = line[i - 1], [x1, y1] = line[i];
      if (y0 <= 0.001 && y1 > 0.001) out.push(`xfin_locc${cc}=${at(x0)}`, `xfin_hicc${cc}=${at(x1)}`);
      if (y0 > 0.001 && y1 <= 0.001) out.push(`xfout_locc${cc}=${at(x0)}`, `xfout_hicc${cc}=${at(x1)}`);
    }
    return out.length ? [...out, "xf_cccurve=gain"] : [];
  }
  if (line.length < 2) return [];
  const valueAt = (x) => {
    const k = line.findIndex(([px]) => px >= x);
    if (k === -1) return line[line.length - 1][1];
    if (k === 0) return line[0][1];
    const [x0, y0] = line[k - 1], [x1, y1] = line[k];
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
  };
  const top = Math.max(...line.map(([, y]) => y));
  const index = addCurve(Array.from({ length: 128 }, (_, v) => round(Math.max(0, valueAt(v / 127)) / top)));
  return [`amplitude_oncc${cc}=${round(top * 100)}`, `amplitude_curvecc${cc}=${index}`];
}

/**
 * What the interface does to the sound: per group (by position) and per tag,
 * the opcodes the knobs give; for the whole instrument, an envelope and the
 * controllers' starting values; and the curves those opcodes use.
 */
function interfaceOf(text, groupCount) {
  const controls = controlsOf(text);
  const groups = Array.from({ length: groupCount }, () => ({ static: {}, add: {}, opcodes: [] }));
  const tags = {};
  const instrument = { static: {}, add: {}, opcodes: [] };
  const control = [];
  const curves = [];
  const eqGains = {}; // `${group}:${effect}` → opcodes, once
  const groupTag = /<groups\b[^>]*>/.exec(text);
  const groupsAttributes = groupTag ? attributes(groupTag[0]) : {};
  for (const key of Object.values(ENVELOPE)) if (groupsAttributes[key] !== undefined) instrument.static[key] = groupsAttributes[key];

  for (const knob of controls) {
    if (knob.cc !== null && knob.value !== null) control.push(`set_cc${knob.cc}=${Math.round(Math.max(0, Math.min(1, share(knob, knob.value))) * 127)}`);
    for (const b of knob.bindings) {
      const targets = b.level === "tag"
        ? [(tags[b.identifier] ??= [])]
        : b.level === "group"
          ? [groups[Number(b.groupIndex ?? b.position ?? 0)]?.opcodes].filter(Boolean)
          : b.level === "instrument" ? [instrument.opcodes] : [];
      const key = ENVELOPE[b.parameter];
      if (knob.cc === null) {
        // A knob no controller turns: its starting value, for a volume or an envelope.
        if (b.type === "amp" && b.parameter === "AMP_VOLUME" && knob.value !== null && b.level !== "instrument") {
          const line = lineOf(knob, b), x = share(knob, knob.value);
          const after = line.findIndex(([at]) => at >= x);
          const y = after === -1 ? line[line.length - 1][1] : after === 0 ? line[0][1] : line[after - 1][1] + (line[after][1] - line[after - 1][1]) * (x - line[after - 1][0]) / (line[after][0] - line[after - 1][0] || 1);
          for (const t of targets) t.push(`amplitude=${round(Math.max(0, y) * 100)}`);
          continue;
        }
        if (key && !b.translation && knob.value !== null) {
          if (b.level === "instrument") instrument.static[key] = knob.value;
          else if (b.level === "group") {
            const g = groups[Number(b.groupIndex ?? b.position ?? 0)];
            if (g) g.static[key] = knob.value;
          }
        }
        continue;
      }
      const cc = knob.cc;
      if (b.type === "amp" && b.parameter === "AMP_VOLUME") {
        const addCurve = (points) => {
          const index = 7 + curves.length;
          curves.push(`<curve> curve_index=${index} ${points.map((p, v) => `v${String(v).padStart(3, "0")}=${p}`).join(" ")}`);
          return index;
        };
        for (const t of targets) t.push(...volumeOpcodes(lineOf(knob, b), cc, addCurve));
      } else if (b.type === "amp" && (key === "attack" || key === "release") && b.translation === "linear") {
        const [[, low], [, high]] = lineOf(knob, b);
        // Added to the envelope the group has otherwise ("modBehavior add"):
        // its lowest value joins the group's, the rest follows the controller.
        const owner = b.level === "group" ? groups[Number(b.groupIndex ?? b.position ?? 0)] : b.level === "instrument" ? instrument : null;
        if (owner) owner.add[key] = (owner.add[key] ?? 0) + low;
        for (const t of targets) t.push(`ampeg_${key}_oncc${cc}=${round(high - low)}`);
      } else if (b.type === "effect" && b.level === "group" && /^FX_(FILTER_)?GAIN$/.test(b.parameter)) {
        const id = `${b.groupIndex ?? b.position ?? 0}:${b.effectIndex ?? 0}`;
        if (eqGains[id]) continue;
        const [[, low], [, high]] = lineOf(knob, b);
        // The preset turns the filter's gain as a factor: in decibels, a curve.
        const lowDb = db(Math.max(low, 1e-4)), highDb = db(Math.max(high, 1e-4));
        const index = 7 + curves.length;
        const points = [];
        for (let v = 0; v <= 127; v += 1) points.push((db(Math.max(low + (high - low) * v / 127, 1e-4)) - lowDb) / (highDb - lowDb || 1));
        curves.push(`<curve> curve_index=${index} ${points.map((p, v) => `v${String(v).padStart(3, "0")}=${round(p)}`).join(" ")}`);
        eqGains[id] = { group: Number(b.groupIndex ?? b.position ?? 0), effect: Number(b.effectIndex ?? 0), low: lowDb, range: round(highDb - lowDb), cc, curve: index };
      }
    }
  }
  return { groups, tags, instrument, control, curves, eqGains: Object.values(eqGains), groupsAttributes };
}

/** A group's effects: its peak filters, as EQ bands (frequency, width in octaves, gain in dB). */
function peakBands(body) {
  const effects = [...(body.match(/<effects\b[\s\S]*?<\/effects>/)?.[0] ?? "").matchAll(/<effect\b[^>]*>/g)].map((m) => attributes(m[0]));
  return effects.map((e, index) => ({ index, ...e })).filter((e) => e.type === "peak").map((e) => {
    const q = parseFloat(e.q ?? 0.707);
    return { index: e.index, frequency: parseFloat(e.frequency ?? 1000), octaves: round((2 / Math.LN2) * Math.asinh(1 / (2 * q))), gain: db(e.gain ?? 1) };
  });
}

/**
 * The groups of a preset: their attributes, their samples, their peak filters
 * and their position (what a binding names them by).
 *
 * @param {string} xml
 */
export function dspresetGroups(xml) {
  const text = xml.replace(/<!--[\s\S]*?-->/g, "");
  const groups = [];
  for (const m of text.matchAll(/<group\b([^>]*?)(?:\/>|>([\s\S]*?)<\/group>)/g)) {
    groups.push({
      position: groups.length,
      attributes: attributes(`<group ${m[1]}>`),
      samples: [...(m[2] ?? "").matchAll(/<sample\b[^>]*\/?>/g)].map((s) => attributes(s[0])),
      peaks: peakBands(m[2] ?? ""),
    });
  }
  return groups;
}

/**
 * A .dspreset as the text of an SFZ file, sample paths left relative to the
 * preset, as they are in it.
 *
 * @param {string} xml - the preset
 * @param {{group?: string}} [options] - a group to play by its name; without
 *   it, the groups on at load (all of them if none is)
 * @returns {string}
 */
export function dspresetToSfz(xml, { group } = {}) {
  const text = xml.replace(/<!--[\s\S]*?-->/g, "");
  const groups = dspresetGroups(text);
  const face = interfaceOf(text, groups.length);
  let chosen = group
    ? groups.filter((g) => g.attributes.name === group)
    : groups.filter((g) => g.attributes.enabled !== "false");
  if (group && chosen.length === 0) throw new Error(`The preset has no group named "${group}" (${groups.map((g) => g.attributes.name).filter(Boolean).join(", ")})`);
  if (!group && chosen.length === 0) chosen = groups;
  // A knob that fades groups into one another only means something when they play together.
  const fading = !group;

  // A tag that silences notes (`silencedByTags`): the recordings carrying it
  // form a choke group, and the groups it silences are turned off by it.
  const chokes = {};
  for (const g of groups) for (const tag of (g.attributes.silencedByTags ?? "").split(",").map((t) => t.trim()).filter(Boolean)) chokes[tag] ??= Object.keys(chokes).length + 1;
  const inherited = {};
  for (const key of ["ampVelTrack", "attack", "decay", "sustain", "release", "seqMode", "seqLength"]) if (face.groupsAttributes[key] !== undefined) inherited[key] = face.groupsAttributes[key];
  const lines = [];
  if (face.control.length) lines.push(`<control> ${face.control.join(" ")}`);
  lines.push(...face.curves);
  const instrumentVolume = face.groupsAttributes.volume !== undefined ? db(face.groupsAttributes.volume) : 0;
  lines.push(`<global>${instrumentVolume ? ` volume=${instrumentVolume}` : ""} ${face.instrument.opcodes.join(" ")}`.trimEnd());

  for (const g of chosen) {
    const a = { ...inherited, ...face.instrument.static, ...face.groups[g.position].static, ...g.attributes };
    for (const added of [face.instrument.add, face.groups[g.position].add]) {
      for (const [key, value] of Object.entries(added)) a[key] = round(parseFloat(a[key] ?? 0) + value);
    }
    const head = opcodes(a);
    if (a.seqMode === "round_robin" && a.seqLength) head.push(`seq_length=${a.seqLength}`);
    if (Number(a.start) > 0) head.push(`offset=${a.start}`);
    const silencedBy = (a.silencedByTags ?? "").split(",").map((t) => t.trim()).find((t) => chokes[t]);
    if (silencedBy) head.push(`off_by=${chokes[silencedBy]}`, `off_mode=${a.silencingMode === "normal" ? "normal" : "fast"}`);
    const own = face.groups[g.position].opcodes.filter((o) => fading || !/^xf/.test(o));
    head.push(...own);
    g.peaks.slice(0, 3).forEach((band, k) => {
      const n = k + 1;
      head.push(`eq${n}_freq=${band.frequency}`, `eq${n}_bw=${band.octaves}`);
      const moved = face.eqGains.find((e) => e.group === g.position && e.effect === band.index);
      if (moved) head.push(`eq${n}_gain=${round(moved.low)}`, `eq${n}_gain_oncc${moved.cc}=${moved.range}`, `eq${n}_gain_curvecc${moved.cc}=${moved.curve}`);
      else head.push(`eq${n}_gain=${band.gain}`);
    });
    lines.push(`<group> ${head.join(" ")}`.trimEnd());
    const seqLength = Number(a.seqLength) || 1;
    for (const s of g.samples) {
      if (!s.path || /silence/i.test(s.path)) continue;
      const r = [`sample=${s.path}`, ...opcodes(s)];
      if (s.start !== undefined && Number(s.start) > 0) r.push(`offset=${s.start}`);
      if (s.end !== undefined) r.push(`end=${s.end}`);
      if (s.loopEnabled === "true" && s.loopStart !== undefined) {
        r.push("loop_mode=loop_continuous", `loop_start=${s.loopStart}`, `loop_end=${s.loopEnd}`);
        // In frames in the preset, in seconds in SFZ: the recordings are taken at 44.1 kHz, near enough for a fade.
        if (Number(s.loopCrossfade) > 0) r.push(`loop_crossfade=${round(Number(s.loopCrossfade) / 44100)}`);
      }
      // Takes in turn: the mode from the group or <groups>, the length from the sample (each note may
      // have its own number of takes) or the group.
      const takes = Number(s.seqLength) || seqLength;
      if (s.seqPosition !== undefined && takes > 1) {
        const k = Number(s.seqPosition);
        if (a.seqMode === "round_robin") r.push(`seq_length=${takes}`, `seq_position=${k}`);
        else r.push(`lorand=${((k - 1) / takes).toFixed(4)} hirand=${(k / takes).toFixed(4)}`);
      }
      const tags = (s.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
      const choke = tags.find((t) => chokes[t]);
      if (choke) r.push(`group=${chokes[choke]}`);
      // What the knobs do to the recordings carrying a tag.
      for (const tag of tags) {
        for (const o of face.tags[tag] ?? []) if (!r.some((x) => x.split("=")[0] === o.split("=")[0])) r.push(o);
      }
      lines.push(`<region> ${r.join(" ")}`);
    }
  }
  return lines.join("\n") + "\n";
}
