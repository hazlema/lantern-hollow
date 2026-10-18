// Late-game stress scene for measuring draw calls.
// (await import('/tests/perfscene.js')).setup(window.game) then .measure(window.game, zoom)
export async function setup(g) {
  localStorage.setItem('lh_tutorial_done', '1');
  g.newGame();
  await new Promise((r) => setTimeout(r, 200));
  g.embers = 99;
  for (const id of ['cat_unlock', 'syr_unlock', 'lan_unlock', 'owl_unlock', 'acorn_hard', 'acorn_reload', 'acorn_twin']) g.research(id);
  g.gold = 99999;
  const kinds = ['acorn', 'catapult', 'sprinkler', 'lantern', 'owl'];
  let k = 0;
  for (let r = 0; r < g.map.rows && g.world.towers.length < 28; r++) {
    for (let c = 0; c < g.map.cols && g.world.towers.length < 28; c++) {
      if (!g.map.isBuildable(c, r) || (c + r) % 2) continue;
      g.setBuilding(kinds[k++ % kinds.length]);
      g.tryPlace(c, r);
    }
  }
  for (const t of g.world.towers) t.setLevel(1 + (t.c % 3));
  // fill the road with a night-20 crowd, but don't let the towers kill them
  g.nightN = 20;
  g.startNight();
  const saved = g.world.towers.splice(0);
  let t = 0;
  for (let i = 0; i < 30 * 30; i++) { g.world.update(1 / 30, t); t += 1 / 30; }
  g.world.towers.push(...saved);
  g.speed = 0;
  return { towers: g.world.towers.length, zombies: g.world.zombies.length };
}

export function measure(g, zoom) {
  const s = g.stage;
  s.zoomGoal = s.zoom = zoom;
  s.update(0.016, 0);
  const info = s.renderer.info;
  info.autoReset = false;
  info.reset();
  const t0 = performance.now();
  s.render();
  const ms = performance.now() - t0;
  const out = { zoom, calls: info.render.calls, triangles: info.render.triangles, ms: Math.round(ms) };
  info.autoReset = true;
  return out;
}
