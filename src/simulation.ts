export type Vec3 = { x: number; y: number; z: number };

export type PipeState = 'growing' | 'dying' | 'stuck';

const DIRECTIONS: readonly Vec3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

class OccupancyGrid {
  private occupied: Uint8Array;
  private occupiedCount = 0;
  readonly size: number;
  private readonly size2: number;

  constructor(size: number) {
    this.size = size;
    this.size2 = size * size;
    this.occupied = new Uint8Array(size * size * size);
  }

  isInside(cell: Vec3): boolean {
    return (
      cell.x >= 0 &&
      cell.y >= 0 &&
      cell.z >= 0 &&
      cell.x < this.size &&
      cell.y < this.size &&
      cell.z < this.size
    );
  }

  private index(cell: Vec3): number {
    return cell.x + cell.y * this.size + cell.z * this.size2;
  }

  isFree(cell: Vec3): boolean {
    if (!this.isInside(cell)) return false;
    return this.occupied[this.index(cell)] === 0;
  }

  occupy(cell: Vec3): void {
    const idx = this.index(cell);
    if (this.occupied[idx] !== 0) return;
    this.occupied[idx] = 1;
    this.occupiedCount++;
  }

  release(cell: Vec3): void {
    const idx = this.index(cell);
    if (this.occupied[idx] === 0) return;
    this.occupied[idx] = 0;
    this.occupiedCount--;
  }

  randomFreeCell(rng: () => number): Vec3 | undefined {
    const total = this.occupied.length;
    if (this.occupiedCount >= total) return undefined;

    // A few random probes; fall back to a linear search to guarantee a result.
    for (let i = 0; i < 32; i++) {
      const x = Math.floor(rng() * this.size);
      const y = Math.floor(rng() * this.size);
      const z = Math.floor(rng() * this.size);
      const idx = x + y * this.size + z * this.size2;
      if (this.occupied[idx] === 0) return { x, y, z };
    }

    for (let idx = 0; idx < total; idx++) {
      if (this.occupied[idx] !== 0) continue;
      const z = Math.floor(idx / this.size2);
      const rem = idx - z * this.size2;
      const y = Math.floor(rem / this.size);
      const x = rem - y * this.size;
      return { x, y, z };
    }
    return undefined;
  }
}

export interface SimulationConfig {
  gridSize: number;
  maxPipeLength: number; // 0 means infinite
  targetPipeCount: number;
  growthInterval: number; // seconds between logical growth ticks
  turnProbability: number; // 0..1 chance to turn instead of going straight when possible
  disableTailShrink: boolean;
}

export class Pipe {
  state: PipeState = 'growing';
  readonly cells: Vec3[];
  prevHead: Vec3;
  lastDir?: Vec3;
  headLerp = 1; // 0..1 progress from prevHead -> head for rendering
  version = 0;
  readonly id: number;
  readonly colorSeed: number;
  readonly birthIndex: number;

  constructor(id: number, start: Vec3, colorSeed: number, birthIndex: number) {
    this.id = id;
    this.cells = [start];
    this.prevHead = { ...start };
    this.colorSeed = colorSeed;
    this.birthIndex = birthIndex;
  }

  get head(): Vec3 {
    return this.cells[this.cells.length - 1];
  }
}

export class Simulation {
  private grid: OccupancyGrid;
  private rng: () => number;
  private accumulator = 0;
  private nextId = 1;
  private nextBirthIndex = 1;
  config: SimulationConfig;
  pipes: Pipe[] = [];

  constructor(config: SimulationConfig, rng: () => number = Math.random) {
    this.config = { ...config };
    this.grid = new OccupancyGrid(this.config.gridSize);
    this.rng = rng;
  }

  reset(config?: Partial<SimulationConfig>): void {
    this.config = { ...this.config, ...config };
    this.grid = new OccupancyGrid(this.config.gridSize);
    this.pipes = [];
    this.accumulator = 0;
    this.nextId = 1;
    this.nextBirthIndex = 1;
  }

