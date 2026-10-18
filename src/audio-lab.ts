/**
 * Audio Lab: standalone page to audition every sound, the music layers and
 * the ambience, and to sanity-check levels and rate limiting.
 */
import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import { RAPID_FIRE, SFX_CATEGORIES, type SfxName, audio } from './audio';

const DESCRIPTIONS: Record<SfxName, string> = {
  ui_click: 'Soft wooden tok',
  ui_hover: 'Tiny high pip',
  ui_open: 'Swoosh up + two music-box notes',
  ui_close: 'Swoosh down + falling notes',
  ui_error: 'Gentle "uh-uh"',
  ui_page: 'Tech-book page turn',
  place_invalid: 'Rubbery bonk',
  build: 'Three hammer knocks + sparkle',
  upgrade: 'Rising music-box arpeggio + shimmer',
  sell: 'Dismantle tok + coin cascade',
  research: 'Whoosh into a warm "aha" chord',
  coin: 'Two-note clink',
  ember: 'Warm crackle + glow',
  acorn_fire: 'Cork-pop thwup + knock (rapid)',
  acorn_hit: 'Wooden tok + squish',
  catapult_fire: 'Creak, thunk, whoosh',
  pumpkin_explode: 'Squelchy splat-boom',
  syrup_pulse: 'Gloopy bubbly sploosh',
  zap: 'Firefly chime-crackle',
  owl_fire: 'Soft "hoo" + dart whoosh',
  owl_hit: 'Heavy dart thunk + quiver',
  zombie_groan: '"Braaains" / "uuuhhh" (6 kinds)',
  zombie_hit: 'Soft fleshy thud',
  armor_clank: 'Cooking-pot tonk',
  zombie_die: 'Deflating "bleh" + dust poof',
  brute_stomp: 'Heavy footstep',
  boss_roar: 'Pumpkin King roar, pitch dive',
  axe_chop: 'Lumberjack axe biting into a tower',
  tower_break: 'A doomed tower strains, then explodes',
  repair: 'Hammer taps and a good-as-new sparkle',
  announce: 'Herald fanfare for a new threat',
  wave_start: 'Church bell toll + distant horn',
  wave_clear: 'Marimba / music-box jingle',
  life_lost: 'Door thud + sad two notes',
  game_over: 'Gentle sad phrase (~3 s)',
  victory: 'Warm fanfare (~4 s)',
};

// handy for poking at the engine from devtools
(window as unknown as { audio: typeof audio }).audio = audio;

const app = document.getElementById('app') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const unlockBtn = document.getElementById('unlock') as HTMLButtonElement;

// ------------------------------------------------------------------ tiny DOM helpers

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const k of kids) e.append(k);
  return e;
}

function panel(title: string, hint = '', wide = false): HTMLElement {
  const p = el('section', { className: wide ? 'panel wide' : 'panel' });
  const h = el('h2', {}, title);
  if (hint) h.append(el('span', { className: 'hint' }, hint));
  p.append(h);
  app.append(p);
  return p;
}

function slider(parent: HTMLElement, label: string, value: number, onInput: (v: number) => void, fmt = (v: number) => `${Math.round(v * 100)}`, min = 0, max = 1, step = 0.01): HTMLInputElement {
  const wrap = el('div', { className: 'slider' });
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  const out = el('output', {}, fmt(value));
  const paint = () => input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = fmt(v);
    paint();
    onInput(v);
  });
  paint();
  wrap.append(el('label', {}, label), input, out);
  parent.append(wrap);
  return input;
}

function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', { className: cls }, label);
  b.addEventListener('click', onClick);
  return b;
}

function flash(b: HTMLElement): void {
  b.classList.add('flash');
  setTimeout(() => b.classList.remove('flash'), 90);
}

// ------------------------------------------------------------------ test options applied to SFX buttons

const testOpts = { volume: 1, pan: 0, pitch: 1, randomPan: false };

