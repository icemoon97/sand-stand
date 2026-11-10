// All tunables live here so balance passes touch one file.
export const CFG = {
  world: {
    W: 64, // metres across (x, periodic for the water)
    H: 36, // metres visible top (sea) to bottom (dry sand)
  },

  sim: {
    NX: 256, // cells across
    NYV: 144, // visible rows
    PAD: 40, // extra offshore rows above the view where waves are generated
    dt: 1 / 120, // fixed step; two per 60 Hz game tick
    g: 9.81,
    friction: 0.012, // quadratic bed friction coefficient
    eps: 1e-3, // a face with less water than this is dry
    infiltration: 0.004, // m/s soaked up by the beach above the still-water line
    foamThresh: 0.8, // flow convergence (1/s) above which a wave is "breaking"
    foamGain: 1.6,
    foamTauWet: 2.4, // s, foam fade on water
    foamTauDry: 2.0, // s, foam fade once stranded on sand
    wetTau: 16, // s for wet sand to dry out
  },

  beach: {
    shoreY: 13, // view-y of the still-water line (before cusps)
    depth: 2.0, // offshore depth (m)
    seaSlope: 0.14,
    slope1: 0.04, // beach face: z = slope1*t + slope2*t^2 (t = metres up the beach)
    slope2: 0.001,
    cusp1: 1.6, // alongshore undulation of the shoreline (m), 2 per width
    cusp2: 0.6, // ... and 5 per width
    bump: 0.035, // small-scale sand relief (m)
  },

  waves: {
    firstAt: 1.5, // s
    baseAmp: 0.7, // m at the offshore boundary
    sneakerChance: 0.08,
    sneakerBoost: 1.55,
    periodMin: 2.0, // pulse duration (s)
    periodMax: 3.0,
    gapMin: 5.0, // s between wave starts
    gapMax: 8.5,
    lull: 3.0, // extra pause between sets
    maxDelay: 1.3, // s, how much a wave front can bend along the shore
  },

  game: {
    tick: 1 / 60,
    roundTime: 90,
    countdown: 3,
    playerRadius: 0.7,
    speed: 6.2, // m/s on sand
    waterSlow: 0.5, // speed multiplier while wading
    accel: 16, // 1/s velocity response
    touchDepth: 0.01, // m of water at your feet that counts as touched
    touchRim: 0.80, // fraction of the player radius the water must reach (1 = very edge)
    soakTime: 2.5, // s unable to score after getting wet
    baseRate: 10, // points/s at x1
    zSafe: 0.95, // bed height above which standing earns nothing
    depthMax: 10, // multiplier at the still-water line
    depthCap: 1.2, // how far past the still-water line the multiplier keeps growing
    holdGrace: 0.6, // s standing before the hold timer starts
    holdGain: 0.4, // hold multiplier = 1 + holdGain * seconds
    holdMax: 10, // s at which the hold multiplier stops growing
  },
};
