// WebGL2 renderer: one full-screen pass that turns the simulation fields
// (depth, foam, wet sand, surface height) into a top-down beach.

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uState;   // r: bed height, g: foam, b: wet sand, a: water surface (extended into dry sand)
uniform vec2 uGrid;         // cells across, cells down (including offshore pad)
uniform float uPad;         // offshore rows hidden above the view
uniform vec2 uView;         // metres visible
uniform float uTime;
in vec2 vUv;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec2 hash2(vec2 p) {
  float n = hash(p);
  return vec2(n, hash(p + n + 17.1));
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s;
}
// distance to nearest feature point, animated
float worley(vec2 p, float t) {
  vec2 i = floor(p), f = fract(p);
  float d = 1.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = hash2(i + g);
    o = 0.5 + 0.4 * sin(t + 6.2831 * o);
    vec2 r = g + o - f;
    d = min(d, dot(r, r));
  }
  return sqrt(d);
}

// Bicubic B-spline lookup in four bilinear taps: keeps the shoreline smooth
// even though the grid is far coarser than the screen.
vec4 bicubic(vec2 uv) {
  vec2 st = uv * uGrid - 0.5;
  vec2 i = floor(st), f = fract(st);
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 p0 = (i + w1 / g0 - 0.5) / uGrid;
  vec2 p1 = (i + w3 / g1 + 1.5) / uGrid;
  return g0.y * (g0.x * texture(uState, p0) + g1.x * texture(uState, vec2(p1.x, p0.y)))
       + g1.y * (g0.x * texture(uState, vec2(p0.x, p1.y)) + g1.x * texture(uState, p1));
}

float caustics(vec2 p, float t) {
  float a = worley(p * 0.9 + vec2(t * 0.05, 0.0), t * 0.9);
  float b = worley(p * 1.4 - vec2(0.0, t * 0.04) + 5.2, t * 1.1 + 2.0);
  float c = a * b;
  return smoothstep(0.12, 0.55, c);
}

