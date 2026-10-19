import { describe, expect, it } from 'vitest';
import { GameMap } from '../src/data/map';
import { Path, smooth } from '../src/data/path';
import { TECHS, TECH_BY_ID, canResearch, computeMods, type TechId } from '../src/data/tech';
import { buildNight, nightTotal, TOTAL_NIGHTS } from '../src/data/waves';
import { hpScale } from '../src/data/zombies';
import { TOWERS, upgradeCost } from '../src/data/towers';

describe('map', () => {
  const map = new GameMap();

  it('is 20x14', () => {
    expect(map.cols).toBe(20);
    expect(map.rows).toBe(14);
  });

  it('waypoints run over road tiles (except the crypt and cottage ends)', () => {
    for (const p of map.pathTiles()) {
      const k = map.kind(p.c, p.r);
      expect(['path', 'crypt', 'house'], `tile ${p.c},${p.r} is ${k}`).toContain(k);
    }
  });

  it('every road tile is visited by the waypoints', () => {
    const visited = new Set(map.pathTiles().map((p) => `${p.c},${p.r}`));
    map.forEach((c, r, k) => {
      if (k === 'path') expect(visited.has(`${c},${r}`), `road ${c},${r} not on route`).toBe(true);
    });
  });

  it('round-trips grid <-> world', () => {
    const w = map.toWorld(4, 7);
    expect(map.toGrid(w.x, w.z)).toEqual({ c: 4, r: 7 });
  });
});

describe('path', () => {
  it('samples endpoints and stays continuous after smoothing', () => {
    const p = new Path(smooth([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }]));
    const s = { x: 0, z: 0, dx: 0, dz: 0 };
    p.sample(0, s);
    expect(s.x).toBeCloseTo(0);
    p.sample(p.length, s);
    expect(s.x).toBeCloseTo(4);
    expect(s.z).toBeCloseTo(4);
    // corner-cut path is shorter than the 8-unit L
    expect(p.length).toBeLessThan(8);
    expect(p.length).toBeGreaterThan(6.5);
  });
});

describe('tech', () => {
  it('has no dangling requirements', () => {
    for (const t of TECHS) for (const r of t.requires) expect(TECH_BY_ID[r]).toBeDefined();
  });

  it('gates on prerequisites and embers', () => {
    const owned = new Set<TechId>();
    expect(canResearch('acorn_reload', owned, 10)).toBe(false);
    expect(canResearch('acorn_hard', owned, 0)).toBe(false);
    expect(canResearch('acorn_hard', owned, 1)).toBe(true);
    owned.add('acorn_hard');
    expect(canResearch('acorn_reload', owned, 2)).toBe(true);
  });

  it('every chapter is a strict chain: each page needs the one directly above it', () => {
    for (const t of TECHS) {
      if (t.tier === 0) { expect(t.requires, t.id).toEqual([]); continue; }
      const above = TECHS.find((o) => o.branch === t.branch && o.tier === t.tier - 1);
      expect(above, `${t.id} has nothing above it`).toBeDefined();
      expect(t.requires, t.id).toEqual([above!.id]);
    }
  });

  it('cannot skip ahead in a chapter', () => {
    const owned = new Set<TechId>(['acorn_hard', 'acorn_reload', 'home_thrifty']);
    expect(canResearch('acorn_golden', owned, 99)).toBe(false);
    expect(canResearch('home_harvest', owned, 99)).toBe(false);
  });

  it('starts with only the acorn turret and unlocks towers', () => {
    expect([...computeMods(new Set()).unlocked]).toEqual(['acorn']);
    const m = computeMods(new Set<TechId>(['cat_unlock', 'owl_unlock']));
    expect(m.unlocked.has('catapult')).toBe(true);
    expect(m.unlocked.has('owl')).toBe(true);
  });

  it('total tech cost is reachable but not trivially (players must choose)', () => {
    const total = TECHS.reduce((s, t) => s + t.cost, 0);
    expect(total).toBeGreaterThan(30);
    expect(total).toBeLessThan(60);
  });
});

describe('waves', () => {
  it('grows monotonically in size', () => {
    for (let n = 2; n <= TOTAL_NIGHTS; n++) expect(nightTotal(n)).toBeGreaterThanOrEqual(nightTotal(n - 1) - 4);
  });

  it('has the Pumpkin King on nights 10 and 20 only', () => {
    for (let n = 1; n <= TOTAL_NIGHTS; n++) {
      const hasKing = buildNight(n).some((g) => g.type === 'king');
      expect(hasKing).toBe(n % 10 === 0);
    }
  });

  it('the difficulty dial is a gentle nudge, not a cliff', async () => {
    const { DIFFICULTY } = await import('../src/data/zombies');
    expect(DIFFICULTY.hp).toBeGreaterThan(1);
    expect(DIFFICULTY.hp).toBeLessThanOrEqual(1.1);
  });

  it('scales hp up', () => {
    expect(hpScale(1)).toBe(1);
    expect(hpScale(20)).toBeGreaterThan(4);
  });
});

