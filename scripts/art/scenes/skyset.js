"use strict";
// Moon with its soft halo, four pastel cloud sprites and the tileable cloud bands.
const S = require("../lib/sky");
const P = require("../lib/palette");

const moon = () => S.moon(64, { halo: 44, seed: 3, craters: 6 });
const clouds = () => [S.cloud(44, 15, 31), S.cloud(30, 11, 32), S.cloud(58, 18, 33, { bumps: 5 }), S.cloud(22, 8, 34, { bumps: 3 })];
const band = () => S.cloudBand(240, 40, 41, { solid: 6, floor: P.paper });
const bandPlain = () => S.cloudBand(240, 34, 42);
module.exports = { moon, clouds, band, bandPlain };
