# SkyPulse Atlas: the interactive map

`skypulse-atlas.html` is a single, self-contained page: a zoomable map of the whole system with the real code behind every box and arrow. Open it in any browser (it needs internet only for its fonts).

What you can do on it:

- **Pan and zoom** (drag, scroll or pinch, the `+` `−` `⤢` buttons, or the minimap). The map changes with the zoom level: **zones** (namespaces) → **components** with their connections → the **code files** inside each component.
- **Click anything** (a zone, a pod, an arrow, a file) to open its explanation, its connections and the code that implements it, with line numbers and a link to the lines on GitHub. `←` in the panel goes back.
- **Layers**: application traffic, monitoring, control plane, build & deploy, and the **blocked paths** that `make verify` proves are closed.
- **Guided tours** that fly through a scenario step by step, with the relevant code at each step: *Subscribe → ingest*, *Analyze → summarize → read*, *make start*, *The security boundary*, *When things break*.
- **Search** (`/`) for a pod, file, zone or tour. Keys: `+` `−` zoom, `0` show all, `←` `→` tour steps, `Esc` close.
- Deep links: `skypulse-atlas.html#analyzer` opens on a component, `#boundary` starts that tour.

## How it is built (and kept accurate)

The page is generated, like the posters in `../diagrams/`:

| File | Role |
|---|---|
| `src/atlas-data.mjs` | The map: zones, components, files, connections, layers and tours (positions and prose) |
| `src/snippets.mjs` | Every code excerpt, located in `skypulse/` **by anchor text**, never by line number |
| `src/template.html` | The page: styles and the interactive map (plain JavaScript, no framework) |
| `src/build.mjs` | Checks every reference, extracts and highlights the excerpts, writes `skypulse-atlas.html` |

The build fails if an anchor disappears from the source or if the map refers to a component, file, connection or excerpt that doesn't exist. After changing the code, regenerate it (it shares the posters' dependencies):

```bash
cd project_explanation/diagrams/src
npm install
node ../../interactive-map/src/build.mjs
```

The prose is written by hand, so re-read the affected components and tour steps when behaviour changes.
