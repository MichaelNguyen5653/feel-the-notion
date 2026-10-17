# How Notion's block drag works (reverse-engineered)

Source: Notion desktop (macOS), 2026-10-16. The Electron `app.asar` is only a
shell; the editor is the `app.notion.com` web bundle cached in
`~/Library/Application Support/Notion/Partitions/notion/Service Worker/CacheStorage`.
These notes come from static reading of those chunks (rspack, minified). Module
IDs belong to that build and will change.

## 1. Pointer pipeline: no HTML5 DnD

`Draggable` (module 698496):

- `mousedown` on the handle adds `mousemove` and `mouseup` listeners to `window`.
- `mousemove` is throttled to **15 ms with a trailing call** and reads only
  `clientX/clientY`.
- Sets `body.is-dragging` and registers an **Esc** shortcut that cancels the drag.
- Records scroll positions at drag start. On touch, the drag aborts if the page
  scrolls during the 500 ms long-press wait.
- Drag state lives in a global store (`DragBlockStore`: `startX/Y`,
  `currentX/Y`, `offsetX/Y` = grab point inside the block, `draggedStores`,
  `ghostElements`, `currentDropZone`, `currentHintDropZones`,
  `currentParentStore`).

## 2. Hit-testing reads a rect cache, not the DOM

`SelectableRectStore.selectableRectMap` holds one `getBoundingClientRect()` per
block, measured in a single pass and refreshed only on **scroll/resize**. Each
pointer frame scores those cached rects and never queries layout. Each block's
rect **includes its children**, because children render inside the parent's DOM
node.

For every block, five candidate zones are built (`r8`):

| Zone | Condition (pointer `p`, block rect `r`) | Line drawn at |
|---|---|---|
| Above | `r.left-30 ≤ p.x ≤ r.right`, `abs(p.y-r.top) ≤ 125`, and (`r.height ≤ 50` or `p.y ≤ r.top+25`) | `r.top`, from `r.left` |
| Below | same x band, `r.bottom-p.y ≤ 125`, `p.y-r.bottom ≤ 125` (unbounded if last item), and (`h ≤ 50` or `p.y ≥ r.bottom-25`) | `r.bottom`, from `r.left` |
| Onto | `p` inside `r` and block accepts children (toggle, page) | whole block filled |
| Left/Right | `p.y` within the block, `abs(p.x-edge) ≤ 200` | vertical line, makes columns |

The 30 px allowance extends every line into the handle gutter.

## 3. Choosing depth: lines that share a y

This is the nesting mechanic (AppComponents `505636`, around pretty line 24617):

1. Keep only zones at the highest priority (the innermost droppable container).
2. Find the Above/Below zone `S` whose y is **closest to the pointer**. If
   `S.target` is the block being dragged, there is no drop and no indicator.
3. Collect every Above/Below zone within **2 px of `S.top`**. At the bottom of a
   nested list, these lines all sit at the same y: the last child's Below
   (deepest), each ancestor's Below, and the next sibling's Above (shallowest).
   Each one starts at its own block's left edge.
4. Keep the zones whose x band contains the pointer and sort them by `left`.
   Walk the list and stop at the first zone whose `left > pointer.x`. The
   **deepest level whose left edge is at or left of the pointer** wins. It is
   not the nearest level.
5. The winner becomes `currentDropZone`. The other levels become
   `currentHintDropZones`, drawn as faint hint lines.
6. `Onto` (smallest-height block that accepts children) applies only when no
   Above/Below line is within 7 px of the pointer.

Consequences:

- You **outdent out of a nest** by moving left at a list boundary. You choose
  between "after the last child", "after the parent" and so on.
- Between a parent's text and its first child, the only zone is the child's
  **Above**. The parent's Below sits after its whole subtree. **A drop can never
  re-parent other blocks.** Notion never "steals" the following lines as
  children.
