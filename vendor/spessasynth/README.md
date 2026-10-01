# spessasynth

Un lecteur de soundfonts (SF2, SF3, DLS) pour le navigateur : https://github.com/spessasus/spessasynth_lib, licence Apache-2.0 (voir LICENSE).

- `spessasynth_lib.js` : spessasynth_lib 4.3.14 et spessasynth_core 4.3.22, regroupés en un seul module ES par esbuild :
  `esbuild node_modules/spessasynth_lib/dist/index.js --bundle --format=esm --platform=browser`
- `spessasynth_processor.min.js` : le processeur audio (AudioWorklet), tel que publié dans spessasynth_lib 4.3.14.