function fire(name: SfxName): void {
  const pan = testOpts.randomPan ? Math.random() * 2 - 1 : testOpts.pan;
  audio.play(name, { volume: testOpts.volume, pan, pitch: testOpts.pitch });
}

// ------------------------------------------------------------------ unlock

unlockBtn.addEventListener('click', async () => {
  await audio.unlock();
  unlockBtn.textContent = 'Audio unlocked';
  unlockBtn.classList.add('done');
  unlockBtn.classList.remove('primary');
});

// ------------------------------------------------------------------ mixer

{
  const p = panel('Mixer', 'saved to localStorage');
  const v = audio.getVolumes();
  slider(p, 'Master', v.master, (x) => audio.setVolumes({ master: x }));
  slider(p, 'Music', v.music, (x) => audio.setVolumes({ music: x }));
  slider(p, 'SFX', v.sfx, (x) => audio.setVolumes({ sfx: x }));
  slider(p, 'Ambience', v.ambience, (x) => audio.setVolumes({ ambience: x }));
  const mute = button(audio.isMuted() ? 'Muted' : 'Mute', () => {
    audio.setMuted(!audio.isMuted());
    mute.textContent = audio.isMuted() ? 'Muted' : 'Mute';
    mute.classList.toggle('on', audio.isMuted());
  });
  mute.classList.toggle('on', audio.isMuted());
  const reset = button('Reset defaults', () => {
    audio.setVolumes({ master: 0.8, music: 0.55, sfx: 0.8, ambience: 0.5 });
    location.reload();
  });
  p.append(el('div', { className: 'row' }, mute, reset));
}

// ------------------------------------------------------------------ music

let bossOn = false;
{
  const p = panel('Music', 'generative waltz');
  const start = button('Start music', () => {
    void audio.unlock().then(() => audio.startMusic());
  }, 'on');
  const stop = button('Stop (fade)', () => audio.stopMusic(2));
  const boss = button('Boss mode', () => {
    bossOn = !bossOn;
    audio.setBossMode(bossOn);
    boss.classList.toggle('on', bossOn);
  }, 'boss');
  p.append(el('div', { className: 'row' }, start, stop, boss));
  slider(p, 'Intensity', 0, (x) => audio.setMusicIntensity(x), (x) => (x < 0.05 ? 'calm' : x > 0.95 ? 'full' : x.toFixed(2)));
  slider(p, 'Time of day', 0, (x) => audio.setTimeOfDay(x), (x) => (x < 0.25 ? 'day' : x < 0.6 ? 'dusk' : 'night'));
  p.append(el('div', { className: 'sky' }));
  const now = el('div', { className: 'now', id: 'now' }, 'Not playing.');
  p.append(now);
}

// ------------------------------------------------------------------ ambience + test options

{
  const p = panel('Ambience', 'wind, birds, crickets, owls');
  const start = button('Start ambience', () => {
    void audio.unlock().then(() => audio.startAmbience());
  }, 'on');
  const stop = button('Stop', () => audio.stopAmbience(2));
  p.append(el('div', { className: 'row' }, start, stop));
  p.append(el('p', { className: 'note' }, 'Birds sing by day; crickets and a distant owl take over at night. Use the Time of day slider in the Music panel.'));

  const q = panel('SFX test options', 'applies to the buttons below');
  slider(q, 'Volume', 1, (x) => (testOpts.volume = x));
  slider(q, 'Pan', 0, (x) => (testOpts.pan = x), (x) => (Math.abs(x) < 0.05 ? 'C' : x < 0 ? `L${Math.round(-x * 100)}` : `R${Math.round(x * 100)}`), -1, 1);
  slider(q, 'Pitch', 1, (x) => (testOpts.pitch = x), (x) => `${x.toFixed(2)}x`, 0.5, 2);
  const rp = button('Random pan: off', () => {
    testOpts.randomPan = !testOpts.randomPan;
    rp.textContent = `Random pan: ${testOpts.randomPan ? 'on' : 'off'}`;
    rp.classList.toggle('on', testOpts.randomPan);
  });
  q.append(el('div', { className: 'row' }, rp));
}

