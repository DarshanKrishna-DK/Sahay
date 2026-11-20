# Sahay v7 art

All pictures in this folder are our own work, drawn from code by `scripts/art/build.js`
(voxel renderer + pixel canvas in `scripts/art/lib/`, one scene per file in `scripts/art/scenes/`).
No downloaded, traced or generated-by-service art. Licence: own work, same licence as the repo.

Rebuild: `node scripts/art/build.js` (add `--only hero` to rebuild one group, `--sheet <png>` for a contact sheet).
Pixel art is drawn at a native size and scaled by whole numbers: in CSS use `image-rendering: pixelated`
and display at the file size or a whole-number fraction of it.

Batch 1 (hero, sky, about):

| File | Size | Where | Looks like |
|---|---|---|---|
| hero-scene-1200.png | 1200x892 | Hero, left side (desktop) | Floating voxel island under a big pale moon: teal kirana shop with striped awning, blue Devanagari-style sign and black roof tank; shopkeeper in a saffron kurta on the porch with sacks of rice/dal/wheat; mango tree; yellow delivery tempo loaded with sacks and its supplier; street lamp; three small islets; pastel pixel clouds. Transparent background (sky = CSS gradient). |
| hero-scene-600.png | 600x446 | Hero on phones | Same scene, native size. |
| moon.png | 440x440 | Hero / night sections | Pale moon #E3EDA6 with soft craters, lit rim and a soft halo. Transparent. |
| cloud-1..4.png | 92-236 wide | Night sections, hero | Puffy pastel pixel clouds (cream top, pink, lavender, blue underside). Transparent. |
| cloud-band.png | 960x160 | Divider: night section above, paper section below | Two rows of pixel clouds dissolving into paper #F3F1E2 at the bottom. Tiles horizontally (`background-repeat: repeat-x`). |
| cloud-band-plain.png | 960x136 | Decorative band on night | Same clouds, transparent below. Tiles horizontally. |
| shop-guide-96.png / -192.png | 96 / 192 square | About: SHOP GUIDE card | Pixel bust of the shopkeeper (tilak, moustache, pencil behind the ear, saffron kurta) on a night-sky tile with a small moon. |
| market-model.png | 772x504 | About: model picture | Voxel diorama of a market street: four kirana shops (teal, pink, ochre, sky), road with lane marks, lamps, vegetable cart, parked tempo, shoppers, neem and mango trees. Transparent. |

Batch 2 (cards, steps, built on, languages, FAQ, app):

| File | Size | Where | Looks like |
|---|---|---|---|
| feature-buy / -sell / -stock / -khata / -money / -rules / -suppliers .png (+ @2x) | 200x160 (400x320) | "What Sahay does" cards, sprite above each card | Voxel objects, transparent, bottom-aligned. Buy: rice/dal/wheat sacks with grain mounds + platform scale with lime display. Sell: printed bill with ink lines + plain lime chat bubble with three dots (no brand) + coin. Stock: wooden shelf of jars and packets. Khata: red cloth bahi-khata with gold tie and a pen. Money: steel cash box, lid open, notes inside, stacks of coins. Rules: open blue notebook with lines, a tick and a pencil. Suppliers: yellow-green delivery tempo loaded with sacks. |
| step-1-say-it.png | 360x360 | From need to order, frame 1 | Night sky + stars over a voxel grass tile; shopkeeper on his phone, lime voice waves and a speech bubble with a waveform. |
| step-2-finds-sellers.png | 360x360 | frame 2 | Three little shops (teal, ochre, pink) on a lane, each with a lime map pin above. |
| step-3-bargain.png | 360x360 | frame 3 | Shopkeeper and supplier facing each other over sacks; a cream price tag with a rupee sign and a green down-arrow. |
| step-4-your-yes.png | 360x360 | frame 4 | Big lime check beside a standing order paper. |
| builton-voice.png | 252x424 | Built on: VOICE card | Floating island with a red/white lattice radio tower, equipment hut, neem; lime signal arcs. |
| builton-ears.png | 236x336 | Built on: EARS card | Floating island with a studio microphone on a stand; cream sound arcs coming in. |
| builton-speech.png | 274x340 | Built on: SPEECH card | Floating island with two market horn loudspeakers on a wooden pole; lime sound arcs out. |
| billboard.png / billboard-small.png | 420x300 / 300x240 | Languages billboards (put HINDI / KANNADA / ENGLISH / MIXED as HTML text on the panel) | Empty blue pixel billboard, dashed inner line, posts with ladder rungs, catwalk, one or two lamps with warm light pools. Transparent. Panel area (420 file): x 22-394, y 50-196. |
| skyline-night.png | 960x180 | Languages, bottom strip; repeat-x | Night hills, neem and coconut-palm silhouettes, small flat-roof houses with lit windows and roof tanks, dark ground band. Transparent sky. |
| guidemap.png | 256x256 | FAQ illustration | Paper map: river with bridge, roads, trees, your shop (gold star) with red dotted routes to three seller shops with lime pins, compass. |
| agent-idle / -listening / -thinking / -speaking / -waiting / -trouble .png | 192x192 | App Home agent | Round lime helper with a two-leaf sprout, face and floor shadow. Listening: wide eyes, sound arcs coming in. Thinking: eyes up, three dots. Speaking: open mouth, lime waves out. Waiting: half-closed eyes, gold hourglass. Trouble: warm orange body, worried brows, red "!" badge. |
| agent-sheet.png | 1152x192 | Same, one sprite sheet | The six states in that order, 192px cells (`background-position: -192px * n`). |

Not changed: the favicon stays the real logo.
