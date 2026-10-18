import './ui/style.css';
import { Game } from './game';

const game = new Game(document.getElementById('stage')!, document.getElementById('ui')!);
game.start();
(window as unknown as { game: Game }).game = game;
