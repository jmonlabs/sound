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
jm.play(piece, { Tone, sound });
```

```js
{ label: "Violin", synth: 40, notes }                        // GM program 0-127
{ label: "Violin", synth: { gm: 40, strategy: "complete" } } // sampling density
{ label: "Drums",  synth: "drums", notes }                   // the General MIDI drums
```

Or through [`jmon/studio`](https://github.com/jmonlabs/studio), which
assembles all four packages and passes this one along on every call.

Standalone, with no JMON involved:

```js
const { node } = sound.create(40, Tone);   // a Tone.Sampler, loaded from CDN
node.toDestination();
await Tone.loaded();
node.triggerAttackRelease("C4", 2);
```

## Drums

`synth: "drums"` is the General MIDI drum kit: every drum sound from 35 to 81 (kick, snares, claps, hi-hats, toms, cymbals, cowbell, congas…), one recording each, played by a Tone.Sampler like the melodic instruments. `synth: { drums: n }` picks another kit by its General MIDI number: 0 standard, 8 room, 16 power, 24 electronic, 25 808, 32 jazz, 40 brush, 48 orchestra. The recordings are the kits of the MuseScore General bank (licence MIT), rendered note by note at [jmonlabs/sf](https://github.com/jmonlabs/sf) (`musescore/drums/`). A drum rings out past its written note (`release: 4`), as on General MIDI's drum channel.

```js
{ label: "Drums", synth: "drums", notes: jm.rhythm.kit({ kick: "x...", clap: "..x." }) }
{ label: "Brushes", synth: { drums: 40 }, notes }
sound.setDrumSamples("/__files/samples/sf/musescore/drums"); // a local copy
```

The old names still play, and say once what to write instead: `"drumkit"` and `"drumkit:<name>"` (the same kits, played by the SoundFont engine), and `"drumkit:acoustic"` and `"drumkit:r8"`, the small Tone.js kits (kick, snare, hi-hat and three toms only: a sound they lack is played by the nearest one, repitched).

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

{ label: "Voice", synth: { kit: "poem" }, notes: [
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

Every GM program starts and stops the way its family does unless its spec
says otherwise: bowed strings enter over 0.06 s and fade over 0.4 s, a piano
starts at once and rings for 1 s, a pad takes 0.3 s and fades over 2 s. The
values are in `defaultEnvelope(program)`. Drum kits keep Tone's own short
release. Override either on the track:

```js
{ gm: 48, options: { release: 0.6 } }   // longer tail
{ gm: 48, loopSustain: false }          // don't loop
```

Both reach into `Tone.Sampler._activeSources`, which is internal, so both are
feature-detected and return `false` if a future version moves it.

## SoundFont banks

`.sf2`, `.sf3` and `.dls` banks are played by
[spessasynth](https://github.com/spessasus/spessasynth_lib) (Apache-2.0), an
AudioWorklet in Tone's own context. Say once where it is, and optionally which
bank plays General MIDI programs:

```js
sound.useSoundfont({
  library: "/vendor/spessasynth/spessasynth_lib.js",
  processor: "/vendor/spessasynth/spessasynth_processor.min.js",
  bank: "/samples/sf/musescore/MuseScore_General.sf3", // optional: { gm } tracks
});

{ gm: 40 }                                        // violin, from the bank above
{ sf2: "/samples/soundfonts/GeneralUser-GS.sf2", program: 0 }  // any bank, per track
{ sf2: "/samples/sf/musescore/MuseScore_General.sf3", program: 40, bankSelect: 8 } // a variation
```

Each bank file gets a synthesizer of its own, with its own bank numbers and 15
channels (channel 9, General MIDI's drums, is left out). A track is one channel:
its loudness curve is the channel's expression (CC 11), and its pitch curve the
channel's pitch wheel, so two overlapping notes on one track swell and bend
together. `controllers` sets any controller at the start, e.g. `{ 73: 100 }` for
a softer attack; `{ gm }` tracks of bowed strings get that one by default.

A bank made of one instrument often keeps its ways of playing as separate
presets: non vibrato, vibrato, tremolo, pizzicato. `variants` names the ones a
track wants, and a note chooses with `variant`:

```js
{ sf2: "/samples/soundfonts/Violin_LDK1609.sf2", program: 0, // non vibrato
  variants: { vibrato: 11, tremolo: 4, pizzicato: { program: 15, bankSelect: 0 } } }

