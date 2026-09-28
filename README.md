<p align="center"><img src="public/favicon.svg" width="128" height="128" alt="Corcho logo: a green parrot on a branch in a storm"></p>

# corcho-code

**English** · [Español](README.es.md)

*Corcho* is Spanish for cork, as in a corkboard: you pin the cards, move them wherever they help you, and tie them together with string to see who depends on whom.

A code viewer laid out as a canvas: the project is drawn as a graph of free-floating nodes —folders and files with their icons— that you can drag around by hand, and on top of it you see the imports between files and which symbols each one uses from the others.

It reads JavaScript/TypeScript, C#/.NET and CSS/Sass out of the box, and **new languages are added as plugins**: each one implements the `LanguageAnalyzer` interface in its own module, without touching the core (see [Languages](#languages)).

![Corkboard theme: the project tree pinned on cork, with yarn between the selected file and its imports](docs/screenshots/corkboard.png)

```bash
npm install
npm run dev
```

Open http://localhost:5173, type the path of a project and press **Open**.

## Panels

The window is split in three: a panel on each side and the canvas in the middle.

- **explorer** — the usual directory tree, as a list. It shares the open-folder state with the canvas: what you expand in one expands in the other. Click a file to select it, double-click to open its code, right-click for the same menu as on the canvas; the row scrolls into view by itself when you select something on the canvas.
- **detail** — the dependency inspector for the selected file.

Both panels **swap sides** with ⇄ and **collapse** into a narrow rail with ‹ / › (the rail keeps the name written vertically and a button to expand it again). The layout is saved in `localStorage`, so the window stays the way you left it.

## Using the canvas

The project is drawn as a tidy tree: one column per level, children hanging from their folder with elbow connectors. It is deterministic — the same project always looks the same — and nodes never overlap.

- **Everything starts collapsed**: only the root and its first level are visible. You open what interests you instead of swallowing the whole project at once.
- **Click a folder**: opens or closes it. While closed, the imports of everything inside it are grouped on the folder icon itself.
- **Click a file**: pins it in the detail panel.
- **Drag a node** to move it: its whole subtree travels with it and is highlighted while you move it. If you drag a closed folder and then open it, its children appear next to it, not where they would have been in the original tree. **Double-click** puts the node (and everything under it) back in place, and **reorder** puts every node back.
- **Wheel**: zoom · **drag the background**: pan · **fit**: centers everything · **collapse all**: closes every folder and returns to the initial state.
- **Imports**: by default only the edges of the hovered or selected node are drawn — one color for what it imports, another for who imports it, and everything else fades out. The toolbar switches this to *all* or *none*. Edge thickness follows the number of uses.
- The detail panel lists the concrete symbols used from each dependency and how many times (`db ×6`), what the file exports, and which imports fall outside the project. Click a dependency and the canvas opens the folder that contains it and pans to it.

### Subspace

To see what a file depends on without opening half the tree: select it and press **subspace** (or the button in the detail panel). The canvas then shows only that file in the center, its dependents on the left and its dependencies on the right. Relations between the neighbors are drawn too, in gray.

Each column is **grouped by directory**: files living in the same folder sit together in a band headed by the folder path, with just the file name below. At a glance you can tell whether a dependency is scattered across the project or concentrated in a couple of folders.

The subspace does not touch the tree: pressing **exit** brings you back exactly to the previous state — the same open folders and the same nodes where you left them. Right-click a neighbor to jump to *its* subspace, so you can follow a dependency chain without getting lost.


![Subspace: the selected file in the middle, who uses it on the left and what it uses on the right, grouped by directory](docs/screenshots/subspace.png)


### Code windows

With a file selected, **code** (or "view code" in the panel) opens it in a floating window: drag it by its title bar, resize it from the corner, and open as many as you like to compare them side by side.

The controls follow the macOS convention: **traffic lights at the top left** —red closes, yellow minimizes to the dock, green toggles fullscreen, with glyphs showing on hover— and **pin at the top right**.

