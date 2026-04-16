export interface Vector {
  x: number;
  y: number;
}

export interface Rock {
  id: string;
  position: Vector;
  velocity: Vector;
  radius: number;
  mass: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
  vertices: Vector[];
  isComet?: boolean;
  isAsteroid?: boolean;
  isSatellite?: boolean;
  isDwarfPlanet?: boolean;
}

export interface Particle {
  id: string;
  position: Vector;
  velocity: Vector;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface Moon extends Rock {
  orbitRadius: number;
  orbitAngle: number;
  orbitSpeed: number;
}

export type GameState = 'START' | 'NAME_ENTRY' | 'PLAYING' | 'GAMEOVER' | 'COLOR_SELECTION';

export interface LeaderboardEntry {
  name: string;
  score: number;
  date: string;
}