{ pitch: 69, duration: 8, time: 0, variant: "vibrato" } // this note, with the recorded vibrato
```

Each variant takes a channel of the bank's synthesizer (so a track with three
variants takes four of the fifteen), and controller moves reach them all. A
note with no variant, or one the track does not have, plays the track's own
program. `variant` is not an articulation: `articulations: ["vibrato"]` asks
the compiler for a synthetic vibrato, which would double a recorded one.

A bank is often far bigger than what a piece needs (a 577 MB orchestra whose
harps are 450 of them), and the browser decodes all of it. `tools/sf2-extract.js`
writes a new `.sf2` with only the presets named, their instruments and their
samples, once each; `tools/sf2-presets.js` lists a bank's presets with what each
weighs. Both run under Deno, read-only on the source:

```sh
deno run --allow-read tools/sf2-presets.js big.sf2
deno run --allow-read --allow-write tools/sf2-extract.js big.sf2 strings.sf2 "Strings" 0:0 0:14 1:4
```

The extract plays sample for sample like the original (checked bit for bit on
rendered notes). Keep the original: the extract is a view of it.

## ison: an instrument said in JSON

An instrument can be a JSON object rather than a bare spec: what sounds it
takes (`sources`: any spec above, several if need be), the ways it is played
(`modes`, one per preset, keyswitch or set of parameters, chosen per note with
`variant`), how it is played (`play`: how long a bow lasts, when the vibrato
comes, the shape of a stroke), its level and its controls by name. The format
and its schema are at [jmonlabs/ison](https://github.com/jmonlabs/ison).

```js
const violin = await (await fetch("/instruments/violon-ldk.ison.json")).json();
{ label: "Violon", synth: violin, notes } // a note of 8 beats is bowed in two strokes, with the recorded vibrato
```

A host plays an ison by calling `sound.performPiece(piece)` before it schedules
(the player and the WAV render do): the `play` rules become strokes, variants
and `dynamics` on the notes, which are then played like any other. `create`
builds the instrument: a SoundFont source plays its modes as the variants of
one instrument, any other source gets a node per mode.

## SFZ instruments

An [SFZ](https://sfzformat.com) instrument is a text file and a folder of
recordings: which recording answers which key and velocity, how it is tuned,
how loud it is, how it starts and ends. The free orchestral libraries worth
hearing are in this format, for instance
[Virtual Playing Orchestra](https://virtualplaying.com/virtual-playing-orchestra/)
and [VCSL](https://github.com/sgossner/VCSL).

```js
const strings = "/samples/sfz/virtual-playing-orchestra-3/Strings";
{ label: "Cello", synth: {
  sfz: `${strings}/cello-SOLO-sustain.sfz`,       // every note
  staccato: `${strings}/cello-SOLO-staccato.sfz`, // notes shorter than staccatoUnder
  staccatoUnder: 0.3,                             // seconds, the default
  envelope: { attack: 0.2, release: 1 },          // over the file's own, optional
  volume: -15,                                    // dB
} }
```

Every note is a voice of its own, so a loudness curve (`shapeVoices`) or a
bend (`bendVoices`) moves that note only, not the whole track. The file's
velocity layers and crossfades, round robins, key switches, release triggers
(the bow leaving the string), choke groups, envelope, pitch LFO, filter and EQ
are played; `sfz.js` lists the opcodes read.

Only the recordings a track can play are loaded. The player hands the track's
notes to `create`, and `regionsForNotes` keeps the regions whose keys they
fall on and whose velocity layers they reach (give or take 2 steps). A piano
line in the treble loads 78 of the Salamander Grand Piano's 641 recordings,
not all 1.8 GB. Called without notes, `create` loads the whole file.

Controllers move sounding notes too. A piece's controller moves (`track.cc`,
`note.modulations`, `midi.ccN` automation lanes, gathered by io's
`controllerEvents`) reach the instrument as `controllerChange`, and each voice
follows the controllers its regions name: gain (`gain_ccN`, `volume_ccN`), its
share of a crossfade between layers (`xfin_loccN`…), and brightness
(`cutoff_ccN`). That is how the "performance" instruments of Sonatina or
Virtual Playing Orchestra swell on a held note under the mod wheel:

```js
automation: [{ target: "midi.cc1", anchorPoints: [
  { time: 0, value: 0.1 }, { time: 4, value: 1 }, { time: 8, value: 0.1 },
] }]
```

A SoundFont instrument passes the same moves to its channel, plus pitch bend
(±2 semitones) and channel pressure. An ison names its controls, and a lane
may target one by name (`target: "whistle"`): io resolves it to the control's
controller number, so the same lane is the same move live, rendered, and in a
MIDI file.

WAV files are read by the package, not decoded by the browser, so they keep
their own sample rate and the loop in their `smpl` chunk: Firefox's resampling
at decode smears a file's last frames, and a loop ending there clicks each
time round. Each loop's end is also crossfaded over 20 ms into what precedes
its start. Other formats (FLAC, Ogg) go to `decodeAudioData`.

## Faust instruments

An instrument written in [Faust](https://faust.grame.fr) is a `.dsp` file: a
text describing a sound, with controls. A track plays it:

```js
{ label: "Voice", synth: {
  faust: "/instruments/voice.dsp",
  params: { bright: 0.7 },  // the DSP's controls, at the start, optional
  volume: -6,               // dB, optional
} }
```

The `.dsp` is compiled in the browser the first time a track asks for it, and
once per page however many tracks play it. Edit it, reload the page, and the
new version plays. The compiler is
[faustwasm](https://github.com/grame-cncm/faustwasm) (LGPL-3.0), shipped in
`vendor/faustwasm`; it and its 6 MB are only fetched when a piece has a Faust
track. `useFaust({ library, compiler })` points elsewhere.

The DSP's `freq`, `gain` and `gate` controls play the notes, as in Faust's own
MIDI support. A control marked `[midi:ctrl 74]` follows the piece's controller
74 (`track.cc`, as for SFZ), one marked `[midi:pitchwheel]` its pitch bend.

```faust
import("stdfaust.lib");
freq = hslider("freq", 220, 20, 4000, 0.01);
gain = hslider("gain", 0.5, 0, 1, 0.01);
gate = button("gate");
bright = hslider("bright[midi:ctrl 74]", 0.5, 0, 1, 0.01) : si.smoo;
process = os.sawtooth(freq) : fi.lowpass(2, 300 + 5000 * bright)
        : *(en.adsr(0.02, 0.2, 0.7, 0.4, gate) * gain);
