# Biome lint plugins

GritQL rules from Graneri, which adapts the high-signal rules of
[`dmmulroy/anti-slop`](https://github.com/dmmulroy/anti-slop). `bun run lint`
and `bun run check` run them with Biome's recommended rules and
`useTopLevelRegex` (off in tests).

- `no-chained-type-assertions` rejects `x as unknown as T`.
- `no-conditional-empty-object-spread` rewrites `...(c ? x : {})` as `...(c && x)`.
- `no-generic-record-functions` and `no-generic-unknown-record` reject
  `isRecord`, `asRecord` and `Record<string, unknown>`: parse external data
  with a named schema or contract instead.
- `no-inline-imports` and `no-import-types` require top-level imports, so
  nothing loads lazily through `import()`.
- `no-object-parameters` rejects broad `object` parameters.
- `no-reflect-apply` and `no-reflect-get` reject reflective calls.
- `no-shape-symbol-names` asks for domain names instead of `Shape`.
- `no-unknown-type-aliases` keeps `unknown` visible at parsing boundaries.

Graneri's Vitest rules are left out: this project tests with `bun:test`.
