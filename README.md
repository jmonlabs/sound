# jmon/sound

Sampled instruments for [`jmon/algo`](https://github.com/jmonlabs/algo):
General MIDI, drum kits, and the two things a soundfont engine does with a
sounding note that a plain sample player does not.

## Distribution

ESM-only, served straight from this repo via
[jsDelivr](https://www.jsdelivr.com/). No npm package, no build step, no
`dist/`. It has no dependency of its own — Tone.js is passed in by the caller.

```js
import jm    from "https://cdn.jsdelivr.net/gh/jmonlabs/algo@main/src/index.js";
import sound from "https://cdn.jsdelivr.net/gh/jmonlabs/sound@main/src/index.js";
import * as Tone from "npm:tone";

jm.play(composition, { Tone, sound });
```

That is the whole integration. `sound` is injected the same way `Tone` and
`verovio` are, because it is the same kind of thing: a capability the
composition library uses if you give it one.

## Why it is a separate package

`jmon/algo` composes. It builds scales, processes, walks, rhythms; it
schedules them, routes them through an audio graph, and writes them out as
MIDI or a score. None of that needs to know how an MP3 of a violin is looped.

Keeping the two apart means `jm.play()` stays small and dependency-free, and
this package can grow — velocity layers, other sample sets, an adapter over a
different engine — without any of it landing in the composition library.

Without this package `jm.play()` still works. A track asking for a General
MIDI program falls back to a synth: audible and in time, but not the
instrument that was written.

## Using it

```js
// A General MIDI program, 0-127. All 128 are mapped.
{ label: "Violin", synth: 40, notes }

// With the sampling density spelled out.
{ label: "Violin", synth: { gm: 40, strategy: "complete" }, notes }

// As a named preset, so several tracks can share it.
customPresets: [{ id: "violin", type: 40, strategy: "complete" }]
tracks: [{ label: "Strings", synth: "violin", notes }]

// A drum kit.
{ label: "Drums", synth: "kit:808", notes }
```

### Sampling density

`Sampler` resamples to fill the gaps between samples, which is what a
soundfont engine does anyway, so there is no need for a file per semitone.

| `strategy` | files | when |
|---|---|---|
| `minimal` | 9 | sketching, low bandwidth |
| `balanced` | 25 | **the default** |
| `quality` | 30 | sustained instruments you listen closely to |
| `complete` | 88 | a native sample per semitone |

The default used to be `complete`, which meant a four-instrument piece fetched
352 files before its first note. `balanced` resamples up to ±2 semitones, which
shifts formants — audible on voice, strings and brass, inaudible on percussion.

### Where samples come from

FluidR3, from a CDN chosen once per session by asking each source in order.

```js
sound.setSoundfontBase("https://my-mirror.example/FluidR3_GM");  // pin it
sound.getSoundfontBase();                                        // what is in use
```

## What it does to a sounding note

Two things, both of which need to reach inside a `Tone.Sampler` at the voices
it is currently playing. Both are feature-detected: on a Tone version that
moves its internals, they return `false` and the caller falls back.

**Bend** — a glissando ramps a voice's `playbackRate`, so the instrument is
resampled rather than replaced. A GM violin slides as a violin; without this it
would be handed to a substitute synth for that note. It is the same lever a
soundfont engine pulls to bend a note.

**Hold** — every FluidR3 sample is a fixed 3.19-second render, so a longer note
used to run out of sound: a whole note at 60 BPM ended in silence. The sample's
sustaining region is looped instead, and the note stopped where it actually
ends.

Which samples may loop is measured, not assumed from instrument families —
`analyseSustain` compares a recording's tail level to its peak:

    strings 64%   organ 86%   pad 78%   flute 95%   piano 4%

Above a quarter it sustains; below, it is decaying and looping would be an
audibly stuck note. Because the test reads the buffer, it works for your own
sample sets too.

A raw loop leaves two seams, so `prepareLoopRegion` edits the buffer once: a
gain ramp brings the loop's end up to its start, and an equal-power crossfade
makes the audio arriving at `loopEnd` equal the audio preceding `loopStart`.

    level step   4.15 dB -> 0.30 dB
    waveform     1.6e-2  -> 5e-5

Two things a loop cannot restore. The **attack** is intact — playback starts at
the beginning of the recording and only jumps back on reaching the loop's end.
The **release** is not the sample's own: the end of the recording is never
reached, so a note finishes on Tone's `release` fade, 0.1 s by default, which
is short for a long string note. `{ gm: 48, options: { release: 0.6 } }` is the
knob. Opt out of looping entirely with `{ gm: 48, loopSustain: false }`.

## What this is not

These are per-note sample sets — the *midi-js* layout, one MP3 per pitch — not
`.sf2` files. There is no SoundFont parser here, no velocity layers, and no
built-in reverb. If you want those, the contract below is small enough to write
an adapter over
[spessasynth_lib](https://www.npmjs.com/package/spessasynth_lib) or
[js-synthesizer](https://www.npmjs.com/package/js-synthesizer), which are
FluidSynth-class engines.

Reverb in particular is worth knowing about: fluidsynth applies some by
default, these samples are dry, and dry reads as "flat" before it reads as
"wrong". An `audioGraph` reverb in your composition closes most of that gap,
and that lives in `jmon/algo` where it belongs.

## The contract

Anything with this shape can be passed as `sound`. Every method is optional.

```js
{
  // Build the instrument a spec asks for, or null if it is not yours —
  // the caller then builds it with Tone itself.
  create(spec, Tone) -> { node, isLoadable } | null

  // Settle any remote resources before instruments are built. Called once,
  // with every track's spec, presets already expanded.
  prepare(specs) -> Promise<any>

  // Ramp a sounding note's pitch. `anchors` are { time, value } in seconds
  // from the note start and cents from the written pitch.
  bendVoices(node, midi, startTime, anchors, baseCents) -> boolean

  // Hold a sounding note for `seconds`, past the end of its recording.
  holdVoices(node, midi, startTime, seconds) -> boolean
}
```

`jmon/algo` degrades on each independently: no `create` and General MIDI falls
back to a synth; no `bendVoices` and a glissando moves to a glide voice; no
`holdVoices` and a long note stops when its sample does.

## Tests

```bash
node --test tests/*.test.js
```

21 assertion-backed tests, no dependencies and no network — the CDN probe
takes an injected fetch.

## License

GPL-3.0-or-later

## Links

- [jmon/algo](https://github.com/jmonlabs/algo) — the composition library
- [FluidR3 samples](https://github.com/jmonlabs/midi-js-soundfonts)
