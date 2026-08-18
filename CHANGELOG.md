# Changelog

All notable changes to `jmon/sound`.

Because the library is served straight from this repository via jsDelivr, a
version here is a git tag. Pin `@v1.0.0` for stable work; `@main` moves.

## [1.0.0] — 2026-08-18

Extracted from `jmon/algo`, where this code had grown into something that was
no longer composition: a General MIDI table, sample loading, and the DSP for
bending and looping a sounding voice.

`jmon/algo` composes and schedules. This plays the result with real instrument
samples, and is injected the same way Tone.js and Verovio are. Without it
`jm.play()` still works — a track asking for a General MIDI program falls back
to a synth.

### The contract

`create`, `prepare`, `bendVoices`, `holdVoices`. Each optional, each degrading
independently on the `jmon/algo` side, so a partial implementation — or an
adapter over a different sample engine — is a legitimate substitute.

### What came across

- All 128 General MIDI programs, each folder checked against the CDN rather
  than derived, because three break the naming pattern.
- Four sampling strategies, defaulting to `balanced` (~25 files) rather than
  one file per semitone (88).
- A CDN chosen at runtime by asking each source in order, memoised for the
  session, with `setSoundfontBase` to pin your own mirror.
- Drum kits, with a mutable registry.
- Bending a note by resampling, so a sampled instrument keeps its timbre
  through a glissando.
- Holding a note past the 3.19 seconds a FluidR3 sample lasts, by looping its
  sustaining region — with the loop join levelled and crossfaded so it neither
  clicks nor pulses.

### Three sample banks, not one

`FluidR3_GM` was hardcoded into the CDN path. The midi-js soundfont set
publishes two more — `MusyngKite` and `FatBoy` — rendered by the same process
and laid out identically, so choosing between them is only a change of
recording.

    sound.setSoundfontBank("MusyngKite");                  // for the piece
    { label: "Cello", synth: { gm: 42, bank: "FatBoy" } }  // or per track

Measured, since the difference matters to whether a held note can loop —
tail level as a fraction of each recording's peak:

    strings   FluidR3 103%   Musyng 81%   FatBoy 41%
    violin            93%           98%          43%
    organ             91%           87%          76%
    piano              4%            7%           4%

All three share the same fixed 3.13-second sample length, which places that
ceiling in the midi-js rendering process rather than in FluidR3 — and confirms
that measuring each buffer, rather than keying off instrument families, was
the right call: `analyseSustain` classifies all three correctly with no
per-bank knowledge.

FluidR3_GM stays the default as the most even set. Switching bank re-arms the
CDN probe, since a source that answered for one bank says nothing about
another.

[1.0.0]: https://github.com/jmonlabs/sound/releases/tag/v1.0.0
