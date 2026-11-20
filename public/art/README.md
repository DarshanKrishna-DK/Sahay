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
