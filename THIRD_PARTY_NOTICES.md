# Third party notices

The package bundles unmodified ES 1.1.0.38 executables for Windows x64, x86, ARM64 and ARM from voidtools.

- Source: https://github.com/voidtools/ES/tree/1.1.0.38
- License: MIT, preserved in vendor/es/LICENSE.
- Download URLs and SHA-256 hashes: vendor/es/manifest.json. These hashes identify the downloaded artifacts; they are not upstream signatures.

Everything itself is not bundled. It must be installed and its client must be running. This project is independent of voidtools.

PCRE2 validation is provided by pcre2-wasm and its bundled WebAssembly implementation of PCRE2. Its upstream license and PCRE2 notices are included in that npm dependency. Other npm dependencies retain their own licenses.
