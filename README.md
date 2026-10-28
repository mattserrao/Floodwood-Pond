# Floodwood Pond

A calm, low-poly canoe game for the browser (three.js). You launch from the hand launch at the north end of **Floodwood Pond**
in the St. Regis Canoe Area (Adirondack Park, NY) and paddle slowly around the real shoreline, Big Island and its campsites,
from a pre-dawn sky through day, golden hour and a starry night.

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

## What's in it
- **Real map**: shoreline, three islands, neighbouring ponds, streams, Floodwood Road, trails and ~22 backcountry campsites come from OpenStreetMap (`js/mapdata.js`, generated once from the OSM API; Floodwood relation 1694318). Local metres, north = up.
- **Day/night cycle** (9 real minutes per 24 h, starting just before sunrise): shader sky with toon clouds, stars, moon, sun glints, dawn mist, fireflies, lantern light on the canoe and campfire glows at night.
- **Audio** is fully procedural (Web Audio): generative ambient music, wind, lapping water, paddle splashes, birdsong by day, crickets and owls at night, loon calls at dawn/dusk, geese flying over, fish rising.
- **Wildlife**: loons that dive and resurface, a V of geese, rising fish, lily pads and shoreline reeds. Foliage is late-October: golden tamaracks and red/orange maples.

## Layout
```
index.html        UI + importmap
js/main.js        game loop, physics, camera, HUD, minimap, day cycle
js/world.js       terrain from the shoreline SDF, forest, reeds, camps, dock
js/sky.js         palette keyframes, sky dome + water shaders
js/canoe.js       canoe/paddler, ripples, loons, geese, fireflies, mist
js/audio.js       procedural music + nature sounds
js/mapdata.js     OSM-derived geometry
```

Map data © OpenStreetMap contributors, ODbL. Code is MIT.