void main() {
  vec2 wp = vUv * uView;
  vec2 tuv = vec2(vUv.x, (uPad + vUv.y * (uGrid.y - uPad)) / uGrid.y);
  vec2 px = 1.0 / uGrid;
  vec4 s = bicubic(tuv);
  float z = s.r, eta = s.a, h = max(eta - z, 0.0);
  float foam = clamp(s.g, 0.0, 1.0), wet = clamp(s.b, 0.0, 1.0);
  float cellM = uView.x / uGrid.x;
  vec2 grad = vec2(bicubic(tuv + vec2(px.x, 0.0)).a - bicubic(tuv - vec2(px.x, 0.0)).a,
                   bicubic(tuv + vec2(0.0, px.y)).a - bicubic(tuv - vec2(0.0, px.y)).a) / (2.0 * cellM);

  // ---- sand
  float grain = hash(floor(wp * 42.0));
  float fine = vnoise(wp * 9.0);
  float blotch = fbm(wp * 0.35 + 3.0);
  vec3 dry = mix(vec3(0.925, 0.835, 0.660), vec3(0.975, 0.905, 0.745), blotch);
  dry *= 0.955 + 0.05 * fine + 0.045 * grain;
  // wind ripples high on the beach
  float rip = sin(wp.y * 5.5 + 2.5 * fbm(wp * 0.6) * 6.0 + wp.x * 0.7);
  dry *= 1.0 + 0.012 * rip * smoothstep(0.6, 1.0, z);
  // lower beach is a touch darker and cooler even when dry
  dry *= mix(vec3(0.93, 0.92, 0.90), vec3(1.0), smoothstep(-0.1, 0.7, z));
  float w = wet * wet * (3.0 - 2.0 * wet);
  vec3 wetCol = dry * vec3(0.78, 0.72, 0.645);
  vec3 sand = mix(dry, wetCol, w);
  // wet sand mirrors the sky; strongest just after the water leaves
  float sheen = w * smoothstep(0.45, 1.0, wet);
  sand += sheen * vec3(0.11, 0.16, 0.19) * (0.55 + 0.45 * vnoise(wp * 1.3 + uTime * 0.05));

  // ---- water
  float cover = smoothstep(0.004, 0.022, h);
  vec2 rp = wp * 1.7;
  float t = uTime;
  // small wind ripples riding on the simulated surface
  vec2 ripple = vec2(0.0);
  float warp = fbm(wp * 0.45 + vec2(0.0, t * 0.08)) * 5.0;
  for (int k = 0; k < 5; k++) {
    float fk = float(k);
    float ang = 1.3 + fk * 1.15 + 0.4 * sin(fk * 3.7);
    vec2 dir = vec2(cos(ang), sin(ang));
    float freq = 2.2 + fk * 1.35;
    ripple += dir * cos(dot(rp, dir) * freq + t * (1.1 + 0.45 * fk) + warp * (1.0 + 0.3 * fk)) / (1.6 + fk);
  }
  ripple *= 0.3;
  float deepness = smoothstep(0.03, 0.6, h);
  vec3 n = normalize(vec3(-grad * 7.0 - ripple * (0.15 + 0.4 * deepness), 1.0));
  vec3 L = normalize(vec3(-0.38, -0.62, 0.68));
  float diff = dot(n, L) / L.z;

  vec3 bed = wetCol * (0.96 + 0.04 * fine);
  float ca = caustics(wp, t) * smoothstep(0.03, 0.25, h) * exp(-h * 1.1);
  bed += ca * vec3(0.20, 0.19, 0.14);
  vec3 absorb = exp(-h * vec3(4.2, 1.25, 0.85));
  vec3 scatter = mix(vec3(0.16, 0.70, 0.69), vec3(0.03, 0.40, 0.56), smoothstep(0.3, 2.2, h));
  vec3 water = bed * absorb + scatter * (1.0 - absorb);
  // a film of water mirrors the sky just like wet sand does
  water += vec3(0.10, 0.15, 0.18) * (0.55 + 0.45 * vnoise(wp * 1.3 + uTime * 0.05)) * (1.0 - 0.6 * deepness);
  // crests are thicker water lit from behind: lighter and greener
  water += vec3(0.05, 0.16, 0.13) * smoothstep(0.05, 0.7, eta) * deepness;
  water *= 0.56 + 0.44 * clamp(diff, 0.0, 1.7);
  // sky reflection grows with surface tilt
  float tilt = 1.0 - n.z;
  water = mix(water, vec3(0.80, 0.91, 0.96), clamp(tilt * 1.6, 0.0, 0.35) * deepness);
  // sun glitter
  vec3 hv = normalize(L + vec3(0.0, 0.0, 1.0));
  float sparkle = smoothstep(0.45, 0.8, vnoise(wp * 2.3 + vec2(t * 0.35, -t * 0.2)));
  float spec = pow(max(dot(n, hv), 0.0), 320.0);
  water += vec3(1.0, 0.97, 0.88) * spec * (0.25 + 0.75 * sparkle) * 0.8 * cover;

  vec3 col = mix(sand, water, cover);
  // thin dark line where water meets sand, then a bright meniscus
  float hs = eta - z;
  float lip = smoothstep(-0.012, 0.004, hs) * (1.0 - smoothstep(0.004, 0.02, hs));
  col *= 1.0 - 0.10 * lip;
  float rim = smoothstep(0.008, 0.02, h) * (1.0 - smoothstep(0.02, 0.06, h));
  col += rim * 0.10;

  // ---- foam: density from the sim, lace pattern from cellular noise
  float c1 = worley(wp * 1.25 + vec2(0.0, t * 0.05), t * 0.5);
  float c2 = worley(wp * 3.1 + 7.0, t * 0.8);
  float lace = 0.62 * c1 + 0.38 * c2;      // high along cell borders
  float fd = foam * (cover * 0.85 + 0.15) + rim * 0.25 * smoothstep(0.0, 0.3, foam + 0.15);
  float edge = 1.02 - fd * 1.25;
  float fo = smoothstep(edge, edge + 0.22, lace + 0.25 * fbm(wp * 5.0));
  fo = max(fo, smoothstep(0.75, 1.0, fd));
  float stranded = 1.0 - cover;
  fo *= mix(1.0, 0.55, stranded);
  vec3 foamCol = vec3(1.0, 0.995, 0.98) * (0.90 + 0.10 * c2) * (0.86 + 0.14 * clamp(diff, 0.0, 1.3));
  // soft shadow under thick foam
  col *= 1.0 - 0.10 * smoothstep(0.1, 0.6, fd) * (1.0 - fo);
  col = mix(col, foamCol, fo);

  // ---- grade
  vec2 q = vUv - 0.5;
  col *= 1.0 - 0.22 * dot(q, q);
  col = mix(col, col * vec3(1.03, 1.0, 0.95), 0.6);
  col = pow(col, vec3(0.96));
  outColor = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

export class Renderer {
  constructor(canvas, sim, view) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('This game needs WebGL2.');
    this.gl = gl;
    this.canvas = canvas;
    this.sim = sim;
    gl.getExtension('EXT_color_buffer_float');
    this.linearFloat = !!gl.getExtension('OES_texture_float_linear');

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.prog = prog;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    // half-float is linearly filterable everywhere in WebGL2
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, sim.NX, sim.NY, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.uniform1i(gl.getUniformLocation(prog, 'uState'), 0);
    gl.uniform2f(gl.getUniformLocation(prog, 'uGrid'), sim.NX, sim.NY);
    gl.uniform1f(gl.getUniformLocation(prog, 'uPad'), sim.PAD);
    gl.uniform2f(gl.getUniformLocation(prog, 'uView'), view.W, view.H);
    this.uTime = gl.getUniformLocation(prog, 'uTime');
  }

  draw(time) {
    const gl = this.gl, sim = this.sim;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sim.NX, sim.NY, gl.RGBA, gl.FLOAT, sim.tex);
    gl.uniform1f(this.uTime, time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
