# obsidian-nushell — Requirements

## Vision

Render Nushell data files (.nuon) and syntax-highlight Nushell scripts (.nu) using the local Nushell installation, reproducing the terminal-style colored table output inside Obsidian.

## Rendering approach

1. Shell out to `nu` with `FORCE_COLOR=1` to get ANSI-colored terminal output
2. Use `table -e -w 2000` for full expansion of nested records/lists
3. Convert ANSI escape codes to styled HTML `<span>` tags
4. Display in a dark `<pre>` block with horizontal scroll

## Features (prioritized)

### P0 — Minimum viable plugin
- [ ] Scaffold a working Obsidian plugin (manifest, main.ts, build)
- [ ] Register a `nuon` code block processor
- [ ] Render the code block content through `nu` and display ANSI-colored output

### P1 — File integration
- [ ] Render `.nuon` files when opened in Obsidian (file view)
- [ ] Render `.nuon` embeds (`![[data.nuon]]`) inline in notes
- [ ] Configurable `nu` binary path (auto-detect from PATH, allow override)

### P2 — Nushell script support
- [ ] Syntax highlighting for `.nu` files and `nu` code blocks
- [ ] Explore using `nu --highlight` or similar for native highlighting

### P3 — Polish
- [ ] Respect Obsidian theme (light/dark) for the terminal background
- [ ] Configurable table width (`-w` parameter)
- [ ] Error handling when `nu` is not installed
- [ ] Caching rendered output for performance

## Technical notes

- Obsidian runs on Electron — `child_process` is available for shelling out to `nu`
- `FORCE_COLOR=1` enables ANSI output in piped mode (nu >= 0.102)
- ANSI-to-HTML conversion is straightforward — map escape codes to `<span style="color:...">` tags
- Nushell's `to html` command is NOT suitable — it produces flat HTML tables, losing all terminal formatting and nesting

## Proven prototype

See `nu-demo.html` for a working proof of concept of the ANSI-to-HTML approach.
