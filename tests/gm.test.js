/**
 * Tests for the General MIDI loading path: how many samples a strategy asks
 * for, which CDN they come from, and that every program is mapped.
 *
 * node:test + assert, no network — the CDN probe takes an injected fetch.
 * Run with: node --test tests/soundfonts.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  CDN_SOURCES,
  generateSamplerUrls,
  getSoundfontBase,
  setSoundfontBase,
  resolveSoundfontBase,
} from "../src/gm.js";

/**
 * Restore the module-level base after a test that moves it. Async, and it
 * awaits: a synchronous `finally` would reset the base while the test was
 * still using it.
 */
async function withBase(fn) {
  try {
    return await fn();
  } finally {
    setSoundfontBase(null);
  }
}

/* --- sampling strategies -------------------------------------------------- */

test("the default strategy is balanced, not one file per semitone", async () => {
  // `complete` is 88 requests per instrument; a four-instrument piece fetched
  // 352 files before its first note. Sampler resamples to fill the gaps,
  // which is what a soundfont engine does anyway.
  const count = Object.keys(generateSamplerUrls(40)).length;

  assert.ok(count > 8 && count < 40, `${count} samples is not a balanced default`);
  assert.equal(
    Object.keys(generateSamplerUrls(40, undefined, [21, 108], "complete")).length, 88,
    "complete is still reachable, and still complete",
  );
});

test("the strategies are ordered by density", async () => {
  const size = (strategy) =>
    Object.keys(generateSamplerUrls(40, undefined, [21, 108], strategy)).length;

  const [minimal, balanced, quality, complete] =
    ["minimal", "balanced", "quality", "complete"].map(size);

  assert.ok(minimal < balanced, `minimal ${minimal} !< balanced ${balanced}`);
  assert.ok(balanced < quality, `balanced ${balanced} !< quality ${quality}`);
  assert.ok(quality < complete, `quality ${quality} !< complete ${complete}`);
});

test("an unknown strategy falls back to balanced rather than throwing", async () => {
  assert.deepEqual(
    Object.keys(generateSamplerUrls(40, undefined, [21, 108], "lavish")),
    Object.keys(generateSamplerUrls(40, undefined, [21, 108], "balanced")),
  );
});

test("an unknown program falls back to the piano, keeping the strategy", async () => {
  // The fallback used to drop the strategy argument, so an unknown program
  // silently became 88 requests whatever you asked for.
  const urls = generateSamplerUrls(999, undefined, [21, 108], "minimal");
  const expected = generateSamplerUrls(0, undefined, [21, 108], "minimal");

  assert.deepEqual(Object.keys(urls), Object.keys(expected));
  assert.ok(Object.values(urls)[0].includes("acoustic_grand_piano"));
});

test("sample urls name the instrument's folder and the note", async () => {
  const urls = generateSamplerUrls(40, undefined, [60, 72], "minimal");

  assert.ok(urls.C4, `expected a C4, got ${Object.keys(urls).join(", ")}`);
  assert.match(urls.C4, /\/violin-mp3\/C4\.mp3$/);
});

/* --- CDN fallback --------------------------------------------------------- */

test("the primary CDN is used when it answers", async () => {
  await withBase(async () => {
    const asked = [];
    const fetchImpl = async (url) => { asked.push(url); return { ok: true }; };

    const base = await resolveSoundfontBase({ fetchImpl });

    assert.equal(base, CDN_SOURCES[0]);
    assert.equal(asked.length, 1, "one probe decides for the session");
  });
});

test("a dead primary falls through to the next source", async () => {
  // CDN_SOURCES listed a fallback that nothing used: the URL builder always
  // returned the primary, with a comment saying the mechanism was left for
  // later. This is that mechanism.
  await withBase(async () => {
    const fetchImpl = async (url) =>
      url.startsWith(CDN_SOURCES[0]) ? { ok: false, status: 404 } : { ok: true };

    assert.equal(await resolveSoundfontBase({ fetchImpl }), CDN_SOURCES[1]);
  });
});

test("a primary that throws is treated as down, not fatal", async () => {
  await withBase(async () => {
    const fetchImpl = async (url) => {
      if (url.startsWith(CDN_SOURCES[0])) throw new TypeError("network error");
      return { ok: true };
    };

    assert.equal(await resolveSoundfontBase({ fetchImpl }), CDN_SOURCES[1]);
  });
});

test("with every source down the primary is kept", async () => {
  // Failing to load samples beats failing to build the player.
  await withBase(async () => {
    const fetchImpl = async () => { throw new Error("offline"); };

    assert.equal(await resolveSoundfontBase({ fetchImpl }), CDN_SOURCES[0]);
  });
});

