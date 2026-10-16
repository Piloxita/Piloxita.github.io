# Vendored files (no CDN at runtime)

| File | Package | Version | Notes |
|---|---|---|---|
| `three.module.min.js` | `three` (npm) | 0.186.1 (r186) | three r186 ships no minified ESM build, so this is a tree-shaken esbuild bundle of `three-entry.js` (only the classes `js/field.js` uses). ~522 KB raw, ~134 KB gzip. MIT. |
| `gsap.min.js` | `gsap` (npm) | 3.15.0 | `dist/gsap.min.js`, unmodified. |
| `ScrollTrigger.min.js` | `gsap` (npm) | 3.15.0 | `dist/ScrollTrigger.min.js`, unmodified. |
| `../fonts/space-grotesk-var.woff2` | `@fontsource-variable/space-grotesk` | 5.3.0 | latin subset, variable wght 300-700. OFL. |
| `../fonts/jetbrains-mono-400.woff2` | `@fontsource/jetbrains-mono` | 5.3.0 | latin subset, 400. OFL. |

Rebuild the Three bundle:

```sh
npm pack three@0.186.1 && mkdir -p node_modules/three && tar xzf three-0.186.1.tgz -C node_modules/three --strip-components=1
cp vendor/three-entry.js entry.js
npx esbuild@0.25 entry.js --bundle --minify --format=esm --outfile=vendor/three.module.min.js
```
