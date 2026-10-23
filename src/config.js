// Road cross-section (meters, measured from the center line, + is the right side)
export const ROAD = {
  laneCenter: 1.85,
  edgeLine: 3.6,
  asphalt: 4.25,
  half: 5.4, // road mesh incl. gravel shoulder
  rail: 5.0, // guardrail face
  post: 5.14,
  signD: 6.3,
};

export const PLAYER = {
  maxSpeed: 44.5, // m/s (~160 km/h)
  length: 4.1,
  width: 1.78,
};

export const KMH = 3.6;

export const WORLD = {
  seed: 20261022,
  terrainSize: 6000,
  terrainSegments: 420,
  fogDensity: 0.00105,
};

// sun: low golden-hour sun
const sunEl = (13 * Math.PI) / 180;
const sunAz = (-35 * Math.PI) / 180;
export const SUN_DIR = [Math.cos(sunEl) * Math.cos(sunAz), Math.sin(sunEl), Math.cos(sunEl) * Math.sin(sunAz)];

// all colors in sRGB hex
export const COLORS = {
  fog: '#e2b98d',
  fogSun: '#ffc27a',
  skyZenith: '#3d6fb5',
  skyMid: '#8cb3d9',
  sun: '#ffd9a0',
};