- Line numbers always visible, with a gutter that stays put while scrolling.
- **Font zoom** per window: the `A−`/`A+` buttons in the title bar or **Ctrl + wheel** over the code, between 9 and 24 px.
- **wrap** per window, to wrap long lines or not.
- **Minimize** stores the window in the bottom dock without losing its size, position, zoom or scroll.
- **Pin** (◎ / ◉, top right) keeps that window above the others even when you click another one. Handy to keep a reference file in sight while you open others.
- Built-in, dependency-free syntax highlighting (`highlight.ts`), with one lexer for JS/TS and another for stylesheets: running a `.css` through the JS one turned the first `url(/img/a.png)` into a regular expression and swallowed half the sheet.
- **Connections are marked in the code**: every identifier coming from another file is highlighted and underlined, with the source path in its tooltip; Ctrl+click opens that file in another window. What the file itself exports gets its own color. You can follow a function to where it is defined without leaving the canvas. In a stylesheet, `$gap`, `--brand` or the mixin of an `@include` play the identifier's role: Ctrl+click opens the partial where it is defined.

![Code window in vim mode, with a visual-line selection and cross-file symbols underlined](docs/screenshots/vim.png)


### Vim-style editing

**The code view is the editor**: there is no separate read-only mode. The window has two tabs, *code* (vim) and *preview*. The editor takes **every** key while focused: Ctrl+R, Ctrl+S, Ctrl+F, Ctrl+P, Ctrl+D and Ctrl+U belong to the editor and do not reload, search or print.

**The mouse drives the vim cursor**: a click moves it to that character, and drag-selecting enters visual mode with that same selection, so you can then apply `d`, `y` or `c` to whatever you marked with the mouse. The browser's native selection is cleared: vim's highlight rules.

**Ctrl+click** on a connected identifier opens its source file —a plain click moves the cursor— and **`gf`** does the same with the symbol under the cursor, as in vim.

What is implemented:

- **Motion**: `h j k l`, `w b e`, `0 ^ $`, `gg`, `G`, `{n}G`, Ctrl+D / Ctrl+U, with counts (`3w`, `5j`).
- **`gf`**: opens the file the symbol under the cursor comes from.
- **Insert**: `i a I A o O`, Esc back to normal.
- **Operators** with motion and count: `d`, `c`, `y` (`dw`, `d$`, `2dd`, `cw`, `yy`…), plus `x D C s J r{char}` and `p` / `P`.
- **Visual**: `v` and `V`, with `d`, `c`, `y`, `x`.
- **Undo / redo**: `u` and Ctrl+R.
- **Search**: `/pattern`, `n`, `N`.
- **Commands**: `:w`, `:q`, `:q!`, `:wq`, `:x`, `:noh`, `:{number}`.

The status line shows the mode, the file, unsaved changes (`[+]`, also as a dot in the window title), the position and any pending keys.

`:w` **really writes to disk** — it is the only operation in the app that modifies the project, via `PUT /api/file`, restricted to the opened folder. After saving, the graph is not recomputed automatically: use ↻ to analyze again.

Not implemented: macros, marks, `.`, named registers, text objects (`ciw`, `di(`), global substitution (`:s`) and split windows.

### Component preview

For a `.tsx` / `.jsx` file, the **preview** tab bundles the component with esbuild —using the project's real dependencies, its own `node_modules`— and mounts it in an isolated iframe. Below it there is a panel with **its props**, taken from the AST:

- a union of literals (`'sm' | 'md' | 'lg'`) is offered as a dropdown,
- `boolean` as a checkbox, `number` as a number field, `string` as text,
- anything else as JSON; functions are listed but not editable,
- default values from destructuring are used as initial values.

Changing any field re-renders the component instantly. The stage background toggles between light and dark to see how it behaves in both, and the checkerboard behind it reveals whether the component brings its own background.

**The project's global styles really apply.** A component styled with Tailwind classes doesn't look right just by bundling its JS: the utilities live in the CSS produced by the build. The preview finds the CSS the app loads —following the `<script type="module">` in `index.html` down to its `import './x.css'`— and compiles it with the project's own tooling:

- **Tailwind v4**: with the project's `@tailwindcss/node` and `oxide` scanner (reached through `@tailwindcss/vite` when pnpm doesn't expose them directly). If the sheet declares no `@source`, `src/` is scanned to extract the classes in use.
- **Tailwind v3 / PostCSS**: through the project's `postcss` and its config.
- **Plain CSS**: bundled with esbuild, resolving `@import` and `url()`.

External sheets linked from `index.html` (fonts, icons) are linked too. The **styles** checkbox turns all of this off to see the bare component, and next to it you can see which engine was used and how many sheets were applied.

Component detection indexes **every** declaration in the file and then looks at what is exported, so it recognizes the common pattern of declaring the component on its own and exporting it wrapped at the end:

