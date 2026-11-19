---
name: design-check
description: Visual QA of the game's look - character cosmetics (faces, hats, accessories, patterns, colours and combinations of them), obstacles and UI screens. Use before shipping any change to renderer.js, skins, themes or UI, or when asked to check the design.
---

# Design check

Look at the rendered result, never judge from the code alone. Most visual bugs here only appear when
several cosmetics are worn together, so always review combinations, not just single items.

## Characters
1. Start the game (`PORT=3000 node server.js`, or use the running one).
2. `node tools/skin-sheet.js design-sheets 7` (second argument = random seed; try 2-3 seeds).
3. Open `design-sheets/*.png` and check each sheet:
   - **faces / hats / accs / pats / colors**: every item readable at game size? attached to the body (nothing floating, nothing sticking out of the outline)?
   - **combo**: do items fight? Things to look for:
     * item colour vanishing into the body colour (use `away(o.color, base, ...alts)` in renderer.js)
     * patterns running through the face (the pattern clip keeps the face area clear)
     * several accessories/hats covering the same spot (mouth, neck, eyes, top of head)
     * hats cut by the canvas, ears/horns colliding with headphones etc.
4. Fix in `public/js/renderer.js`, rerun the sheets, and compare before/after.

## Obstacles and levels
Take screenshots with Playwright (chromium is preinstalled) of each special surface (spring, ice, belt, crumble)
and each shooter/shot, in all themes, at 1280x720 and a phone size (390x844).

## UI
Screenshot lobby, dress-up, settings and in-game HUD at desktop and phone size. Check: text clipped or overlapping,
touch targets under 40px, contrast, anything still an emoji (the project forbids emoji; `test/icons.test.js` enforces it).

## Report
List findings most important first (what, where, a suggested fix), fix what was agreed, then run `npm test`.
