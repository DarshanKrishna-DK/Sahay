sileo 0.1.6 toast island for the Sahay app (public/js/app/toast.js).

Files
- sileo-island.js: one minified ES module (esbuild 0.24.2, target es2020, production React,
  no eval) bundling scripts/sileo-island.js with these packages:
- framer-motion 12.43.0 (MIT): LICENSE-framer-motion.txt
- motion 12.43.0 (MIT): LICENSE-motion.txt
- motion-dom 12.43.0 (MIT): LICENSE-motion-dom.txt
- motion-utils 12.39.0 (MIT): LICENSE-motion-utils.txt
- react 18.3.1 (MIT): LICENSE-react.txt
- react-dom 18.3.1 (MIT): LICENSE-react-dom.txt
- scheduler 0.23.2 (MIT): LICENSE-scheduler.txt
- sileo 0.1.6 (MIT): LICENSE-sileo.txt
- sileo.css: byte copy of node_modules/sileo/dist/styles.css, loaded by public/app.html with <link>.

Rebuild (after changing scripts/sileo-island.js or a version in package.json):
  npm run build:sileo
Commit the output; there is no build step at run time. scripts/build-sileo.mjs lists the four
small patches made to sileo's source while bundling (style injection removed, its own aria-live
off, SVG title removed, toast root is a div) and stops if any of them no longer applies.