```tsx
const Screen = () => { … }
export default observer(Screen)   // also memo, forwardRef, connect…
```

**React Native is previewed too.** Corcho provides the runtime: it ships its own `react-native-web` and redirects `'react-native'` to it, without touching the project. React and react-dom are forced to a single copy — with two, hooks blow up.

Whatever cannot run in a browser is **replaced with a stand-in**: native module wrappers, platform SDKs, navigation, i18n, missing assets and any import the bundler cannot resolve. Each stubbed component is drawn as a dashed box with its name, hooks return an object that answers to everything, and functions return their first argument (so `t('key')` renders the key). The toolbar says how many modules were stubbed and the tooltip lists them. If the build still fails, it is retried isolating **all** external dependencies: you lose what the libraries contribute, but the component's JSX and styles are still the real ones.

`babel-plugin-module-resolver` aliases (`components/ui/Button`) are resolved against `src/` before giving up, so the project's own components come in for real, not as holes.

### Stylesheets

esbuild has no Sass support, so a project with `.scss` files died with "No loader is configured for .scss files". The preview compiles them with the project's own `sass` (falling back to ours if it has none) and turns each sheet into a JS module that does two things: injects the CSS into the document and exports the class map, which is what `import styles from './x.module.scss'` needs.

Classes are not renamed —the preview mounts a single component, so there are no collisions to avoid— and the map returns the name as-is for any class it doesn't know, so an incomplete sheet doesn't break rendering. Whatever cannot be compiled (`.less`, `.styl`, a broken `@use`) is skipped with a warning in the toolbar instead of failing the build.

### App shell

A component that uses `useLocation`, `Link` or `useNavigate` blows up without a Router above it, and that says nothing about the component: that context is provided by the app's bootstrap. If the project has `react-router-dom`, the preview wraps what it renders in a `MemoryRouter` on its own, and says so in the toolbar to make clear that the context came from the preview, not from the component.

### Project providers

A screen that needs a store, i18n or a theme fails when mounted on its own. For that, there is an optional file at the project root:

```tsx
// corcho.preview.tsx
export function Providers({ children }) {
  return <StoreProvider>{children}</StoreProvider>;
}
```

The preview wraps everything it renders with it. If it doesn't exist and the component fails, the error itself explains how to create it. For everything else —uninstalled dependencies, an alias esbuild cannot resolve— the build error is shown as-is, which is usually exactly what you need to know.

### The dock

At the very bottom there is a bar holding every open code window. It keeps the canvas clear when you open many:

- **Drag a window onto the dock** and it is stored there (the dock lights up while you bring it over). The yellow button does the same.
- Each window is a chip: filled dot when open, hollow when stored. A click restores it or brings it to the front; ✕ closes it.
- **Drag chips sideways** to reorder them, or **upwards** to take that window out of the dock and drop it wherever you release it.

### Context menu

Right-click a file, a folder, the canvas background or a code window. It adapts to what is under the pointer: view code, view in subspace, center, open everything inside, copy path, fit, collapse, minimize, fullscreen, font zoom, close the others. **Double-clicking a file opens its code** directly.

### Filter

Type in the filter field and the canvas shows **only** the matching files, with the folders leading to them open. The counter on the right says how many there are and clears the filter with one click (or <kbd>Esc</kbd>).

The filter doesn't touch the tree state: clearing it brings back exactly the folders you had open before.

### What is saved

In `localStorage`: the panel layout and the theme, and per project the open folders, the code windows —with their position, size, font zoom, wrap, whether they are pinned and whether they are stored in the dock— and the imports mode. Reopening the same project brings everything back as you left it; whatever no longer exists on disk is discarded silently. The theme is stored separately, since it doesn't depend on the project.

Icons: closed folder / open folder, and a sheet per file with the color and label of its type (TS, TSX, JS, JSX, CSS…). A file node's size follows its lines of code.

## Settings

The ⚙ button in the toolbar opens the preferences panel. Changes apply live and are saved in `localStorage` (`corcho:settings`).

**Theme**: corkboard, dark or light, with a picker. Same as the toolbar button and the <kbd>t</kbd> key, without having to cycle through all three.

**Edge style**, two options:

- **curved** — the classic loose stroke, comfortable when nodes are far apart.
- **orthogonal** — straight segments with rounded corners: the edge leaves the source horizontally, goes up or down a vertical channel and enters the target horizontally, like a diagram. When source and target are almost in the same column, the channel moves to the right of both so it doesn't run over the icons.

