// The island of Lantern Hollow, drawn as ASCII. One char per tile.
//   ' ' void (off-island)   '.' grass (buildable)   '#' dirt road
//   'T' tree   'r' rock   'p' pumpkin patch   'w' pond
//   'C' crypt (zombie spawn)   'H' cottage (what you defend)   'l' lamp post
const ROWS = [
  '  TTT.TT..TTT.TT    ',
  'CC....T.l...r...TT  ',
  'CC######.........T. ',
  'CC.....#..l.....l..T',
  ' T.....#...#####....',
  ' .l....#...#...#...T',
  ' T.#####...#...#..r.',
  'TT.#.......#...#....',
  'T..#.......#...#lHHH',
  'T..#.......#...##HHH',
  ' ..#########...p.HHH',
  ' Tl........rl.ww.pp ',
  '  TT..T.TT...www.T  ',
  '    TTT..TTT.TT     ',
];

export type TileKind =
  | 'void' | 'grass' | 'path' | 'tree' | 'rock' | 'pumpkin' | 'water' | 'crypt' | 'house' | 'lamp';

const CHAR_KIND: Record<string, TileKind> = {
  ' ': 'void', '.': 'grass', '#': 'path', T: 'tree', r: 'rock',
  p: 'pumpkin', w: 'water', C: 'crypt', H: 'house', l: 'lamp',
};

export interface GridPoint { c: number; r: number }

/** Road corners in grid coords, from the crypt door to the cottage door. */
const WAYPOINTS: GridPoint[] = [
  { c: 1, r: 2 }, { c: 7, r: 2 }, { c: 7, r: 6 }, { c: 3, r: 6 }, { c: 3, r: 10 },
  { c: 11, r: 10 }, { c: 11, r: 4 }, { c: 15, r: 4 }, { c: 15, r: 9 }, { c: 17.2, r: 9 },
];

export class GameMap {
  readonly cols: number;
  readonly rows: number;
  readonly tiles: TileKind[][];
  readonly waypoints: GridPoint[];

  constructor(rows: string[] = ROWS, waypoints: GridPoint[] = WAYPOINTS) {
    this.rows = rows.length;
    this.cols = rows[0].length;
    this.tiles = rows.map((line, r) => {
      if (line.length !== this.cols) throw new Error(`map row ${r} has ${line.length} cols, expected ${this.cols}`);
      return [...line].map((ch) => {
        const k = CHAR_KIND[ch];
        if (!k) throw new Error(`unknown map char '${ch}' at row ${r}`);
        return k;
      });
    });
    this.waypoints = waypoints;
  }

  inBounds(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }

  kind(c: number, r: number): TileKind {
    return this.inBounds(c, r) ? this.tiles[r][c] : 'void';
  }

  isBuildable(c: number, r: number): boolean {
    return this.kind(c, r) === 'grass';
  }

  /** Tile centre in world space (x, z). The island is centred on the origin. */
  toWorld(c: number, r: number): { x: number; z: number } {
    return { x: c - this.cols / 2 + 0.5, z: r - this.rows / 2 + 0.5 };
  }

  /** World (x, z) to the tile containing it. */
  toGrid(x: number, z: number): GridPoint {
    return { c: Math.floor(x + this.cols / 2), r: Math.floor(z + this.rows / 2) };
  }

  forEach(fn: (c: number, r: number, k: TileKind) => void): void {
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) fn(c, r, this.tiles[r][c]);
  }

  /** Every grid tile the road passes through, so tests can check the ASCII agrees with the waypoints. */
  pathTiles(): GridPoint[] {
    const out: GridPoint[] = [];
    for (let i = 0; i < this.waypoints.length - 1; i++) {
      const a = this.waypoints[i], b = this.waypoints[i + 1];
      const steps = Math.round(Math.max(Math.abs(b.c - a.c), Math.abs(b.r - a.r)));
      for (let s = 0; s <= steps; s++) {
        const t = steps === 0 ? 0 : s / steps;
        out.push({ c: Math.round(a.c + (b.c - a.c) * t), r: Math.round(a.r + (b.r - a.r) * t) });
      }
    }
    return out;
  }
}
