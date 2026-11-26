# Third-party components in the experimental Piper build 

This is an experimental build, not a production release. No component with an unresolved license text is shipped. This is an inventory, not a legal conclusion.

| Component | Used for | License (as recorded by the project) | Text in LICENSES/ |
|---|---|---|---|
| espeak-ng (source zip pinned 0f65aa301e0d6bae5e172cc74197d32a6182200f; data from 8593723f10cfd9befd50de447f14bf0a9d2a14a4) | Linked into piper_phonemize.wasm, and its data in piper_phonemize.data | GPL-3.0-or-later with files under Apache-2.0, BSD-2-Clause and the Unicode UCD terms | espeak-ng-COPYING*.txt |
| piper-phonemize (cfff8e52ebaea37c7e953ae2d06b174acb827ac4) | Phoneme conversion (wasm built from source here) | MIT | piper-phonemize-LICENSE.txt |
| Piper (rhasspy/piper) | Voice runtime reference | MIT | piper-LICENSE.txt |
| onnxruntime-web 1.18.0 | Inference (ort-wasm*.wasm) | MIT per package.json | onnxruntime-1.18.0-LICENSE.txt and onnxruntime-1.18.0-ThirdPartyNotices.txt (from the microsoft/onnxruntime v1.18.0 tag via cdn.jsdelivr.net) |
| Voice Alba (en_GB, medium) | Downloaded on demand from huggingface.co | Dataset CC BY 4.0 per its model card | voice-alba-MODEL_CARD.txt |
| Voice Siwis (fr_FR, medium) | Downloaded on demand | Dataset CC-BY 4.0 per its model card | voice-siwis-MODEL_CARD.txt |
| long, flatbuffers, protobufjs, platform | Possibly inlined in onnxruntime-web's ort.wasm.min.js (included in worker.js); texts kept as a precaution | MIT/BSD per their packages | long, flatbuffers, protobufjs, platform, protobufjs sub-packages |

Source for the GPL parts: the pinned espeak-ng source archive and the build scripts and logs used to build piper_phonemize.wasm and piper_phonemize.data (SOURCE/ folder). Toolchain: emsdk a7c808831a666cc903fedb906c171a718cd97341 (3.1.47).

## Extension and bundle source
The extension JavaScript, HTML and CSS in this package are the readable source, except piper/worker.js, which is built from the inputs in SOURCE/piper-bundle-build (v2/went.js, v2/wpre.js, v2/empty.js, package.json, package-lock.json). The adapter (went.js) is the extension's own code. It downloads Piper voice files from huggingface.co/rhasspy/piper-voices, stores them in the extension's OPFS, calls piper_phonemize for phoneme ids and runs onnxruntime-web. BUILD.md gives the exact command; the output reproduces byte for byte from a clean npm ci.
Build tools (emsdk 3.1.47 / LLVM, esbuild) were used to produce binaries and are referenced by version/commit; they are not shipped. Runtime notices for what is shipped are in LICENSES/.


## Distribution note (qualified, not legal advice)
espeak-ng (GPL-3.0-or-later) is linked into piper_phonemize.wasm. The conservative route chosen for this experimental build is to distribute it as a GPLv3 combined package with corresponding source (SOURCE/), the GPL text (LICENSES/espeak-ng-COPYING.txt) and the notices of the other components. The repository's MIT LICENSE file is not changed by this package.

## Voice credits
Alba: dataset https://datashare.ed.ac.uk/handle/10283/3270, CC BY 4.0 (model card in LICENSES/). Siwis: dataset https://datashare.is.ed.ac.uk/handle/10283/2353, CC-BY 4.0 (model card in LICENSES/). The same credit is shown in the Piper note in the reader.