Each source node gets **its own lane**, and the way back between the same pair uses an extra half lane. Without that, every edge went down the same column and they covered each other: you saw three lines where there were fifteen. In curved mode, the lane also varies the bulge of the curve for the same reason.

**Colors**, with a picker and a hex field for each: accent (which also paints "imports" edges), "imported by", background, panels, text, exports and matches. Each theme keeps its own set —what works in dark doesn't work in light— and anything you don't touch follows the theme. Every row has its own ↺ to go back to the original value, and there is a global reset at the bottom.

Colors travel both ways: they are written as CSS variables on the document and merged into the canvas palette, which cannot read CSS.

## Look

The style is **terminal · cartoon · minimalist**: monospace everywhere, thick outlines, hard unblurred shadows, flat colors and a single family of accents. Canvas icons use the same dark stroke as the buttons, so canvas and interface read as one thing.

The cartoon style relies on two things: the outline and the hard shadow. They are two different colors, not one. The outline is dark ink in every theme, because it sits on light fills (icons, traffic lights, badges). The shadow, on the other hand, must contrast against the **background**: black on paper in the light theme, and a bluish gray lighter than the background in the dark one — if it were black, you wouldn't see anything.

There are three themes, cycled with the toolbar button or the <kbd>t</kbd> key (the button shows the glyph of the next one):

- **corkboard** (the default) — the board the app is named after. The canvas is actual cork, with a generated texture (a tile of granules, always the same thanks to a fixed seed); files are slightly tilted index cards (a colored band with the file type, ruled lines) and folders are manila folders, each pinned with a pushpin — red on the nodes you moved by hand. With curved edges, imports are yarn hanging from pin to pin, bowing sideways between cards in the same column; highlighted ones are red or blue, twisted and casting a shadow on the cork. Tree connectors become a dashed pencil line and names sit on paper tags. Panels and toolbar are kraft paper.
- **dark** — a terminal screen.
- **light** — paper.

The choice is saved in the browser; with nothing saved, the app starts on the corkboard.

The canvas cannot read CSS variables while painting, so the palette lives twice, in `styles.css` and in `theme.ts`, with the same names.

### Shortcuts

| key | action |
| --- | --- |
| <kbd>f</kbd> | fit |
| <kbd>c</kbd> | collapse all |
| <kbd>r</kbd> | reorder moved nodes |
| <kbd>/</kbd> | go to the filter |
| <kbd>o</kbd> | open the selected file's code |
| <kbd>s</kbd> | subspace of the selected file |
| <kbd>t</kbd> | switch theme (corkboard → dark → light) |
| <kbd>Esc</kbd> | leave fullscreen → the subspace → the selection |

## How it's built

```
server/          local API that analyzes the project
  analysis/      the contract: analyzer interface and plugin registry
  languages/     one module per language (typescript.ts, csharp.ts, stylesheet.ts)
  scan.ts        walks the tree asking the registry which files count
  analyze.ts     syntactic parsing with the TypeScript compiler
  resolve.ts     resolves specifiers to real files (extensions, index,
                 tsconfig baseUrl and paths, `./foo.js` -> `foo.ts`, Sass
                 partials); each language passes its own rules
  graph.ts       builds the tree and the edges, language-agnostic
  components.ts  detects exported components and their props (AST)
  preview.ts     bundles a component with esbuild for the preview
  styleLoader.ts compiles CSS, Sass and CSS Modules for the preview
  styles.ts      compiles the project's global CSS (Tailwind v4/v3, postcss)
src/              the interface
  Explorer.tsx    directory tree in the side panel
  treeLayout.ts   tidy tree (one column per level, leaves on consecutive
                  rows, folders centered over their children) and the
                  three-column subspace layout
  icons.ts        drawing of folder and file icons
  theme.ts        canvas palettes and theme cycle
  cork.ts         generated cork texture for the corkboard theme
  settings.ts     preferences: custom colors and edge style
  SettingsPanel.tsx  the settings panel
  highlight.ts    built-in JS/TS and stylesheet tokenizers, for coloring
                  and name detection
  CodeWindow.tsx  floating code window: drag, resize, focus and wrap
  vim.ts          vim engine (pure function: key + state -> state)
  VimEditor.tsx   editor with the vim engine and the status line
  PreviewPane.tsx component render in an iframe + props panel
  CanvasGraph.tsx 2D canvas rendering, zoom/pan, dragging and highlighting
  Inspector.tsx   dependency panel for the selected file
```