test("the resolved source is what later urls are built from", async () => {
  await withBase(async () => {
    const fetchImpl = async (url) =>
      url.startsWith(CDN_SOURCES[0]) ? { ok: false } : { ok: true };
    await resolveSoundfontBase({ fetchImpl });

    assert.equal(getSoundfontBase(), CDN_SOURCES[1]);
    assert.ok(
      Object.values(generateSamplerUrls(40))[0].startsWith(CDN_SOURCES[1]),
      "urls should follow the probe, or the fallback is decorative again",
    );
  });
});

test("the probe runs once, not once per track", async () => {
  await withBase(async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return { ok: true }; };

    await resolveSoundfontBase({ fetchImpl });
    await resolveSoundfontBase({ fetchImpl });
    await resolveSoundfontBase({ fetchImpl });

    assert.equal(calls, 1);
  });
});

test("setSoundfontBase points at your own mirror and stops probing", async () => {
  await withBase(async () => {
    let called = false;
    setSoundfontBase("https://example.test/samples");

    assert.equal(getSoundfontBase(), "https://example.test/samples");
    assert.ok(Object.values(generateSamplerUrls(40))[0].startsWith("https://example.test/samples"));

    await resolveSoundfontBase({ fetchImpl: async () => { called = true; return { ok: true }; } });
    assert.equal(called, false, "an explicit base should not be second-guessed");
  });
});

test("without a fetch available the primary is kept", async () => {
  // Node without a global fetch, or a locked-down page.
  await withBase(async () => {
    assert.equal(await resolveSoundfontBase({ fetchImpl: undefined }), CDN_SOURCES[0]);
  });
});

/* --- the GM table --------------------------------------------------------- */

test("all 128 GM programs are mapped", async () => {
  const { GM_INSTRUMENTS } = await import("../src/gm.js");

  // Half the table was missing: 50-55, 59-63, and everything from 75 up —
  // every synth lead and pad, the ethnic and percussive banks, the sound
  // effects. Asking for one fell through to the piano without saying so.
  for (let program = 0; program < 128; program++) {
    const entry = GM_INSTRUMENTS[program];
    assert.ok(entry, `GM program ${program} is unmapped`);
    assert.ok(entry.name, `GM program ${program} has no name`);
    assert.match(entry.folder, /-mp3$/, `GM program ${program} has an odd folder`);
  }
});