```

Each voice is one instance of the DSP, and each of its controls an
AudioParam, scheduled sample by sample. A note sets its voice's `freq` to its
exact pitch, quarter tones included; its bend (`bendVoices`) glides `freq`,
its loudness curve (`shapeVoices`) moves `gain`. Each note's own, not the
whole track's.

- Monophonic, the default: one voice. Two notes that overlap are tied: the
  pitch moves and `gate` stays up. Two notes that only touch start again: the
  gate dips for 3 ms.
- Polyphonic, with `declare options "[nvoices:8]";` (or `voices: 8` in the
  spec, which also turns a monophonic DSP polyphonic: `voices: 2` for double
  stops): eight voices. A note takes the voice free the longest; with none
  free, the one that has sounded the longest, which starts again. Voices are
  allocated here rather than by faustwasm, whose voices only take whole
  semitones and cannot be bent one by one. If the DSP defines `effect`, as
  Faust allows, the effect is one instance more, after the voices are mixed:

```faust
declare options "[nvoices:8]";
process = …;                                     // one voice
effect = re.mono_freeverb(0.7, 0.5, 0.5, 0);     // once, on the mix
```

Every voice runs all the time, sounding or not: eight voices of a heavy
physical model cost eight times one.

Compiling a DSP with a mistake prints "Aborted(... exception catching is not
enabled ...)" in the console. It is the compiler's own noise and stops
nothing; the mistake itself is the error the track's `loaded` rejects with.

Faust's nodes and Tone's are not the same kind of node: Tone builds its graph
with standardized-audio-context. faustwasm's nodes extend the
`AudioWorkletNode` on `globalThis` when it loads, so it is loaded with Tone's
in place, and its nodes join Tone's graph like any other.

## API

The four methods a host calls. All optional; a host degrades on each
independently.

```js
create(spec, Tone)  -> { node, isLoadable } | null   // null = not mine
prepare(specs)      -> Promise                       // settle the CDN
bendVoices(node, midi, startTime, anchors, baseCents) -> boolean
holdVoices(node, midi, startTime, seconds)            -> boolean
shapeVoices(node, midi, startTime, anchors, options)  -> boolean
```

`anchors` are `{ time, value }` in seconds from the note start. For
`bendVoices` the value is cents from the written pitch; for `shapeVoices` it is
a multiple of the note's velocity, and `options` is
`{ seconds, velocity, attack, release }`. `shapeVoices` replaces the note's
whole gain path and lets the note go at its end, so a host calls it after
`triggerAttack` and `holdVoices`, and skips `triggerRelease` when it returns
true. Both need the voice still listed as sounding: `triggerAttackRelease`
empties that list at once.

Also exported: `GM_INSTRUMENTS`, `generateSamplerUrls`, `findGMProgramByName`,
`getPopularInstruments`, `BANKS`, `getSoundfontBank`, `setSoundfontBank`,
`getSoundfontBase`, `setSoundfontBase`, `resolveSoundfontBase`,
`getSoundfontSources`, `setSoundfontSources`, `getSoundfontFormat`,
`setSoundfontFormat`, `getSamplingStrategy`, `setSamplingStrategy`,
`GM_SAMPLE_SECONDS`, `gmMaxBeats`, `drumKits`, `registerDrumKit`, `setDrumKitSource`,
`getDrumKit`, `analyseSustain`, `prepareLoopRegion`, `canResample`.

## Not included

`.sf2` parsing and reverb. SoundFont banks are played by
[spessasynth_lib](https://www.npmjs.com/package/spessasynth_lib), on request
(`useSoundfont`). SFZ's modulation matrix (`<curve>`, `<effect>`, most
`*_oncc` targets, filter and pitch envelopes) is not read.

## Tests

```bash
node --test tests/*.test.js
```

95 tests, no dependencies and no network: the CDN probe takes an injected
`fetch`, and spessasynth and faustwasm are replaced by recorders.

## License

GPL-3.0-or-later. Shipped beside it: spessasynth (Apache-2.0) in
`vendor/spessasynth`, faustwasm (LGPL-3.0) in `vendor/faustwasm`.
