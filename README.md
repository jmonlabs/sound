# jmon/sound

General MIDI and drum kit samples for Tone.js, plus the voice handling a
soundfont engine does: bending a note by resampling, and holding one past the
end of its recording.

ESM source served from GitHub via jsDelivr. No build step, no npm package, no
dependencies. Tone.js is passed in by the caller.

## Use

```js
import sound from "https://cdn.jsdelivr.net/gh/jmonlabs/sound@main/src/index.js";
import * as Tone from "npm:tone";
```

With [`jmon/algo`](https://github.com/jmonlabs/algo) or
[`jmon/live`](https://github.com/jmonlabs/live), pass it alongside Tone:

```js
jm.play(composition, { Tone, sound });
```

```js
{ label: "Violin", synth: 40, notes }                        // GM program 0-127
{ label: "Violin", synth: { gm: 40, strategy: "complete" } } // sampling density
{ label: "Drums",  synth: "drumkit:acoustic", notes }         // a drum kit
```

Standalone, with no JMON involved:

```js
const { node } = sound.create(40, Tone);   // a Tone.Sampler, loaded from CDN
node.toDestination();
await Tone.loaded();
node.triggerAttackRelease("C4", 2);
```

## Banks

Three, from the
[midi-js soundfont set](https://github.com/gleitz/midi-js-soundfonts). Same
folder names, same 128 programs, same 3.13-second samples. They differ in the
recordings.

```js
sound.setSoundfontBank("MusyngKite");                   // whole session
{ label: "Cello", synth: { gm: 42, bank: "FatBoy" } }   // one track
```

Tail level as a fraction of each recording's peak, which is what decides
whether a note can be held by looping:

| | FluidR3_GM | MusyngKite | FatBoy |
|---|---|---|---|
| strings | 103% | 81% | 41% |
| violin | 93% | 98% | 43% |
| organ | 91% | 87% | 76% |
| piano | 4% | 7% | 4% |

`FluidR3_GM` is the default. FatBoy's sustained instruments fade inside the
sample, so they loop less well.

The CDN is chosen once per session by trying each source in order.

## Somewhere else

Four levels, from narrowest to widest.

```js
// One track, one folder.
{ label: "Cello", synth: { gm: 42, baseUrl: "https://mine.test/sf/FluidR3_GM" } }

// One flat folder for everything. Skips the bank path and the probe.
sound.setSoundfontBase("https://mine.test/samples");

// Same bank layout, different hosts. Tried in order, bank name appended.
sound.setSoundfontSources(["https://mine.test/sf", "https://backup.test/sf"]);

// A different path spelling, for samples not laid out the midi-js way.
sound.setSoundfontFormat("ogg");                             // violin-ogg/C4.ogg
sound.setSoundfontFormat({ folderSuffix: "", extension: "wav" }); // violin/C4.wav
```

Passing `null` to any of the setters restores the default. The probe follows
the format, so it does not reject a host over a file extension it never
serves.

What is not configurable is the folder *names*: `violin`, `pad_4_choir`, and
the 126 others come from `GM_INSTRUMENTS`, which is exported and can be
edited. For samples that share nothing with this layout, skip the GM path
entirely and hand Tone the URLs yourself:
`synth: { type: "Sampler", options: { baseUrl, urls } }`.

## Your own samples

The kit registry maps a MIDI note to a file. Drums are the obvious use, but
nothing about it is percussive: one file per key is also how you play spoken
phrases, field recordings, or any other one-shot set.

```js
sound.registerDrumKit("poem", {
  baseUrl: "https://example.test/poem/",
  samples: { 60: "line1.mp3", 62: "line2.mp3", 64: "line3.mp3" },
});

{ label: "Voice", synth: "drumkit:poem", notes: [
  { pitch: 60, duration: 4, time: 0 },
  { pitch: 62, duration: 4, time: 4 },
]}

// The object form, when you need options the string form has no room for.
{ label: "Voice", synth: { kit: "poem", loopSustain: false, options: { release: 0 } } }
```

Two things to know before mapping speech onto keys.

`Sampler` **transposes** any note you did not map, to the nearest one you did.
That is what makes a violin playable from 25 files; on a spoken phrase it is a
chipmunk. Play only the pitches you mapped.

A note longer than its file would normally be **held by looping** the sample.
That is right for a string and wrong for a sentence, and the detection is
acoustic rather than semantic, so a phrase ending on an open vowel can be
looped. `loopSustain: false` settles it.

Shipped kits: `acoustic`, `r8`. `drumKits` is the registry, mutable.

## Sampling density

`Sampler` resamples to fill the gaps, so one file per semitone is not needed.

| `strategy` | files | |
|---|---|---|
| `minimal` | 9 | sketching, low bandwidth |
| `balanced` | 25 | default |
| `quality` | 30 | exposed sustained instruments |
| `complete` | 88 | one native sample per semitone |

Resampling shifts formants. Audible on voice, strings and brass; inaudible on
percussion.

## What it does to a sounding note

**Bend.** A pitch curve ramps the voices' `playbackRate`, so a violin
glissando stays a violin instead of moving to a substitute synth.

**Hold.** Samples are a fixed 3.13 seconds, so a longer note runs out. The
sustaining region is looped instead, with the join levelled and crossfaded so
it neither clicks nor pulses. Recordings that decay (piano, guitar, plucked)
are detected and left alone.

Looping does not restore the sample's own release, since the end of the
recording is never reached. The note ends on Tone's `release` fade, 0.1s by
default:

```js
{ gm: 48, options: { release: 0.6 } }   // longer tail
{ gm: 48, loopSustain: false }          // don't loop
```

Both reach into `Tone.Sampler._activeSources`, which is internal, so both are
feature-detected and return `false` if a future version moves it.

## API

The four methods a host calls. All optional; a host degrades on each
independently.

```js
create(spec, Tone)  -> { node, isLoadable } | null   // null = not mine
prepare(specs)      -> Promise                       // settle the CDN
bendVoices(node, midi, startTime, anchors, baseCents) -> boolean
holdVoices(node, midi, startTime, seconds)            -> boolean
```

`anchors` are `{ time, value }`: seconds from the note start, cents from the
written pitch.

Also exported: `GM_INSTRUMENTS`, `generateSamplerUrls`, `findGMProgramByName`,
`getPopularInstruments`, `BANKS`, `getSoundfontBank`, `setSoundfontBank`,
`getSoundfontBase`, `setSoundfontBase`, `resolveSoundfontBase`,
`getSoundfontSources`, `setSoundfontSources`, `getSoundfontFormat`,
`setSoundfontFormat`,
`GM_SAMPLE_SECONDS`, `gmMaxBeats`, `drumKits`, `registerDrumKit`,
`getDrumKit`, `analyseSustain`, `prepareLoopRegion`, `canResample`.

## Not included

`.sf2` parsing, velocity layers, reverb. These are per-note sample sets (the
midi-js layout, one MP3 per pitch). For a real SoundFont engine see
[spessasynth_lib](https://www.npmjs.com/package/spessasynth_lib) or
[js-synthesizer](https://www.npmjs.com/package/js-synthesizer); the API above
is small enough to write an adapter against.

## Tests

```bash
node --test tests/*.test.js
```

31 tests, no dependencies and no network: the CDN probe takes an injected
`fetch`.

## License

GPL-3.0-or-later
