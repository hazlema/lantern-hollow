// Balance bot: paste into the page (window.game must exist). Plays the full
// campaign with a simple greedy strategy and returns a per-night log.
// Usage from devtools/preview: (await import('/tests/bot.js')).run(window.game, { skill: 1 })
export async function run(g, { skill = 1, maxNights = 20, priorities, mix: mixOverride } = {}) {
  g.newGame();
  g.tutorial = -1;
  const order = priorities ?? ['syr_unlock', 'acorn_hard', 'cat_unlock', 'acorn_reload', 'home_thrifty', 'lan_unlock', 'cat_big',
    'syr_sticky', 'acorn_twin', 'lan_swarm', 'home_harvest', 'owl_unlock', 'owl_keen', 'cat_spicy', 'syr_molasses',
    'lan_overcharge', 'acorn_golden', 'home_door', 'home_toolbox', 'owl_storm', 'home_interest'];
  const pts = g.world.path.points;
  // rank buildable tiles by how much road they cover
  const tiles = [];
  for (let r = 0; r < g.map.rows; r++) for (let c = 0; c < g.map.cols; c++) {
    if (!g.map.isBuildable(c, r)) continue;
    const w = g.map.toWorld(c, r);
    let cover = 0;
    for (const p of pts) if (Math.hypot(p.x - w.x, p.z - w.z) < 3) cover++;
    tiles.push({ c, r, cover });
  }
  tiles.sort((a, b) => b.cover - a.cover);
  const log = [];
  const mix = mixOverride ?? ['acorn', 'acorn', 'catapult', 'sprinkler', 'acorn', 'lantern', 'catapult', 'owl', 'acorn', 'lantern', 'catapult', 'owl'];
  let mixI = 0;
  let repairs = 0;
  for (let night = 1; night <= maxNights; night++) {
    // research
    for (const id of order) if (g.owned && !g.owned.has(id)) { const before = g.embers; g.research(id); if (g.embers === before) continue; }
    // fix anything the lumberjacks chewed on before spending on new stuff
    const damaged = g.world.towers.filter((t) => t.condition < 0.999).length;
    if (damaged) { g.repairAll(); repairs += damaged; }
    // spend gold: upgrade if cheaper than a new tower and we have plenty of towers
    let guard = 0;
    const COST = { acorn: 60, catapult: 115, sprinkler: 80, lantern: 135, owl: 170 };
    while (guard++ < 80) {
      const want = mix[mixI % mix.length];
      const id = g.mods.unlocked.has(want) ? want : 'acorn';
      const cost = Math.round(COST[id] * g.mods.costMult);
      const spot = tiles.find((t) => !g.tileTowers.has(`${t.c},${t.r}`));
      const towers = g.world.towers;
      const upg = towers.filter((t) => t.level < 3).sort((a, b) => a.level - b.level)[0];
      const upCost = upg ? Math.round(Math.round(COST[upg.id] * (upg.level === 1 ? 0.8 : 1.3) / 5) * 5 * g.mods.costMult) : Infinity;
      const wantMore = towers.length < 4 + night * 0.9;
      if (wantMore && spot && g.gold >= cost) { g.setBuilding(id); g.tryPlace(spot.c, spot.r); mixI++; continue; }
      if (wantMore && spot && skill < 1) break; // save up for the tower
      const canUpgrade = g.nightN >= 10;
      if (canUpgrade && upg && g.gold >= upCost) { g.select(upg); g.upgradeSelected(); g.select(null); continue; }
      if (spot && g.gold >= cost) { g.setBuilding(id); g.tryPlace(spot.c, spot.r); mixI++; continue; }
      break;
    }
    g.announcer?.close?.();
    g.startNight();
    if (g.phase !== 'night') { log.push({ night, error: `could not start night (phase ${g.phase})` }); break; }
    let t = 0;
    while (g.phase === 'night' && t < 600) {
      g.world.update(1 / 20, t); t += 1 / 20;
      if (!g.world.nightActive) g.dawn();
    }
    const worn = g.world.towers.filter((x) => x.condition < 0.999);
    window.__botProgress = `night ${night} done in ${Math.round(t)}s sim, phase ${g.phase}, zombies left ${g.world.zombies.length}`;
    log.push({ night, lives: g.lives, gold: Math.round(g.gold), embers: g.embers, towers: g.world.towers.length, levels: g.world.towers.reduce((s, x) => s + x.level, 0), secs: Math.round(t),
      worn: worn.length, broken: worn.filter((x) => x.broken).length, repairs });
    if (g.phase === 'over') break;
    await new Promise((r) => setTimeout(r, 0));
  }
  return log;
}

/** iggy's strategy: rush the lantern line and blanket the road in fireflies. */
export const LANTERN_SPAM = {
  priorities: ['lan_unlock', 'lan_swarm', 'lan_overcharge', 'acorn_hard', 'home_thrifty', 'home_door', 'home_toolbox', 'home_harvest', 'acorn_reload', 'syr_unlock',
    'owl_unlock', 'owl_keen', 'cat_unlock', 'cat_big', 'acorn_twin', 'acorn_golden', 'home_interest', 'syr_sticky', 'cat_spicy', 'syr_molasses', 'owl_storm'],
  mix: ['acorn', 'lantern', 'lantern', 'lantern', 'acorn', 'lantern'],
};