// ------------------------------------------------------------------ SFX

for (const cat of SFX_CATEGORIES) {
  const p = panel(cat.label);
  const list = el('div', { className: 'sfx-list' });
  for (const name of cat.names) {
    const row = el('div', { className: 'sfx' });
    const play = el('button', { className: 'play' }, el('code', {}, name), el('span', {}, DESCRIPTIONS[name]));
    play.addEventListener('click', () => fire(name));
    row.append(play);
    if (RAPID_FIRE.includes(name)) {
      const spam = button('×10', () => {
        for (let i = 0; i < 10; i++) {
          setTimeout(() => {
            fire(name);
            flash(spam);
          }, i * 22);
        }
      }, 'spam');
      spam.title = 'Fire 10 times, 22 ms apart (tests rate limiting & ducking)';
      row.append(spam);
    }
    list.append(row);
  }
  p.append(list);
}

// ------------------------------------------------------------------ stress test

{
  const p = panel('Battle simulation', 'mix & anti-cacophony check');
  p.append(
    el(
      'p',
      { className: 'note' },
      'Fires a dense, randomised stream of tower, zombie and economy sounds for 15 s (with music intensity at full) so you can judge the overall mix and the rate limiting.',
    ),
  );
  let running = false;
  const go = button('Run 15 s battle', async () => {
    if (running) return;
    running = true;
    go.disabled = true;
    await audio.unlock();
    audio.startMusic();
    audio.setMusicIntensity(1);
    const weights: [SfxName, number][] = [
      ['acorn_fire', 0.55], ['acorn_hit', 0.4], ['zombie_hit', 0.35], ['zombie_groan', 0.12], ['coin', 0.06],
      ['zap', 0.07], ['catapult_fire', 0.04], ['pumpkin_explode', 0.035], ['owl_fire', 0.035], ['owl_hit', 0.035],
      ['armor_clank', 0.05], ['zombie_die', 0.05], ['brute_stomp', 0.04], ['syrup_pulse', 0.03], ['ember', 0.04],
    ];
    const t0 = performance.now();
    const id = setInterval(() => {
      for (const [name, w] of weights) if (Math.random() < w) audio.play(name, { pan: Math.random() * 1.6 - 0.8 });
      if (performance.now() - t0 > 15000) {
        clearInterval(id);
        audio.play('wave_clear');
        audio.setMusicIntensity(0);
        running = false;
        go.disabled = false;
      }
    }, 50);
  }, 'primary');
  const wave = button('Wave start', () => audio.play('wave_start'));
  p.append(el('div', { className: 'row' }, go, wave));
}

// ------------------------------------------------------------------ levels