describe('towers', () => {
  it('upgrade costs are round numbers', () => {
    for (const t of Object.values(TOWERS)) {
      expect(upgradeCost(t, 1) % 5).toBe(0);
      expect(upgradeCost(t, 2)).toBeGreaterThan(upgradeCost(t, 1));
    }
  });
});

describe('lumberjacks & repairs', () => {
  it('lumberjacks debut the night after the first Pumpkin King', async () => {
    const { buildNight } = await import('../src/data/waves');
    for (let n = 1; n <= 20; n++) {
      expect(buildNight(n).some((g) => g.type === 'lumberjack'), `night ${n}`).toBe(n >= 11);
    }
  });

  it('chopping follows the agreed design: 5% a swing, 10 swings max', async () => {
    const { CHOP } = await import('../src/data/zombies');
    expect(CHOP.damage).toBe(0.05);
    expect(CHOP.maxSwings).toBe(10);
    expect(CHOP.damage * CHOP.maxSwings).toBeCloseTo(0.5);
  });

  it('chop chance starts at 10% on night 11 and grows 3% a night: 37% by night 20', async () => {
    const { chopChance } = await import('../src/data/zombies');
    expect(chopChance(11)).toBeCloseTo(0.10);
    expect(chopChance(12)).toBeCloseTo(0.13);
    expect(chopChance(15)).toBeCloseTo(0.22);
    expect(chopChance(20)).toBeCloseTo(0.37);
    // endless mode keeps climbing, but a lumberjack can still walk on by
    expect(chopChance(40)).toBeLessThanOrEqual(0.75);
  });

  it('repairs cost gold in proportion to the damage', async () => {
    const { repairCost } = await import('../src/data/towers');
    expect(repairCost(100, 1)).toBe(0);
    expect(repairCost(100, 0.5)).toBe(30);
    expect(repairCost(100, 0)).toBe(60);
    expect(repairCost(100, 0.95)).toBeGreaterThan(0); // even a scratch costs something
    expect(repairCost(237, 0.4) % 5).toBe(0);
  });

  it('repairs during an invasion cost double; after the invasion they are normal price', async () => {
    const { repairCost } = await import('../src/data/towers');
    expect(repairCost(100, 0.5, false)).toBe(30);
    expect(repairCost(100, 0.5, true)).toBe(60);
    expect(repairCost(100, 1, true)).toBe(0);
  });
});

describe('pacing & progression', () => {
  it('tower upgrades unlock on night 10', async () => {
    const { UPGRADE_UNLOCK_NIGHT, upgradesUnlocked } = await import('../src/data/towers');
    expect(UPGRADE_UNLOCK_NIGHT).toBe(10);
    expect(upgradesUnlocked(1)).toBe(false);
    expect(upgradesUnlocked(9)).toBe(false);
    expect(upgradesUnlocked(10)).toBe(true);
    expect(upgradesUnlocked(15)).toBe(true);
  });

  it('zombies never spawn on top of each other: at least 300 ms between any two spawns', async () => {
    const { spawnSchedule, MIN_SPAWN_GAP, nightTotal } = await import('../src/data/waves');
    expect(MIN_SPAWN_GAP).toBeGreaterThanOrEqual(0.3);
    for (let n = 1; n <= 25; n++) {
      const s = spawnSchedule(n);
      expect(s.length).toBe(nightTotal(n));
      for (let i = 1; i < s.length; i++) expect(s[i].t - s[i - 1].t, `night ${n} spawn ${i}`).toBeGreaterThanOrEqual(MIN_SPAWN_GAP - 1e-9);
    }
  });

  it('group intervals are 300 ms roomier than before', async () => {
    const { buildNight } = await import('../src/data/waves');
    const shamblers = buildNight(1).find((g) => g.type === 'shambler')!;
    expect(shamblers.interval).toBeCloseTo(1.2 - 0.035 + 0.3);
    for (let n = 1; n <= 20; n++) for (const g of buildNight(n)) expect(g.interval).toBeGreaterThanOrEqual(0.65 - 1e-9);
  });
});

describe('night repairs need the Night Toolbox', () => {
  it('repairs are always allowed by day, and at night only with the toolbox', async () => {
    const { repairsAllowed } = await import('../src/data/towers');
    expect(repairsAllowed(false, false)).toBe(true);
    expect(repairsAllowed(true, false)).toBe(false);
    expect(repairsAllowed(true, true)).toBe(true);
  });

  it('the Night Toolbox sits in Homestead directly under Sturdy Door', () => {
    const t = TECH_BY_ID.home_toolbox;
    expect(t.branch).toBe(TECH_BY_ID.home_door.branch);
    expect(t.requires).toEqual(['home_door']);
    expect(TECH_BY_ID.home_harvest.requires).toEqual(['home_toolbox']);
  });

  it('learning it unlocks night repairs', () => {
    expect(computeMods(new Set()).nightRepairs).toBe(false);
    expect(computeMods(new Set<TechId>(['home_thrifty', 'home_door', 'home_toolbox'])).nightRepairs).toBe(true);
  });
});
