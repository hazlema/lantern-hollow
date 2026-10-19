import './ui/style.css';
import { Game } from './game';
import { isTouch } from './ui/device';

document.body.classList.toggle('touch', isTouch);

const game = new Game(document.getElementById('stage')!, document.getElementById('ui')!);
game.start();
(window as unknown as { game: Game }).game = game;

// phones held upright: ask nicely for landscape
document.body.append(Object.assign(document.createElement('div'), {
  className: 'turn-phone',
  innerHTML: '<div><b>Turn your phone sideways</b><span>Lantern Hollow plays in landscape.</span></div>',
}));