- You nest into a block in three ways: Above the first child of an open list or
  toggle, Onto a toggle or page (appends as a child), or the deepest coincident
  Below.

## 4. Drop semantics (listBlockDropActions `760602`)

- Above → insert before the target, under the target's parent.
- Below → insert after the target, under the target's parent.
- Onto → append as the target's last child.
- Left/Right → wrap the target in a column list.

The whole subtree moves in one transaction, which is a single undo step.

## 5. Visual feedback (Selectable `365711`)

- Drop line: **4 px**, `rgba(35,131,226,0.43)`, absolutely positioned **inside
  the target block** (`top:-4` for Above, `bottom:-4` for Below), from the
  block's left edge to its right edge. The line's left edge shows the depth. A
  2 px notch in the background colour cuts the line's start.
- Onto: the target is filled with `rgba(35,131,226,0.14)`.
- **Parent halo**: the block that will become the new parent gets
  `rgba(35,131,226,0.07)`, which shows where the block will nest.
- Line, hint and halo **fade with opacity** on enter and exit. Their position is
  not tweened.
- Ghost (`774353`): `cloneNode(true)` of the real block DOM, with computed styles
  inlined. It is placed at the block's original rect, at **opacity 0.4**, and
  moved with `translate3d(currentX-startX, currentY-startY, 0)`. The block
  appears to lift from where it was grabbed and follow the pointer from that
  grab point. Only the composited transform changes, so there is no layout.

## 6. Edge auto-scroll (`447890`)

- Edge zone: `max(20, 10% of scroller height)` vertically and
  `max(20, 8% of width)` horizontally.
- Per tick: `ratio = (threshold - distanceToEdge) / threshold`, then
  `speed = h/600 + (3h/60 - h/600) * min(ratio², 1)`, with `h` the scroller size.
  The speed ramps quadratically from slow to about 5% of the viewport per tick.
- Scrolling stops when the scroller reaches its end.

## 7. Runtime verification (live app.notion.com, 2026-10-16)

Method: drove a drag with synthetic mouse events on a scratch page (desktop
viewport, 120 Hz display). Exposed Notion's own debug stores with
`localStorage.__console = "true"` (removed afterwards) and counted calls to
`getBoundingClientRect`.

**Confirmed**
- **Start threshold:** moving 6 px does not start a block drag; 7 px does.
  `body.is-dragging` appears on the first pixel. The preview and drop line wait
  for the threshold.
- **Depth = deepest left edge ≤ pointer x.** Sweep across the boundary where
  three nested levels end (left edges 96 / 128 / 160):

  | pointer x | drop after | tinted parent |
  |---|---|---|
  | < 128 | the depth-0 item | none |
  | 128–159 | the depth-1 item | depth-0 item |
  | 160–191 | the depth-2 item | depth-1 item |
  | ≥ 192 | **inside** the depth-2 item, as its first child | depth-2 item |

  Each switch happens exactly at a level's left edge. Pointer y ±2 px around the
  boundary gives identical results.
- **Nesting under a childless bullet works.** Every list item registers a
  second, **zero-height Selectable with the same block id**, placed at its child
  position (`left + 32`, at the bottom of its text). Its Above/Below line is the
  "make first child" target.
- **What you see:** the shallower levels on the same boundary also render, at
  full opacity. They overlap into one continuous bar starting at the shallowest
  level, so the line alone does not show the depth. **The 0.07 tint on the
  would-be parent is the depth cue.** The preview (cloned bullet and text at 0.4
  opacity) follows the pointer at the grab offset.
- **Tall blocks:** the line stays on the nearest valid edge. It switches to the
  bottom edge only within about 25 px of the bottom. A code block has no Onto
  zone.
- **Performance:** 120 pointer moves in 1.1 s gave frame times of p50 8.3 ms,
  p95 9.1 ms, max 9.4 ms, with zero long tasks. There were about 1.4 layout reads
  per move, all from overlay components mounting. The rect cache refreshed on
  mousedown and twice across 60 moves.
