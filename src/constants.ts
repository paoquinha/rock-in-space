export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;

export const INITIAL_PLAYER_RADIUS = 30;
export const FRICTION = 0.96;
export const THRUST = 0.2; // Increased from 0.16 to reach speed 7 faster
export const MAX_SPEED = 7.0; // Increased to 7.0 as requested

export const ROCK_COLORS = [
  '#8B8C89', // Stone Gray
  '#A5A5A5', // Silver
  '#696969', // Dim Gray
  '#4B4B4B', // Dark Gray
  '#708090', // Slate Gray
];

export const PARTICLE_COUNT = 10;
export const SPAWN_RATE = 15; // Rocks per second
export const MAX_ROCKS = 150; // Increased to 150 to accommodate higher spawn rate

export const COMET_START_RADIUS = 50;
export const ASTEROID_START_RADIUS = 70;
export const SATELLITE_START_RADIUS = 100;
export const DWARF_PLANET_START_RADIUS = 120;
