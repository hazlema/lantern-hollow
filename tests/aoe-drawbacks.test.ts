import { describe, expect, it } from 'vitest';
import { Zombie } from '../src/entities/zombie';
import { Path } from '../src/data/path';
import { SYRUP } from '../src/data/zombies';
import { CHAIN_FALLOFF, TOWERS } from '../src/data/towers';
import { TECH_BY_ID, computeMods, type TechId } from '../src/data/tech';

const road = new Path([{ x: 0, z: 0 }, { x: 100, z: 0 }]);

describe('firefly lantern: no stun, steep falloff per jump', () => {
  it('each jump hits noticeably softer', () => {
    expect(CHAIN_FALLOFF).toBeLessThanOrEqual(0.7);
  });

  it('Overcharge no longer stuns; it doubles damage on the first zombie', () => {
    expect(TECH_BY_ID.lan_overcharge.desc.toLowerCase()).not.toContain('stun');
    const m = computeMods(new Set<TechId>(['lan_unlock', 'lan_swarm', 'lan_overcharge']));
    expect(m.overcharge).toBe(true);
    expect('stun' in m).toBe(false);
  });
});

describe('syrup fatigue: zombies lick the syrup off', () => {
  it('a zombie slowed for long enough shrugs it off and is briefly syrup-immune', () => {
    const z = new Zombie('shambler', 1, 1);
    let slowed = 0;
    for (let t = 0; t < 20; t += 1 / 60) {
      if (Math.round(t * 60) % 30 === 0) z.slow(0.55, 1.6); // a sprinkler pulsing every half second, forever
      z.update(1 / 60, road, t);
      if (z.slowTimer > 0) slowed += 1 / 60;
    }
    const uptime = slowed / 20;
    expect(uptime).toBeLessThan(0.7);
    expect(uptime).toBeGreaterThan(0.4); // still a good slow, just not a permanent one
    expect(SYRUP.maxSlow).toBeGreaterThan(SYRUP.immunity);
  });

  it('cannot be re-slowed while licking the syrup off', () => {
    const z = new Zombie('shambler', 1, 1);
    for (let t = 0; t < SYRUP.maxSlow + 0.2; t += 1 / 60) { z.slow(0.55, 1.6); z.update(1 / 60, road, t); }
    z.slow(0.55, 1.6);
    expect(z.slowTimer).toBeLessThanOrEqual(0);
  });
});

describe('pumpkin catapult: minimum range', () => {
  it("can't lob at zombies right next to it", () => {
    expect(TOWERS.catapult.minRange ?? 0).toBeGreaterThanOrEqual(1);
  });
});
