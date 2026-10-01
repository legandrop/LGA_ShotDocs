# Third-party notices

LGA Shot Docs is released under the MIT License (see [LICENSE](LICENSE)). The web app is distributed
together with third-party software and fonts. This file lists the ones whose licenses ask for more than
the usual copyright notice: copyleft licenses and font licenses. Everything else the app ships
(React, Yjs, Mantine, Supabase client, ProseMirror, Tiptap and their dependencies) is under MIT, ISC, BSD,
Apache-2.0, 0BSD or CC0-1.0; their copyright notices and license texts are in each package in
`node_modules/` after `npm install`, and the exact versions are in `package-lock.json`.

Reviewed for version 0.074 (2026-10-01), from the production dependencies in `package.json`.

## libheif-js (libheif and libde265) — LGPL-3.0

Used to convert HEIC/HEIF photos (the iPhone format) to JPEG on the device when they are added to a page.

| | |
|---|---|
| Package | [`libheif-js`](https://www.npmjs.com/package/libheif-js) 1.23.2, an Emscripten (WebAssembly) build of libheif 1.23.2 with the libde265 HEVC decoder |
| License | GNU Lesser General Public License, version 3 (libheif and libde265 are LGPL-3.0-or-later) |
| Copyright | libheif and libde265: Copyright (c) struktur AG, Dirk Farin and contributors. libheif-js packaging: Kiril Vatev |
| Source code | <https://github.com/catdad-experiments/libheif-js> (the build), <https://github.com/strukturag/libheif>, <https://github.com/strukturag/libde265> |
| License text | <https://www.gnu.org/licenses/lgpl-3.0.html> and <https://www.gnu.org/licenses/gpl-3.0.html>; also in `node_modules/libheif-js/LICENSE` and `node_modules/libheif-js/libheif-wasm/LICENSE` |

How it is used, as the LGPL asks:

- The library is **not modified**. The app uses the files published in the npm package as they are.
- It is **loaded on demand as separate files**, not merged into the app's own code: `libheif-*.wasm` (the
  compiled library) and its JavaScript loader, which ships inside the small worker script
  `heic.worker-*.js` (and in `heicLib-*.js`, the fallback for browsers without module workers). They are
  only downloaded when someone adds a HEIC photo.
- It **can be replaced**: the app's source is public, so anyone can install another version of `libheif-js`
  (`npm install libheif-js@<version>`) and rebuild with `npm run build`. The code that calls it is
  `src/media/heicLib.ts` and `src/media/heicDecode.ts`.

HEVC (H.265), the codec inside HEIC photos, is covered by patents in some countries. The library is free
software, but its license does not grant patent rights for the codec.

## BlockNote — MPL-2.0

The block editor.

| | |
|---|---|
| Packages | [`@blocknote/core`](https://www.npmjs.com/package/@blocknote/core), [`@blocknote/react`](https://www.npmjs.com/package/@blocknote/react) and [`@blocknote/mantine`](https://www.npmjs.com/package/@blocknote/mantine) 0.55.0 |
| License | Mozilla Public License, version 2.0 |
| Copyright | The BlockNote authors and contributors |
| Source code | <https://github.com/TypeCellOS/BlockNote> |
| License text | <https://www.mozilla.org/MPL/2.0/>; also in each package in `node_modules/@blocknote/` |

The packages are used unmodified. The app's own files are not under the MPL.

## Fonts — SIL Open Font License 1.1

The fonts are served with the app, unmodified.

| Font | Package | Copyright | Source |
|---|---|---|---|
| Inter | bundled in `@blocknote/core` 0.55.0 | Copyright (c) The Inter Project Authors | <https://github.com/rsms/inter> |
| Instrument Serif | [`@fontsource/instrument-serif`](https://fontsource.org/fonts/instrument-serif) 5.3.0 | Copyright 2022 The Instrument Serif Project Authors | <https://github.com/Instrument/instrument-serif> |
| IBM Plex Mono | [`@fontsource/ibm-plex-mono`](https://fontsource.org/fonts/ibm-plex-mono) 5.3.0 | Copyright 2017 IBM Corp. | <https://github.com/IBM/plex> |
| Courier Prime | [`@fontsource/courier-prime`](https://fontsource.org/fonts/courier-prime) 5.3.0 | Copyright 2015 The Courier Prime Project Authors | <https://github.com/quoteunquoteapps/CourierPrime> |

License text: <https://openfontlicense.org/open-font-license-official-text/>; also in each `@fontsource`
package in `node_modules/`.
