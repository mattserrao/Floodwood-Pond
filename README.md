# Floodwood Pond

A calm, low-poly canoe game for the browser (three.js). You launch from the hand launch at the north end of **Floodwood Pond**
in the St. Regis Canoe Area (Adirondack Park, NY) and paddle slowly around the real shoreline, Big Island and its campsites,
from a pre-dawn sky through day, golden hour and a starry night.

## v0.18.0 (test branch): the conifers rebuilt

A review of the pines on 27 Nov found that the white pine was a pole of evenly stacked plates, while spruce, fir and
hemlock were solid zigzag cones with no needle texture, all washed to a bright teal. Every conifer has been rebuilt
(chosen: all conifers, mixed-age white pines, a dark core with needle sprays over it).

- **Needle sprays** (`js/treekit.js` `drawNeedles`): a new set on the right half of the leaf texture, drawn at load:
  - white pine: lobed brushes of long, soft needles
  - spruce: a shaggy, crowded mass of short twigs with stiff needles all round them
  - fir: an open, fern-like spray of paired side twigs
  - hemlock: a lacy spray with a drooping tip
  The sprays are dense and kept inside their quarter of the texture, since sparse needles thinned to nothing and
  clipped ones came out square.
- **How each conifer is built** (`needleTree`): a trunk with dead lower limb stubs, a small dark inner core so the crown
  is never see-through, and whorls of limbs (some missing) that hang down and turn up at the tips. Needle-spray clumps
  run along each limb, held level and wider than tall, lighter toward the tips and darker inside and underneath. The
  crown is pushed east, downwind of the prevailing west wind, so every pine on the pond flags the same way.
- **White pine in three ages:**
  - young: an uneven, ragged pyramid with irregular whorls, not stacked plates
  - mature: open, layered flat pads with sky and trunk between them
  - old: a flat-topped giant with forked leaders
  Forest pines pick their age by height. The camp giants and Big Island's pines are mature or old, and the sword tree
  is an old pine.
- **The other species:**
  - red spruce: broader and shaggier than the fir, with hanging limbs whose tips turn up and a ragged outline;
    near-black green, plus a broken-top variant
  - balsam fir: a smooth, regular, narrow spire with level sprays and upright purple-brown cones at the top
  - hemlock: broad, with hanging sprays, a nodding leader and lighter new tips
  - tamarack: an open, airy cone of small gold tufts on thin, slightly drooping limbs, with sky through it
  Each has two variants except tamarack.
- **Colour:** each species keeps its own greens, lifted to match the pond's palette, in place of v0.15's flat 2.3×
  brightening.
- **Seedlings and saplings** (`js/understory.js`): the small fir, spruce and new white pine are grown the same way,
  and there are more of them under the trees. The near-field's old spruce sapling model is retired (`?under=0` keeps
  it).
- **Shoreline leaning trees** (`js/shore.js`): now kit white pines, spruces and hemlocks on the tree engine, leaning
  out over the water, in place of the old bent tube with cones.
- **Fixes along the way:**
  - The needle sprays were mapped to the wrong quarters of the texture (the canvas is flipped), so every conifer wore
    another species' needles. Each now gets its own.
  - The photos no longer darken the edges of leaf and needle clumps, which fixes a dark rim round every clump,
    broadleaf ones included.
  - v0.17's crossed plant cards no longer go black on their back faces.
- **Cost:** the tree atlas grows from 15 to 18 rows (about 95 MB on High, up from 79 MB, still within budget). Load
  photos take about 0.8 s and draw calls are unchanged.

## v0.17.0 (test branch): the understory

The ground under the trees, the water's edge and the shallows are filled in with late-October plants, using bikefree's
hybrid method (chosen 27 Nov): small plants are picture cards, and ferns and shrubs are grown and photographed like the
trees, in 3D up close. Built on v0.16.0.

