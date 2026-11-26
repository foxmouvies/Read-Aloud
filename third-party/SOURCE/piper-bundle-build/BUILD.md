# Rebuilding piper/worker.js

Inputs: v2/went.js (the extension's own Piper adapter source), v2/wpre.js, v2/empty.js, package.json, package-lock.json (pins onnxruntime-web 1.18.0 and esbuild 0.28.2). No other npm package is bundled: the only module in the output is onnxruntime-web's dist/esm/ort.wasm.min.js.

    npm ci
    node_modules/.bin/esbuild v2/went.js --bundle --format=iife --alias:fs=./v2/empty.js --alias:path=./v2/empty.js --alias:crypto=./v2/empty.js --outfile=piper/worker.js

No post-processing step. Verified: a clean `npm ci` in an empty directory and the command above reproduce piper/worker.js byte for byte (sha256 04e26d76a6992d21d496697906be5c12e577546a81e519cd5fa26f34213f309a).

The ort-wasm*.wasm files are copied unmodified from onnxruntime-web 1.18.0 (dist/). piper_phonemize.js/.wasm/.data are built from the sources below.

# piper_phonemize.wasm / .data
Built from piper-phonemize cfff8e52ebaea37c7e953ae2d06b174acb827ac4 with emsdk 3.1.47 (commit a7c808831a666cc903fedb906c171a718cd97341) and espeak-ng; see ../b1.sh, b2.sh, b3.sh and the logs archive. piper_phonemize.data is the Emscripten --preload-file packaging of the espeak-ng-data directory built from espeak-ng 8593723f10cfd9befd50de447f14bf0a9d2a14a4: all 494 files inside the .data match that directory byte for byte, and the directory has no extras. The linked espeak-ng library comes from the pinned source zip espeak-ng-0f65aa30.zip.
