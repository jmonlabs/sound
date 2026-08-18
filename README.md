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
{ label: "Drums",  synth: "kit:808", notes }                 // a drum kit
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
`setSoundfontBase(url)` pins your own mirror instead.

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

26 tests, no dependencies and no network: the CDN probe takes an injected
`fetch`.

## License

GPL-3.0-or-later
