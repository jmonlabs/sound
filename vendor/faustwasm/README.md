# faustwasm

Le compilateur Faust et ce qu'il faut pour jouer un `.dsp` dans le navigateur : https://github.com/grame-cncm/faustwasm, licence LGPL-3.0 (voir COPYING.txt).

- `faustwasm.js` : `dist/esm/index.js` de @grame/faustwasm 0.19.0, tel que publié sur npm.
- `libfaust-wasm/` : le compilateur Faust en WebAssembly (`libfaust-wasm.js`, `.data`, `.wasm`), du même paquet. Environ 6 Mo, chargés seulement quand une piste joue un instrument Faust.
