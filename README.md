# Floodwood Pond

A calm, low-poly canoe game for the browser (three.js). You launch from the hand launch at the north end of **Floodwood Pond**
in the St. Regis Canoe Area (Adirondack Park, NY) and paddle slowly around the real shoreline, Big Island and its campsites,
from a pre-dawn sky through day, golden hour and a starry night.

## v0.5.0 (test branch): Memories
You wake in a tent on the north shore, climb out, look back, walk down to the canoe and push off.
Ghost memories play alongside you and fade: a cantaloupe tossed in the water, a kayaker who tips over,
two tandem kayaks of shouting young men, a canoe towing a picnic table to Big Island, boys playing on the
island ("ah beef beef beef beef"), and a race that ends with a canoe shoved into a fallen tree.
Mist closes in behind you and a slow current pulls you around Big Island and down the creek, where the
journey ends in the fog. You can still paddle anywhere; auto paddle follows the journey.
Add `?free=1` to the URL for the old free-roam game. Optional voice clips go in `audio/memories/`.

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
