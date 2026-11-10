/**
 * A Decent Sampler preset (.dspreset) read as SFZ, in memory: the player then
 * plays it like any SFZ file, with no converted file beside it.
 *
 * A .dspreset is an XML file beside its recordings: groups, samples with their
 * notes, velocities, loops and envelopes, round robins. All of that is said
 * almost word for word in SFZ. What is not, is the preset's interface (knobs,
 * images); instead:
 *
 * - groups the preset fades into one another with a knob (volume tables,
 *   `translationTable`) become a mod-wheel crossfade (CC1, `xfin_locc1` /
 *   `xfout_locc1`);
 * - a group the preset switches on and off (an articulation, a microphone) is
 *   chosen by name with `group`. Without it, the groups on at load play.
 */

/** The attributes of one XML tag, as an object. */
function attributes(tag) {
  const out = {};
  for (const m of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return out;
}

const db = (value) => parseFloat(String(value).replace(/dB$/i, ""));

/** A volume table as an SFZ crossfade on CC1: where it rises from 0, and where it falls back to 0. */
function crossfade(table) {
  const out = [];
  const cc = (x) => Math.round(Math.max(0, Math.min(1, x)) * 127);
  for (let i = 1; i < table.length; i++) {
    const [x0, y0] = table[i - 1], [x1, y1] = table[i];
    if (y0 <= 0.001 && y1 > 0.001) out.push(`xfin_locc1=${cc(x0)} xfin_hicc1=${cc(x1)}`);
    if (y0 > 0.001 && y1 <= 0.001) out.push(`xfout_locc1=${cc(x0)} xfout_hicc1=${cc(x1)}`);
  }
  return out.join(" ");
}

/** The SFZ opcodes for what a group or a sample says. */
function opcodes(a) {
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
}

/**
 * The groups of a preset: their attributes, their samples, and the volume
 * table a control applies to each (by group position), if any.
 *
 * @param {string} xml
 */
export function dspresetGroups(xml) {
  const text = xml.replace(/<!--[\s\S]*?-->/g, "");
  const tables = {};
  for (const m of text.matchAll(/<binding\b[^>]*>/g)) {
    const a = attributes(m[0]);
    if (a.type === "amp" && a.level === "group" && a.parameter === "AMP_VOLUME" && a.translationTable) {
      tables[Number(a.position)] = a.translationTable.split(";").map((pair) => pair.split(",").map(Number));
    }
  }
  const groups = [];
  for (const m of text.matchAll(/<group\b([^>]*)>([\s\S]*?)<\/group>/g)) {
    groups.push({
      position: groups.length,
      attributes: attributes(`<group ${m[1]}>`),
      samples: [...m[2].matchAll(/<sample\b[^>]*\/?>/g)].map((s) => attributes(s[0])),
      table: null,
    });
  }
  for (const group of groups) group.table = tables[group.position] ?? null;
  return groups;
}

/**
 * A .dspreset as the text of an SFZ file, sample paths left relative to the
 * preset, as they are in it.
 *
 * @param {string} xml - the preset
 * @param {{group?: string}} [options] - a group to play by its name; without
 *   it, the groups on at load, crossfaded at the mod wheel if the preset does
 * @returns {string}
 */
export function dspresetToSfz(xml, { group } = {}) {
  const groups = dspresetGroups(xml);
  const chosen = group
    ? groups.filter((g) => g.attributes.name === group)
    : groups.filter((g) => g.attributes.enabled !== "false");
  if (group && chosen.length === 0) throw new Error(`The preset has no group named "${group}" (${groups.map((g) => g.attributes.name).filter(Boolean).join(", ")})`);
  const crossfaded = !group && chosen.some((g) => g.table);
  const lines = [];
  for (const g of chosen) {
    const a = g.attributes;
    const head = opcodes(a);
    if (a.seqMode === "round_robin" && a.seqLength) head.push(`seq_length=${a.seqLength}`);
    if (crossfaded && g.table) head.push(crossfade(g.table));
    lines.push(`<group> ${head.join(" ")}`.trimEnd());
    const seqLength = Number(a.seqLength) || 1;
    for (const s of g.samples) {
      if (!s.path || /silence/i.test(s.path)) continue;
      const r = [`sample=${s.path}`, ...opcodes(s)];
      if (s.start !== undefined && Number(s.start) > 0) r.push(`offset=${s.start}`);
      if (s.end !== undefined) r.push(`end=${s.end}`);
      if (s.loopEnabled === "true" && s.loopStart !== undefined) r.push("loop_mode=loop_continuous", `loop_start=${s.loopStart}`, `loop_end=${s.loopEnd}`);
      if (s.seqPosition !== undefined && seqLength > 1) {
        const k = Number(s.seqPosition);
        if (a.seqMode === "round_robin") r.push(`seq_position=${k}`);
        else r.push(`lorand=${((k - 1) / seqLength).toFixed(4)} hirand=${(k / seqLength).toFixed(4)}`);
      }
      lines.push(`<region> ${r.join(" ")}`);
    }
  }
  return lines.join("\n") + "\n";
}
