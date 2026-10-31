// Shared conversions for every car, regardless of driver or rating.
export const RACE_SPEED_MULTIPLIER = 2;
export const SPEED_UNITS_PER_MPH = 2.25;
export const CAR_MASS_SCALE = 4;
export const ENGINE_FORCE_SCALE = 0.01;

export function carTopSpeed(setup) {
  return (setup?.topSpeed ?? 40) * SPEED_UNITS_PER_MPH * RACE_SPEED_MULTIPLIER;
}

export function parseCarPerformance(text) {
  const clean = text.replace(/\0/g, "").replace(/;[^\r\n]*/g, "");
  const number = (source, key, fallback) => {
    const value = Number(source.match(new RegExp(`^\\s*${key}\\s+([-+\\d.eE]+)`, "im"))?.[1]);
    return Number.isFinite(value) ? value : fallback;
  };
  const body = clean.match(/\bBODY\s*\{([^}]+)\}/i)?.[1] ?? "";
  const vector = (source, key) => source.match(new RegExp(`^\\s*${key}\\s+([^\\r\\n]+)`, "im"))?.[1].trim().split(/[\s,]+/).map(Number);
  const inertia = body.match(/\bInertia\s+([-+\d.eE\s]+)/i)?.[1].trim().split(/\s+/).map(Number);
  return {
    topSpeed: number(clean, "TopSpeed", 40),
    bodyMass: number(body, "Mass", 2),
    centerOfMass: vector(clean, "CoM"),
    inertia: inertia?.length === 9 ? [inertia[0], inertia[4], inertia[8]] : null,
    resistance: number(body, "Resistance", 0.001),
    angularResistance: number(body, "AngRes", 0.001),
    bodyFriction: number(body, "StaticFriction", 0.8),
    engineRate: number(clean, "EngineRate", 4.5),
    steerRate: number(clean, "SteerRate", 3),
    wheels: [...clean.matchAll(/\bWHEEL\s+\d+\s*\{([^}]+)\}/gi)].map(([, block]) => ({
      mass: number(block, "Mass", 0.15),
      radius: number(block, "Radius", 10) * 0.1,
      staticFriction: number(block, "StaticFriction", 1.5),
      kineticFriction: number(block, "KineticFriction", 1.45),
      grip: number(block, "Grip", 0.015),
    })),
  };
}