  update(dt: number): boolean {
    const { growthInterval, targetPipeCount } = this.config;
    this.accumulator += dt;

    // advance head interpolation for smooth visible motion
    const headEase = Math.max(0.001, growthInterval);
    for (const pipe of this.pipes) {
      pipe.headLerp = Math.min(1, pipe.headLerp + dt / headEase);
    }

    let allStuck = false;
    while (this.accumulator >= growthInterval) {
      allStuck = this.step();
      this.accumulator -= growthInterval;
    }

    this.capIfNeeded();
    this.trySpawnUntil(targetPipeCount);
    return allStuck;
  }

  private step(): boolean {
    const { maxPipeLength, disableTailShrink } = this.config;
    let stuckCount = 0;
    let activeCount = 0;

    for (let i = this.pipes.length - 1; i >= 0; i--) {
      const pipe = this.pipes[i];

      if (pipe.state === 'growing') {
        const nextCell = this.pickNextCell(pipe);
        if (nextCell) {
          pipe.prevHead = { ...pipe.head };
          pipe.cells.push(nextCell);
          pipe.lastDir = {
            x: nextCell.x - pipe.prevHead.x,
            y: nextCell.y - pipe.prevHead.y,
            z: nextCell.z - pipe.prevHead.z,
          };
          pipe.headLerp = 0;
          pipe.version++;
          this.grid.occupy(nextCell);

          if (!disableTailShrink && maxPipeLength > 0 && pipe.cells.length > maxPipeLength) {
            const tail = pipe.cells.shift();
            if (tail) {
              this.grid.release(tail);
              pipe.version++;
            }
          }
        } else {
          if (disableTailShrink) {
            pipe.state = 'stuck';
            stuckCount++;
            activeCount++;
          } else {
            pipe.state = 'dying';
          }
        }
      } else if (pipe.state === 'dying') {
        const tail = pipe.cells.shift();
        if (tail) {
          this.grid.release(tail);
          pipe.version++;
        }
        if (pipe.cells.length === 0) {
          this.pipes.splice(i, 1);
        }
      } else if (pipe.state === 'stuck') {
        stuckCount++;
        activeCount++;
      }
    }

    // pipes that are still growable (not dying) and not stuck
    for (const p of this.pipes) {
      if (p.state === 'growing') activeCount++;
    }
    return disableTailShrink && activeCount > 0 && stuckCount === activeCount;
  }

  private pickNextCell(pipe: Pipe): Vec3 | undefined {
    const head = pipe.head;
    const options: Vec3[] = [];
    let straight: Vec3 | undefined;
    for (const dir of DIRECTIONS) {
      const candidate = add(head, dir);
      if (this.grid.isFree(candidate)) {
        options.push(candidate);
        if (pipe.lastDir && isSame(dir, pipe.lastDir)) {
          straight = candidate;
        }
      }
    }
    if (options.length === 0) return undefined;

    if (straight && options.length > 1) {
      const turnProb = clamp01(this.config.turnProbability);
      const shouldGoStraight = this.rng() > turnProb;
      if (shouldGoStraight) return straight;

      const pick = Math.floor(this.rng() * (options.length - 1));
      let k = 0;
      for (const option of options) {
        if (isSame(option, straight)) continue;
        if (k === pick) return option;
        k++;
      }
    }

    const idx = Math.floor(this.rng() * options.length);
    return options[idx];
  }

  private trySpawnUntil(target: number): void {
    while (this.pipes.length < target) {
      const spawnCell = this.grid.randomFreeCell(this.rng);
      if (!spawnCell) break;
      this.spawnPipe(spawnCell);
    }
  }

  private capIfNeeded(): void {
    const { targetPipeCount } = this.config;
    if (this.pipes.length <= targetPipeCount) return;

    for (let i = targetPipeCount; i < this.pipes.length; i++) {
      this.pipes[i].state = 'dying';
    }
  }

  private spawnPipe(cell: Vec3): void {
    const pipe = new Pipe(this.nextId++, cell, this.rng(), this.nextBirthIndex++);
    this.grid.occupy(cell);
    this.pipes.push(pipe);
  }
}

function isSame(a: Vec3, b: Vec3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
