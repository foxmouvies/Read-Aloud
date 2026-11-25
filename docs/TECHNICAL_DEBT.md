# Technical debt

1. No lint/format configuration; style is convention-only.
2. No JSDoc types; engine and text APIs are untyped.
3. Magic numbers (260-char chunk cap, 2px PDF line threshold) undocumented.
4. Zero logging; field diagnosis relies on UI messages only.
5. Packaging is ad hoc (manual zip); no reproducible build script. Planned: Cycle 1.
6. Test fixtures are generated ad hoc inside test scripts. Planned: Cycle 2 fixture suite.
7. test/ and docs currently ship inside the distributed zip; exclude in build script. Planned: Cycle 1.
8. Reader renders one DOM span per sentence; no virtualization for book-length documents. Monitor; address if benchmarks show pain (Cycle 4).