- **Picture cards** (`js/sprites.js`, after bikefree's `grass-cards.js`): plants are drawn on a canvas when the game
  loads (nothing is downloaded). Each one is three crossed cards that sway in the gusts.
  - Side views: sedge tussock, cattail, pickerelweed gone brown, bulrush, bur-reed, bluejoint grass, bunchberry and
    lowbush blueberry.
  - Flat: fragrant water lily and spatterdock pads, sphagnum mats with cranberry, and moss carpets.
  - The cards are grouped in 400 m tiles, with one draw call per tile for the upright plants and one for the flat ones.
- **Grown plants** (`js/treekit.js` `makeUnderstoryKit`, after bikefree's `fern()` and shrubs): fronds that are
  divided twice, in four fall colourings (cinnamon rust, royal gold-tan, bracken bronze, hay-scented cream).
  Leatherleaf, sweet gale, highbush blueberry and winterberry (with berries) are grown from several stems with leaf
  clumps in nested shells. There are also balsam fir, spruce and red maple seedlings. They're photographed by a second
  tree engine with its own atlas (about 35 MB on High). Each plant is one card, and within 12–15 m of the camera it
  dissolves into its 3D model with gently swaying fronds and twigs.
- **Placement** (`js/understory.js`): along every shore of the pond, in drifts and clumps rather than single plants,
  and about 1.5× life size to match Floodwood's tall trees.
  - **Shallows:** beds of cattail, bulrush, pickerelweed and bur-reed in the marshy stretches, and a sedge fringe
    elsewhere. Leatherleaf and sweet gale thickets stand in the water, with patches of lily pads off the marsh and in
    the coves.
  - **Waterline:** sedge and grass the whole way round, plus royal and cinnamon ferns, blueberry, winterberry, sweet
    gale and sphagnum.
  - **Under the trees (to about 40 m):** fern drifts, bunchberry and blueberry carpets, moss and seedlings.
  - The launch, the campsite, Big Island's beach and the creek are kept clear.
- **Replaced:** the old 4-sided reed cones, plain lily-pad discs, shrub islands and the near-field ring's triangle
  ferns, shrubs and sedge. The ring's duff, moss, sticks, rocks, roots, stumps, logs and saplings stay.
- **Reach and cost:** the cards shrink away from 200 to 260 m. Density is 1 on High, 0.75 on Medium and 0.45 on Low.
  On High that's about 38,000 grown plants, 57,000 plant cards and 13,000 pads and mats, built in about 1 s. In the
  test views, triangles rose by up to about 0.8 M per frame and draw calls by 0–45.
- `?under=0` brings back the old reeds, pads and ring plants for comparison.

## v0.16.0 (test branch): bikefree's newer trees and light

Brings in bikefree's tree and lighting work from 24–27 Nov (the "zwift-look" and fidelity passes), as chosen on 27 Nov.

**Trees** (`js/treekit.js`, `js/treeengine.js`)
- **Leaf clumps**: each leaf cluster is now one or two soft, round clumps that open square to the camera when the trees
  are photographed. They replace three crossed quads, which read as crosses. Normals are still rounded from the crown's
  centre, and a smaller, darker clump sits beside each one for depth.
- **Painterly leaf texture**: fewer, larger leaves, lit from above, without midribs, so the photos have less pixel
  noise.
- **Shoreline lean**: about two in three trees within 16 m of the water lean out over it, by up to about 9°, more the
  closer they stand.
- **Crown grade**: the lower part of each tree is darker and a little cooler, with the tops in sun. Bleached crowns are
  held to a rich colour, and red crowns turn slightly toward gold (more gently than bikefree, so the red maples stay
  red).

**Light** (`js/light.js`, `js/post.js`, `js/main.js`)
- **Sky as environment light**: the sky dome (with its clouds, sun glow and the ground's colour below) is rendered into
  an environment map that every lit material takes its ambient light from. It rebuilds as the light changes, at most
  every 2 s. The hemisphere light stays on as a fill.
- **Key/fill grade** in the tone mapping, half way between v0.15's natural look and bikefree's warm, saturated one:
  saturation ×1.075, a gentle S-curve, a little warmth, the sun ×1.06 and the fill ×0.95.
- **Contact shading**: screen-space ambient occlusion from the depth buffer, darkening where rocks meet the shore,
  where the canoe sits on the water and at the foot of trunks. On laptops and desktops only: 0.7 on High, 0.55 on
  Medium, off on Low and on phones.
- **Canopy shade**: crowns are drawn into a 320 m map around the camera, and a lit surface under a crown is shaded with
  soft sun flecks. On Medium and High, the trees' card shadows cover the first 75 m and the canopy takes over beyond
  (the far shores). On Low it is the trees' only shade.
- Comparison switches: `?env=0`, `?grade=0`, `?ao=0`, `?canopy=0` (and `?engine=0` for the old trees).

Not brought in (by choice): bikefree's near 3D trees, near 3D bark trunks and its air/sun-shaft pass (Floodwood keeps its
own haze, mist and god rays).

## v0.15.0 (test branch): bikefree's trees

Every tree is now drawn the way bikefree's main branch draws its trees (`js/treekit.js`, `js/treeengine.js`, ported from
bikefree's `upstate-trees.js`, `northern-rockies.js` and `tree-engine.js`):
- **Trees grown as skeletons.** Broadleaves have a trunk and limbs of curved, tapered tubes, spread up the trunk at the
  golden angle and pulled toward the light, with leaf clusters at the branch ends. Conifers are stacked tiers with jagged,
  drooping rims and dark undersides.
- **Species**: sugar maple, red maple, paper birch, beech, red spruce, balsam fir, hemlock, white pine and tamarack.
  Broadleaves come in variants by how far they've turned (green, turning, turned), with the top and outside of the
  crown turning first. Each old tree keeps its spot, height and colour family, so the forest's layout and tall shoreline
  are unchanged.
- **2D trees.** Each tree model is photographed from 12 sides when the game loads (about a quarter of a second). Every
  tree on the map is then one card that turns to face you and blends the two nearest photos. All the trees are a single
  draw call.
- **Soft up close**: a magnified card is smoothed and broken up by leaf clusters so it doesn't pixelate. Silhouettes are
  soft with MSAA (High) and cut cleanly without it (Low, Medium, phones).
- **Leafy shadows**: the cards also cast shadows, turned toward the sun and cut by their photos. Each tree's shadow card
  sits at its back, so a tree doesn't shade itself. Trees don't shade each other, as on main, where the forest's trees didn't take shadows either.
- **Floodwood's changes**: bikefree keeps one time of day, so it photographs its trees already lit. Here the sun moves,
  so two photos are taken: colour, and which way each surface faces. The cards are then lit live by the sun, sky, moon,
  shadows and fog, and foliage glows when you look toward the sun. The cards also sway in the gusts as the old trees did.
  The conifers' facing is rounded toward the crown so their flat tiers don't read black from the water.
- The camp's giant white pines, Big Island's tall pines and spruces and the sword tree's crown use the engine too (the
  sword tree keeps its 3D trunk for the katana). The near-field's detailed 3D trees are gone; its ground detail and
  contact shadows stay.
- Lighter: in the test views, draw calls went from 360–440 to 290–320 per frame and triangles fell by about 10–15%.
  The photo atlas uses about 44 MB on Medium, about 79 MB on High and at most 56 MB on phones.
- `?engine=0` brings back the old trees for comparison.

## v0.14.1 (test branch): steady reflections

The reflections no longer shimmer:
- Small waves fade out once they're finer than a pixel, so distant water can't break up into sparkling noise.
- Calm water far away lies still as glass.
- Calm water barely bends the reflection; only breeze bands and gusts break it up.
- The reflection stays crisp up close and softens with distance.
- Breeze bands have softer edges and drift more slowly; the sharp sun glint fades with distance.

In a test from the launch, frame-to-frame flicker on the far water dropped by about 57% and on the near water by about 19%. No performance cost.

## v0.14.0 (test branch): realistic, and much lighter

Look (after a photo of a still mountain lake):
- Oil paint and the painter's day are gone; the look is realistic again, still autumn.
- Clear daylight: much less haze and no midday mist. Mist now belongs to dawn, dusk, night and fog weather.
- Cumulus sky with sunlit edges; cloud shadows drift over the hills, forest and water.
- Dark, glassy water that is mostly mirror, with a crisper reflection and pale breeze bands drifting across it.
- Natural colour grade: fuller colour, more contrast, deep blacks, lighter vignette.
- The peak across the pond is taller and steeper, with a pale granite face toward the water and a forested shoulder behind. The pond stays wild.

Performance (same view, High tier): about 1,960 draw calls per frame down to about 510.
- Trees that can't be seen from the water are dropped at load (~28% of them).
- Detailed trees and ground detail are built only along the shore.
- Static props are merged into a few meshes per material.
- The reflection pass uses a coarse copy of the mountains and skips ground clutter.
- Only near props cast shadows.
- Render resolution is lower on High (1.5x) and Medium (1.25x); things look a little softer in exchange for speed on phones and laptops.

## v0.13.0 (test branch): the painter's day
Builds on the oil paint below (v0.11.0's look is all here), from v0.10.0.
- **Starts in the canoe** at the dock: the tent opening scene is gone (the tent is still up on the bank).
- **No earthquake**: the collapse, the waterfall edge and the push toward Big Island are gone; paddle where you like.
- **No memories**: the ghost memories, the ghost campsite, their voices and sounds, their models and the
  `audio/memories/` clip folder are all gone (the deer in the creek is real, so it stays). The test-build "Skip to" list in
  the pause menu is now just: on the water, Big Island, the deer, the creek mouth, the ending.
- **Music** is back to the original calm theme (an eerie version was tried and dropped).
- **No frog-like noises**: the hull creak is gone, and the water 'plop' (a long falling 'bloop' at the launch and
  for every fish rise) is now a short, real-sounding drop; fish rises are a third as frequent.
- **New mountains** (`buildMountains` in `js/world.js`): the ring of scaled blobs is replaced by one heightfield from the
  forest's edge out to 26 km (150k vertices, one draw call): forested hills 100-400 m high close behind the shore, a higher,
  more broken range a few km back, a jagged line of high peaks 17-25 km off, the earth's curve dropping the farthest
  ridges, and the rounded peak across the pond from camp (now 420 m, on long shoulders). Close up the slopes show
  treetops in autumn colours, darker and paler stands, and grey rock on the steep faces; each range further back is
  paler and bluer (the mountains have their own aerial haze). Camera far plane 9 km -> 30 km.
- **The painter's day.** Each time of day is painted with six paints (`PALETTES` in `js/paint.js`); every colour is pulled
  to the nearest one, keeping its value, with shadows and lights leaning to the hour's shadow and light paints. Golden hour
  and sunset go wild: violet shadows, orange and red water, green-gold sky.
- **Thick light**: the sun, the glitter and the brightest cloud edges stand up off the canvas and throw a small shadow.
- "Oil paint off" in the pause menu turns all of it off.

## v0.11.0 (test branch): oil paint
A painted look, inspired by [Oil Paint](https://patch.gg/blendi/oil-paint) by @blendi on Patch (MIT): the near world is built
from brush dabs, and everything else is laid in the same painter's palette. Code is in `js/paint.js`.
- **Brush dabs** on the detailed near-field trees (spruce, white pine, maple, birch), the larger ground detail (rocks, stumps, logs,
  roots, ferns, shrubs, saplings) and the shoreline props (snags, leaning trees, boulders, driftwood, root plates, shrub islands).
  Each dab is one touch of mixed colour pinned to the model's surface and laid along a direction (down a whorl, up a trunk, along a
  log), with a brush mark from an 8-mark atlas generated in code (raking light from the upper left across the paint's thickness).
  Dabs ride the existing instance matrices, so they sway with the wind, fall with the collapse and take the sun's shadow.
  On screen a dab is clamped between a min and max size; with distance fewer, larger dabs stand in for the rest, thinning to
  nothing at the edge of the dab ring, where the painted underlayer carries on.
- **Painted tone** on every lit surface: light, half-tone and shade mixes with stroke-broken edges, cool shades and warm lights.
- **Water**: level, broken touches (strokes run across the line of sight but stay pinned to the world), the mirror dragged into
  soft vertical smears, sun glitter as separate bright dabs. **Sky**: long level strokes.
- **Canvas**: paint relief catches a raking light, a fine weave shows through the darks; High also runs a light Kuwahara pass.
- **Cost by tier**: Low has no dabs (painted tone, water, sky and canvas only); Medium draws dabs within 60 m, High within 95 m.
  Shore props are now split into 200 m tiles, so far ones are culled whole (a saving with paint off too).
- **Off switch**: "Oil paint on/off" in the pause menu, or `?paint=0`. `?dabdebug` paints every dab red.

## v0.5.0 (test branch): Memories
You wake in a tent on the north shore, climb out, look back, walk down to the canoe and push off.
Ghost memories play alongside you and fade: a cantaloupe tossed in the water, a kayaker who tips over,
two tandem kayaks of shouting young men, a canoe towing a picnic table to Big Island, boys playing on the
island ("ah beef beef beef beef"), and a race that ends with a canoe shoved into a fallen tree.
Mist closes in behind you and a slow current pulls you around Big Island and down the creek, where the
journey ends in the fog. You can still paddle anywhere; auto paddle follows the journey.
The light follows the journey (grey dawn at the tent, golden hour at Big Island, dusk in the creek), there is no HUD,
and the ending surfaces a line of text in the fog. "Drift on its own" in the pause menu turns on auto paddle.
Add `?free=1` to the URL for the old free-roam game. Optional voice clips go in `audio/memories/`.

## v0.6.0 (test branch): environment, atmosphere, performance
- **Shoreline detail**: ~1,000 dead silver snags, leaning trees, granite boulders, driftwood, beaver stumps and
  upturned root plates placed only within ~14 m of the water, plus a few campsite docks and a tin boat.
- **Layered atmosphere**: fog pools in the bays and lee shores (from a 'shelter' map of the pond) and lifts as the sun
  climbs; low wisps skim the water near the canoe and part in its wake; aerial haze fades the far shore and hills
  toward the sky colour, warming toward the sun.
- **Performance**: a third tree level (flat cards) beyond ~1.1 km; the water mirror renders only the near 420 m at
  quarter/third resolution and the far treeline is a dark band; shore props are tiled and culled with the forest.

## v0.6.1: Blender-built models
`models/*.glb` are hand-built low-poly models (source: `floodwood_assets.blend`, built with Blender via MCP): a dome tent
with poles, guy lines and gear; a seated paddler with hat; a kayaker in a PFD; standing and leaping boys; a 3.4 m sea
kayak and a 4.8 m tandem with real cockpits; a 5 m canoe with gunwales, thwarts and cane seats; single and double
paddles; a picnic table; a netted cantaloupe; an aluminium rowboat; a dock with cleat and ladder. `js/models.js` loads
them; if a file is missing the game falls back to the old primitives.

## v0.6.2: the campsite
A 0.5 m ground patch around the tent (bumps, a flattened tent pad, a worn dirt path to the canoe) coloured as needle duff,
moss and packed dirt; ~2,000 pieces of leaf litter, larch and pine needles, cones and twigs clumped under the trees
and kicked off the path; a fire ring of blackened stones with cold ash, charred logs and a wisp of smoke; split
firewood stacked by a tree; a camp chair facing the fire; bronze bracken and scarlet blueberry along the tree line;
roots breaking the surface around the trunks; and dew that sparkles toward the low sun for the first minutes.

## Run it
It's static files, but ES modules need a web server:

```
python3 -m http.server 8000   # then open http://localhost:8000
```
(or push to GitHub Pages — no build step, three.js is vendored in `lib/`).

## Controls
| Action | Keyboard | Touch |
|---|---|---|
| Paddle | `W` / `↑` | push joystick up |
| Steer | `A` `D` / `←` `→` | joystick left / right |
| Back-paddle | `S` / `↓` | pull joystick down |
| Paddle hard | `Shift` | – |
| Look around | drag / scroll to zoom | drag |
| Time of day | `1` dawn · `2` day · `3` dusk · `4` night | HUD buttons |
| Mute | `M` | HUD button |
| Pause | `Esc` / `P` | ❚❚ button |
| Mood filter (grade, vignette, ground mist) | toggle in the pause menu | same |
| Cinematic 30 fps + motion blur · Letterbox | toggles in the pause menu | same |
| Graphics (Auto / Low / Medium / High) | pause menu | same |
| Tow a swimmer | triple-tap the canoe (again to let go) | same |
| Auto paddle | leave the controls alone for 8 s | same |
| Map / travel | `N` or click the minimap | tap the minimap |

## What's in it
- **Real map**: shoreline, three islands, neighbouring ponds, streams, Floodwood Road, trails and ~22 backcountry campsites come from OpenStreetMap (`js/mapdata.js`, generated once from the OSM API; Floodwood relation 1694318). Local metres, north = up.
- **Day/night cycle** (9 real minutes per 24 h, starting just before sunrise): shader sky with toon clouds, stars, moon, sun glints, dawn mist, fireflies, lantern light on the canoe and campfire glows at night.
- **Audio** is fully procedural (Web Audio): generative ambient music, wind, lapping water, paddle splashes, birdsong by day, crickets and owls at night, loon calls at dawn/dusk, geese flying over, fish rising.
- **The southwest island** is enlarged and rises steeply from the water, with tall white pines and spruce, low shoreline scrub, granite boulders and a sandy landing beach on its SW corner. Look for the old pine near the beach.
- **The creek** at the pond's southwest tip is narrow and rocky. Paddle far enough down it and the fog rolls in…
- **Moon phases**: each moonrise brings a random phase, from thin crescent to full.
- **Wildlife**: loons that dive and resurface, a V of geese, rising fish, lily pads and shoreline reeds. Foliage is late-October: golden tamaracks and red/orange maples.

## New in 0.4 (test branch)
- **Mirror-calm water**: the treeline, island and canoe reflect in the pond (low-res planar reflection, softly blurred and rippled). Low graphics falls back to a cheap painted treeline band.
- **Wind**: gusts sweep across the pond as darker, roughened cat's-paws; the same gust field sways the trees and reeds, swells the wind audio, shakes leaves off shoreline maples and nudges the canoe.
- **Weather**: each day rolls clear, overcast or a fog-bound morning that burns off by mid-morning; passing showers bring rain rings, hiss, streaks and lingering mist. Haze now follows the day: thick at dawn and night, clearest at midday.
- **Wildlife**: duck flocks that land into the wind and flush when you get close, a great blue heron in the shallows, loons that patter across the surface and fly, a high-circling bald eagle, a kingfisher rattling along the shore, deer drinking at dawn and dusk, a beaver (lodge, V-wake, tail slap), otters and a muskrat, and a rare moose. The odd distant paddler crosses the far side and never comes close.
- **Autumn detail**: leaves floating around the canoe (pushed aside by the hull), leaves falling in gusts, leaf litter on the banks and the island beach.
- **The paddle**: drips off the blade on the recovery, catch / pull / release sounds timed to the stroke, hull slaps and the odd creak in a turn.
- **3D audio**: calls come from where the animal actually is, and loud ones (loons, the beaver's slap, geese) echo off the hills.
- **Performance**: the forest is split into culled 400 m tiles with a cheap far LOD, the ground mist is ray-marched at half resolution, ripples are one instanced draw. Auto quality measures the first seconds and steps down if needed. Triangles per frame are ~35% lower than 0.3.2 on High (including the reflection pass) and ~65% lower on Low.
- Test URLs: `?quality=low|med|high`, `?weather=clear|overcast|fog|rain`, `?cine=1`, `?box=1`.

## Layout
```
index.html        UI + importmap
js/main.js        game loop, physics, camera, HUD, minimap, day cycle
js/world.js       terrain from the shoreline SDF, forest, reeds, camps, dock
js/sky.js         palette keyframes, sky dome + water shaders, planar reflection
js/canoe.js       canoe/paddler, ripples, loons, geese, fireflies, mist
js/audio.js       procedural music + nature sounds (3D positioned, hill echo)
js/wildlife.js    ducks, heron, eagle, kingfisher, deer, beaver, otters/muskrat, moose, distant paddlers
js/details.js     floating / falling leaves, paddle drips, rain streaks
js/wind.js        shared gust field (JS + GLSL twins)
js/weather.js     daily weather and showers
js/quality.js     Low / Medium / High tiers + auto calibration
js/mapdata.js     OSM-derived geometry
```

Map data © OpenStreetMap contributors, ODbL. Code is MIT.
