import { describe, expect, it } from 'vitest';
import { Zombie } from '../src/entities/zombie';
import { Path } from '../src/data/path';
import { STUN } from '../src/data/zombies';

const road = new Path([{ x: 0, z: 0 }, { x: 100, z: 0 }]);
const tick = (z: Zombie, secs: number) => { for (let t = 0; t < secs; t += 1 / 60) z.update(1 / 60, road, t); };

describe('stun fatigue', () => {
  it('after a stun wears off, the zombie shrugs off new stuns for a while', () => {
    const z = new Zombie('shambler', 1, 1);
    tick(z, 0.5);
    z.stun(0.45);
    expect(z.stunTimer).toBeGreaterThan(0);
    tick(z, 0.5); // stun wears off -> immunity starts
    expect(z.stunTimer).toBeLessThanOrEqual(0);
    z.stun(0.45);
    expect(z.stunTimer, 'immune right after a stun').toBeLessThanOrEqual(0);
    tick(z, STUN.immunity + 0.1);
    z.stun(0.45);
    expect(z.stunTimer, 'stunnable again once immunity lapses').toBeGreaterThan(0);
  });

  it('re-zapping during a stun does not refresh it', () => {
    const z = new Zombie('shambler', 1, 1);
    z.stun(0.45);
    tick(z, 0.3);
    z.stun(0.45);
    expect(z.stunTimer, 'only the remainder of the first stun is left').toBeLessThan(0.2);
  });

  it('caps stun uptime even under constant zapping', () => {
    const z = new Zombie('shambler', 1, 1);
    let stunned = 0;
    for (let t = 0; t < 20; t += 1 / 60) {
      if (Math.round(t * 60) % 20 === 0) z.stun(0.45); // three zaps a second, forever
      z.update(1 / 60, road, t);
      if (z.stunTimer > 0) stunned += 1 / 60;
    }
    expect(stunned / 20).toBeLessThan(0.3);
  });

  it('the Pumpkin King cannot be stunned at all', () => {
    const king = new Zombie('king', 1, 1);
    king.stun(0.45);
    expect(king.stunTimer).toBeLessThanOrEqual(0);
  });
});