- **Esc** cancels the drag; the line fades out over about 300 ms.
- **After the drop:** the block **snaps** to its new position (no slide
  animation). The line and parent tint fade out over about 150 ms. The dropped
  block **stays selected** (0.14 tint). One ⌘Z restores the whole move.

- **Multi-block drag:**
  - Grabbing the handle of a block inside a selection carries the **whole
    selection**. The preview holds every selected block at its original relative
    spacing (here 40 px apart), each at 0.4 opacity, moved as one `translate3d`.
  - Grabbing an **unselected** block while others are selected moves only that
    block, and the existing selection is dropped.
  - The original blocks stay at full opacity during the drag (no dimming), and
    the 0.14 selection tint is hidden until the drop.

**Out of scope (per the user):** edge auto-scroll and dropping into a toggle.
Neither was verified at runtime.

## 8. Prior art: obsidian-outliner `DragAndDrop.ts` (CM6, markdown)

- **Drop spots built from the list tree:** at drag start, for each list item
  `before` and `after` at its own level, plus `inside` for items with no
  children. This is Notion's coincident-line model built from markdown, and
  because the spots come from the tree, a drop can never re-parent neighbours.
- **Picking a spot:** the nearest line vertically, then keep the spots within
  4 px of it, then the one whose `left` is nearest the pointer. Notion instead
  picks the deepest left edge ≤ x, and the live test above shows Notion's rule.
- **Feedback with CM decorations:** dragged lines get `Decoration.line` with
  opacity 0.5 and a 0.2 accent tint. The new parent's line gets a 0.4 accent
  tint, the equivalent of Notion's parent tint. A dashed SVG segment marks the
  target depth.
- **Safety:** re-parses the list before applying and refuses if the content
  changed during the drag. Renumbers numbered lists and restores the cursor.
  Esc cancels.
- **Weaknesses:** only works within one list; calls `coordsAtPos` for every
  spot on every mousemove with no throttle; no auto-scroll; no start threshold.

## Mapping to feel-the-notion (CM6, markdown)

| Notion | Plugin today | Port |
|---|---|---|
| Rect cache, no layout in the hot path | `posAtCoords` + 2×`coordsAtPos` every frame | `view.lineBlockAtHeight(y - view.documentTop)` reads CM's height map without forcing layout |
| Deepest level with `left ≤ pointer.x` | nearest column (`round`, then snap to nearest) | Pick the largest allowed indent whose pixel x is `≤ mouseX` |
| Never re-parents neighbours | `allowedIndents` allows indent 0 between `- parent` and `    - child`, which makes the child a child of the dropped block | Build drop spots from the block tree, as Outliner does: before and after each block at its depth, plus inside for childless items. Re-parenting neighbours then can't happen |
| Start threshold 7 px | drag starts on mousedown | Add a 7 px dead zone, so a click on the handle still opens the menu |
| After the drop: block stays selected; line and tint fade out | indicator removed | Select the dropped block range and fade the indicator out |
| Ghost = cloned block, grab offset kept | text pill at pointer + 10 px | Clone the rendered `.cm-line`s of the range, keep the grab offset, use `translate3d`, opacity 0.4 |
| Edge auto-scroll | none | Out of scope for now (user decision); the formula above is kept for later |
| Esc cancels | none | Add a `keydown` listener during the drag |
| No indicator over the dragged span | indicator shows, drop is a no-op | Hide the indicator when the target is inside the source span |
| Parent tint (the main depth cue) | dot when there is a choice | `Decoration.line` with the 0.07 tint on the would-be parent's subtree, as Outliner does |

Also: in `styles.css` the second `.block-drag-indicator { transition: left…, width… }`
rule overrides the earlier `transition: top 0.1s`, so `top` never animates. This
matches Notion, which does not tween position either.