{
  const p = panel('Levels', 'pre-rendered SFX analysis', true);
  const out = el('div', { id: 'levels-out' });
  const analyze = button('Analyze SFX levels', async () => {
    await audio.unlock();
    await audio.whenReady();
    const data = audio.analyzeSfx();
    const table = el('table');
    table.append(el('tr', {}, el('th', {}, 'Sound'), el('th', {}, 'Vars'), el('th', {}, 'Peak dBFS (max)'), el('th', {}, 'Weighted loudness (avg)'), el('th', {}, 'Plain RMS (avg)'), el('th', {}, 'Length'), el('th', {}, '')));
    for (const cat of SFX_CATEGORIES) {
      for (const name of cat.names) {
        const lv = data[name];
        if (!lv) continue;
        const peak = Math.max(...lv.map((l) => l.peakDb));
        const loud = lv.reduce((a, l) => a + l.loudDb, 0) / lv.length;
        const rms = lv.reduce((a, l) => a + l.rmsDb, 0) / lv.length;
        const len = Math.max(...lv.map((l) => l.seconds));
        const meter = el('div', { className: 'meter' }, el('i', {}));
        (meter.firstChild as HTMLElement).style.width = `${Math.max(2, Math.min(100, ((loud + 40) / 30) * 100))}%`;
        table.append(
          el(
            'tr',
            {},
            el('td', {}, el('code', {}, name)),
            el('td', {}, String(lv.length)),
            el('td', { className: peak > -0.2 ? 'bad' : 'ok' }, peak.toFixed(1)),
            el('td', { className: loud < -36 ? 'bad' : '' }, loud.toFixed(1)),
            el('td', {}, rms.toFixed(1)),
            el('td', {}, `${len.toFixed(2)} s`),
            el('td', {}, meter),
          ),
        );
      }
    }
    out.replaceChildren(table);
  });
  const music = button('Measure music (offline, 20 s each)', async () => {
    await audio.unlock();
    music.disabled = true;
    const rows: [string, { intensity?: number; boss?: boolean; night?: number }][] = [
      ['calm / day', {}],
      ['calm / night', { night: 1 }],
      ['combat', { intensity: 1 }],
      ['combat + boss', { intensity: 1, boss: true }],
    ];
    const table = el('table');
    table.append(el('tr', {}, el('th', {}, 'Music state'), el('th', {}, 'Peak dBFS'), el('th', {}, 'Weighted loudness'), el('th', {}, '')));
    for (const [label, o] of rows) {
      const r = await audio.renderMusicPreview(20, o);
      const listen = button('Listen', () => audio.playBuffer(r.buffer));
      table.append(el('tr', {}, el('td', {}, label), el('td', {}, r.levels.peakDb.toFixed(1)), el('td', {}, r.levels.loudDb.toFixed(1)), el('td', {}, listen)));
    }
    for (const [label, night] of [['ambience / day', 0], ['ambience / night', 1]] as const) {
      const r = await audio.renderAmbiencePreview(20, night);
      const listen = button('Listen', () => audio.playBuffer(r.buffer));
      table.append(el('tr', {}, el('td', {}, label), el('td', {}, r.levels.peakDb.toFixed(1)), el('td', {}, r.levels.loudDb.toFixed(1)), el('td', {}, listen)));
    }
    out.replaceChildren(table);
    music.disabled = false;
  });
  p.append(el('div', { className: 'row' }, analyze, music));
  p.append(el('p', { className: 'note' }, 'SFX are normalised to a perceptually weighted loudness (K-weighting + 70 Hz high-pass, active part only): about -20 dB for one-shots, -24 to -26 for rapid-fire sounds, -31 for hover. Peaks are capped at -1 dBFS before the master limiter.'));
  p.append(out);
}

// ------------------------------------------------------------------ live status

function chip(label: string, value: string, cls = ''): HTMLElement {
  return el('span', { className: `chip ${cls}` }, `${label} `, el('b', {}, value));
}

function refresh(): void {
  const s = audio.getStats();
  statusEl.replaceChildren(
    chip('context', s.state, s.state === 'running' ? 'ok' : 'warn'),
    chip('rate', s.sampleRate ? `${(s.sampleRate / 1000).toFixed(1)} kHz` : '-'),
    chip('sfx', `${s.rendered}/${s.total}${s.renderMs ? ` in ${s.renderMs} ms` : ''}`, s.rendered === s.total ? 'ok' : 'warn'),
    chip('voices', String(s.voices)),
    chip('limiter', `${s.limiterDb.toFixed(1)} dB`, s.limiterDb < -3 ? 'warn' : ''),
  );
  const now = document.getElementById('now');
  if (now) {
    if (s.music) {
      now.replaceChildren(
        'Bar ', el('b', {}, String(s.music.bar + 1)), ' / 8 · chord ', el('b', {}, s.music.chord), ' · ', el('b', {}, `${s.music.bpm} BPM`),
        el('br'), 'Progression: ', el('b', {}, s.music.progression),
      );
    } else now.textContent = 'Not playing.';
  }
}
setInterval(refresh, 250);
refresh();
