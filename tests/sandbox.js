// Balance sandbox ("the magic balance button"): skip the campaign, fill the board with
// maxed towers and all research, then simulate one night and report what got through.
// Usage from devtools/preview:
//   (await import('/tests/sandbox.js')).run(window.game, { mode: 'hard', night: 20, fill: 0.75 })
// `place: 'door'` camps the cottage instead of covering the road; `count` caps the tower count.
// `budget` caps the board's cost (towers go in until it runs out).
// Lives are set very high so the night always finishes; `leaked` is the hearts it would have cost.
import { TECHS, computeMods } from '/src/data/tech.ts';
import { TOWERS, upgradeCost } from '/src/data/towers.ts';

export const MIXES = {
  balanced: ['acorn', 'acorn', 'catapult', 'sprinkler', 'acorn', 'lantern', 'catapult', 'owl', 'acorn', 'lantern', 'catapult', 'owl'],
  lanterns: ['acorn', 'lantern', 'lantern', 'lantern', 'acorn', 'lantern'],
  owls: ['owl', 'owl', 'catapult', 'sprinkler', 'owl', 'lantern'],
};

export async function run(g, { mode = 'hard', night = 20, fill = 0.75, level = 3, mix = 'balanced', tech = true, budget = Infinity, place = 'best', count = Infinity } = {}) {
  g.newGame(mode);
  g.tutorial = -1;
  g.announcer?.close?.();
  if (tech) {
    g.owned = new Set(TECHS.map((t) => t.id));
    g.mods = computeMods(g.owned);
    g.world.mods = g.mods;
  }
  g.nightN = night;
  g.lives = g.maxLives = 100000;

  // best tiles first: the ones that see the most road
  const pts = g.world.path.points;
  const tiles = [];
  for (let r = 0; r < g.map.rows; r++) for (let c = 0; c < g.map.cols; c++) {
    if (!g.map.isBuildable(c, r)) continue;
    const w = g.map.toWorld(c, r);
    let cover = 0;
    for (const p of pts) if (Math.hypot(p.x - w.x, p.z - w.z) < 3) cover++;
    tiles.push({ c, r, cover });
  }
  if (place === 'door') {
    // camp the cottage: the tiles closest to where the road ends
    const end = pts[pts.length - 1];
    for (const t of tiles) { const w = g.map.toWorld(t.c, t.r); t.door = Math.hypot(w.x - end.x, w.z - end.z); }
    tiles.sort((a, b) => a.door - b.door);
  } else tiles.sort((a, b) => b.cover - a.cover);
  const picks = tiles.slice(0, Math.min(count, Math.round(tiles.length * fill)));
  const order = MIXES[mix] ?? mix;
  let cost = 0;
  let placed = 0;
  for (const [i, t] of picks.entries()) {
    const id = order[i % order.length];
    const def = TOWERS[id];
    let spent = def.cost;
    for (let l = 1; l < level; l++) spent += upgradeCost(def, l);
    spent = Math.round(spent * g.mods.costMult);
    // a budget stands in for the gold a real run would have earned by now
    if (cost + spent > budget) break;
    placed++;
    const tw = g.placeTower(id, t.c, t.r, spent, false);
    tw.setLevel(level);
    cost += spent;
  }

  g.startNight();
  let t = 0;
  const hp0 = g.lives;
  let lastYield = performance.now();
  // stop at the end of the night rather than calling dawn(), so no trophies get awarded
  while (g.world.nightActive && t < 900) {
    g.world.update(1 / 20, t); t += 1 / 20;
    // keep the page responsive
    if (performance.now() - lastYield > 50) { await new Promise((r) => setTimeout(r, 0)); lastYield = performance.now(); }
  }
  const towers = g.world.towers;
  return {
    mode, night, fill, level, mix,
    tiles: `${placed} / ${tiles.length}`,
    boardCost: cost,
    leaked: hp0 - g.lives,
    secs: Math.round(t),
    worn: towers.filter((x) => x.condition < 0.999).length,
    broken: towers.filter((x) => x.condition <= 0).length,
    destroyed: placed - towers.length,
  };
}