The analysis is **syntactic** and does no type checking: that's why a mid-sized project is analyzed in a few hundred milliseconds. The trade-off is that uses are counted by identifier name, so a local variable named like an import would inflate the count.

## Languages

The core knows nothing about languages. It defines an interface —`LanguageAnalyzer` in `server/analysis/types.ts`, next to its consumer— and each language implements it in its own module, registered in `server/languages/index.ts`. `graph.ts` dispatches files to the analyzers without knowing any of them.

The contract has **two phases**, and that is the design decision that matters:

1. `parse(file)` extracts facts from a file looking only at that file.
2. `link(context)` receives the whole project, already indexed, and only then produces the edges.

It has to be this way because not every language resolves the same. In JS/TS an import points to a path and is resolved with the file at hand. In C# it isn't: `using Foo.Bar` names a namespace spread across many files, and two types in the same namespace don't even need a `using`. There the dependency is inferred the other way around —which type each file declares, which types each file uses— and that requires everything to be indexed first.

| language | extensions | how edges are found |
| --- | --- | --- |
| **JS / TypeScript** | `.ts .tsx .js .jsx .mjs .cjs .mts .cts` | TS compiler AST; specifiers are resolved to files (extensions, `index`, tsconfig `baseUrl` and `paths`) |
| **C# / .NET** | `.cs` | index of declared type → file, then which types each file uses; `using`s that don't match a project namespace are listed as external |
| **CSS / Sass** | `.css .scss .sass .less .styl` | `@use`, `@forward`, `@import` and CSS Modules `composes`; symbols come from matching what the target sheet offers against what the source sheet uses |

To add a new one: implement the interface and add it to the list in `registerBuiltinLanguages()`. The plugin also declares which directories to ignore (`node_modules` for JS, `bin`/`obj` for .NET) and which files to skip (`.d.ts`, `*.Designer.cs`, `*.min.css`), so the scanner has no per-language rules either.

**Stylesheets are nodes like any other**: they import and are imported. A sheet depends on others through `@use`, `@forward`, `@import` or CSS Modules `composes`, and is in turn a dependency of the module that loads it —that edge comes from the JS/TS analyzer, which resolves `./App.css` against the whole project instead of treating it as external—. So a `.tsx` connects to its `.module.scss`, that `.scss` to the tokens' `_index.scss`, and that one to each partial, which is the path you used to walk by hand.

Edge detail is harder than in JS, because `@use "variables"` doesn't say what it brings in: it has to be inferred. Each sheet publishes what it offers —`$variables`, `--custom-properties`, `@mixin`, `@function`, classes and placeholders— and linking matches that against what the other sheet uses. An `_index.scss` that only does `@forward` offers what its forwarded files offer, so whoever uses it sees the real names and not an empty file. Resolution mimics the compiler's: `_` partials and a directory's `_index.scss`. A bare specifier —`variables`, `src/styles/mixins`— is searched in each directory from the requesting file upwards: the real loadPaths live in the bundler config, and by convention they hang from the package root, which in a monorepo is not the root of what you are looking at. Whatever falls outside the tree —`tailwindcss`, `~bootstrap/…`, `sass:math`, a Google Fonts sheet— shows up as external, just like an npm package.

Bundler aliases defined in `vite.config.ts` or the project's webpack config are not read: if an `@use "@styles/theme"` isn't covered by `tsconfig`, it stays external.

About C# in particular: the parser strips comments and literals, then recognizes `namespace`, `using` (including `static`, aliases and `global`), `class`/`interface`/`struct`/`enum`/`record` declarations —nested and `partial` ones too, which link to all their files— and counts PascalCase identifiers as type candidates. It is a convention-based heuristic, not a compiler: a type named like another one in a different namespace can produce an extra edge, and calls through reflection or dependency injection don't show up.

## Status

First milestone: a navigable tree with icons, folders that open and close, movable nodes, a relations subspace, code windows with connections marked, and import edges with symbol detail.

Natural next steps:

- Function level inside a file when zooming in (the parser already has the AST).
- Java, Python and PHP: one more `LanguageAnalyzer` each, without touching the core.
- Package it as a desktop app with Tauri: the server is already isolated from the UI.