test("a pad and a sound effect are not silently pianos", async () => {
  const choir = generateSamplerUrls(91, undefined, [60, 72], "minimal");
  const applause = generateSamplerUrls(126, undefined, [60, 72], "minimal");

  assert.match(Object.values(choir)[0], /\/pad_4_choir-mp3\//);
  assert.match(Object.values(applause)[0], /\/applause-mp3\//);
});

test("the folders that break the naming pattern are kept as data", async () => {
  const { GM_INSTRUMENTS } = await import("../src/gm.js");

  // Derived from the name these would be honky_tonk_piano, lead_8_bass_lead
  // and fx_8_sci_fi — all three 404. The table is checked against the CDN,
  // not generated from a rule.
  assert.equal(GM_INSTRUMENTS[3].folder, "honkytonk_piano-mp3");
  assert.equal(GM_INSTRUMENTS[87].folder, "lead_8_bass__lead-mp3");
  assert.equal(GM_INSTRUMENTS[103].folder, "fx_8_scifi-mp3");
});

/* --- the sustain ceiling -------------------------------------------------- */

test("gmMaxBeats converts the sample length into quarter notes", async () => {
  const { GM_SAMPLE_SECONDS, gmMaxBeats } = await import("../src/gm.js");

  // Every FluidR3 file is the same fixed-length render — 122 MPEG frames at
  // 44.1 kHz. A soundfont engine loops the sustain region and holds forever;
  // these just stop.
  assert.ok(GM_SAMPLE_SECONDS > 3 && GM_SAMPLE_SECONDS < 3.3);

  assert.equal(gmMaxBeats(60), GM_SAMPLE_SECONDS, "at 60 BPM a beat is a second");
  assert.equal(gmMaxBeats(120), GM_SAMPLE_SECONDS * 2);
  assert.equal(gmMaxBeats(), gmMaxBeats(120), "120 is the default tempo");
  assert.equal(gmMaxBeats(0), gmMaxBeats(120), "a nonsense tempo falls back");
});

/* --- sample banks --------------------------------------------------------- */

test("three banks, laid out identically", async () => {
  const { BANKS, CDN_ROOTS } = await import("../src/gm.js");

  // Same folder names, same 128 programs, same fixed sample length — they
  // differ only in the recordings, which is what makes the switch cheap.
  assert.deepEqual(BANKS, ["FluidR3_GM", "MusyngKite", "FatBoy"]);
  assert.ok(CDN_ROOTS.length >= 2, "and each is served from more than one place");
});

test("switching bank changes where samples come from", async () => {
  const { setSoundfontBank, getSoundfontBank } = await import("../src/gm.js");
  try {
    assert.equal(getSoundfontBank(), "FluidR3_GM", "the default is the most even set");

    setSoundfontBank("MusyngKite");
    assert.equal(getSoundfontBank(), "MusyngKite");
    assert.match(Object.values(generateSamplerUrls(40))[0], /\/MusyngKite\/violin-mp3\//);
  } finally {
    setSoundfontBank("FluidR3_GM");
    setSoundfontBase(null);
  }
});

test("an unknown bank is refused rather than 404ing later", async () => {
  const { setSoundfontBank } = await import("../src/gm.js");
  assert.throws(() => setSoundfontBank("Symphony"), /Unknown sample bank/);
});

test("switching bank re-arms the CDN probe", async () => {
  // A source that answered for one bank says nothing about another, so the
  // memoised result has to be dropped.
  const { setSoundfontBank } = await import("../src/gm.js");
  await withBase(async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return { ok: true }; };

    await resolveSoundfontBase({ fetchImpl });
    assert.equal(calls, 1);

    setSoundfontBank("FatBoy");
    await resolveSoundfontBase({ fetchImpl });
    assert.equal(calls, 2, "the new bank is probed on its own");

    setSoundfontBank("FluidR3_GM");
  });
});

test("a track can name its own bank", async () => {
  const { readSpec } = await import("../src/index.js");

  assert.match(readSpec({ gm: 40, bank: "MusyngKite" }).baseUrl, /\/MusyngKite$/);
  assert.equal(readSpec({ gm: 40 }).baseUrl, undefined, "and none means the active one");
  assert.equal(
    readSpec({ gm: 40, bank: "FatBoy", baseUrl: "https://mine/x" }).baseUrl,
    "https://mine/x",
    "an explicit baseUrl still wins",
  );
});

/* --- pointing somewhere else ---------------------------------------------- */

test("setSoundfontSources changes the hosts, keeping the bank layout", async () => {
  const { setSoundfontSources, getSoundfontSources } = await import("../src/gm.js");
  try {
    setSoundfontSources("https://mirror.test/sf");

    assert.deepEqual(getSoundfontSources(), ["https://mirror.test/sf"]);
    assert.match(
      Object.values(generateSamplerUrls(40))[0],
      /^https:\/\/mirror\.test\/sf\/FluidR3_GM\/violin-mp3\//,
      "the bank name is still appended",
    );
  } finally {
    setSoundfontSources(null);
  }
});

test("setSoundfontSources(null) restores the defaults", async () => {
  const { setSoundfontSources, getSoundfontSources, CDN_ROOTS } = await import("../src/gm.js");
  setSoundfontSources(["https://a.test", "https://b.test"]);
  assert.equal(getSoundfontSources().length, 2);

  setSoundfontSources(null);
  assert.deepEqual(getSoundfontSources(), CDN_ROOTS);
});

test("setSoundfontFormat respells both the folder and the extension", async () => {
  const { setSoundfontFormat } = await import("../src/gm.js");
  try {
    // midi-js puts the format in both: violin-mp3/C4.mp3
    setSoundfontFormat("ogg");
    assert.match(Object.values(generateSamplerUrls(40))[0], /\/violin-ogg\/[A-G][#b]?\d\.ogg$/);
  } finally {
    setSoundfontFormat(null);
  }
});

test("a flat layout is expressible, for samples that are not midi-js", async () => {
  const { setSoundfontFormat } = await import("../src/gm.js");
  try {
    setSoundfontFormat({ folderSuffix: "", extension: "wav" });
    assert.match(Object.values(generateSamplerUrls(40))[0], /\/violin\/[A-G][#b]?\d\.wav$/);

    setSoundfontFormat({ extension: ".flac" });
    assert.match(
      Object.values(generateSamplerUrls(40))[0], /\/violin\/[A-G][#b]?\d\.flac$/,
      "a leading dot on the extension is tolerated, and folderSuffix is kept",
    );
  } finally {
    setSoundfontFormat(null);
    assert.match(Object.values(generateSamplerUrls(40))[0], /\/violin-mp3\/[A-G][#b]?\d\.mp3$/);
  }
});

test("the probe asks for a file in the configured spelling", async () => {
  // Probing for an .mp3 on a host that only serves .ogg would reject a source
  // that actually works.
  const { setSoundfontFormat } = await import("../src/gm.js");
  await withBase(async () => {
    const asked = [];
    setSoundfontFormat("ogg");
    try {
      await resolveSoundfontBase({ fetchImpl: async (url) => { asked.push(url); return { ok: true }; } });
      assert.match(asked[0], /\.ogg$/, `probed ${asked[0]}`);
    } finally {
      setSoundfontFormat(null);
    }
  });
});
