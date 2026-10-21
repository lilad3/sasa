"use client";

import { useEffect, useRef } from "react";

import "./fond-nuit.css";

const VERTEX = `
attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// La scène de decor.jpg (scripts/generer-decor.py), traduite telle quelle, mais dont la lumière bouge :
// la traînée orange balaie l'écran et ses bords ondulent, la lueur indigo glisse dans l'autre sens,
// un trait de lumière traverse le verre de temps en temps, et des cannelures s'allument à tour de rôle.
// La position des lumières vient de lightAt() (plus bas) : les vitres s'en servent aussi pour s'éclairer.
const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_rib;
uniform float u_angle;
uniform float u_band;
uniform float u_indigo;
uniform float u_streak;

const vec3 NUIT     = vec3(0.055, 0.047, 0.039);
const vec3 NUIT2    = vec3(0.137, 0.102, 0.075);
const vec3 ORANGE   = vec3(1.000, 0.478, 0.122);
const vec3 OCRE     = vec3(0.949, 0.702, 0.239);
const vec3 CORAIL   = vec3(0.910, 0.333, 0.247);
const vec3 SABLE    = vec3(0.941, 0.867, 0.729);
const vec3 INDIGO   = vec3(0.247, 0.294, 0.788);
const vec3 INDIGO_C = vec3(0.561, 0.608, 1.000);

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){ return 0.65 * noise(p) + 0.35 * noise(p * 2.3 + 7.1); }
float bump(float x, float w){ x /= w; return exp(-x * x); }

vec3 scene(vec2 px, float t){
  vec2 c = (px - 0.5 * u_res) / u_res.y;
  float n = fbm(c * 3.5 + vec2(0.07 * t, -0.05 * t)) - 0.5;
  float d = dot(c, vec2(-sin(u_angle), cos(u_angle))) + 0.12 * n;
  float along = dot(c, vec2(cos(u_angle), sin(u_angle)));

  float b = d - u_band;
  vec3 base = mix(NUIT, NUIT2, clamp(0.55 - 0.5 * length(c), 0.0, 1.0));
  float k = clamp(along * 0.9 + 0.62, 0.0, 1.0);
  vec3 band = mix(mix(OCRE, ORANGE, clamp(k * 1.6, 0.0, 1.0)), CORAIL, clamp(k * 2.0 - 1.1, 0.0, 1.0));
  vec3 col = mix(base, band, exp(-b * b * 11.0) * 0.86);
  col = mix(col, NUIT * 0.6 + NUIT2 * 0.4, bump(b + 0.05, 0.144) * 0.85);
  col += OCRE * bump(b - 0.10, 0.112) * 0.35;

  float b2 = d - u_indigo;
  float side = clamp(0.9 - along, 0.0, 1.0);
  col = mix(col, INDIGO, exp(-b2 * b2 * 12.0) * side * 0.62);
  col += INDIGO_C * bump(b2 - 0.06, 0.105) * 0.12 * side;

  // Le trait de lumière, légèrement penché, que les cannelures découpent en éclats.
  col += mix(OCRE, SABLE, 0.4) * bump(c.x + 0.3 * c.y - u_streak, 0.05) * 0.32;
  return col;
}

void main(){
  vec2 fc = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  float f = fract(fc.x / u_rib);
  float ri = floor(fc.x / u_rib);
  vec3 col = scene(vec2(fc.x + (f - 0.5) * u_rib * 1.5, fc.y), u_time);

  float rnd = hash(vec2(ri, 7.0));
  col *= 1.0 - 0.16 * f;
  col += (bump(f, 0.012) * 0.10 + bump(f - 1.0, 0.02) * 0.05) * (0.5 + rnd);
  float glint = step(0.7, rnd) * pow(0.5 + 0.5 * sin(0.9 * u_time + rnd * 40.0), 3.0);
  col += mix(ORANGE, INDIGO, step(0.5, hash(vec2(ri, 3.0)))) * bump(f - 0.5, 0.083) * glint * 0.28;

  vec2 uv = fc / u_res;
  col = mix(col, NUIT, pow(clamp((uv.y - 0.72) / 0.28, 0.0, 1.0), 1.4) * 0.85);
  col *= clamp(1.15 - 0.55 * length(vec2((uv.x - 0.5) * 1.3, uv.y - 0.45)), 0.0, 1.0);
  col += (hash(fc) - 0.5) * 0.05;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

// 30 images par seconde suffisent pour le décor ; les bords des vitres suivent à 15, moins coûteux pour la page.
const FRAME_MS = 1000 / 30;
const EDGE_MS = 1000 / 15;

// Le trait de lumière traverse l'écran en 6 s, toutes les 14 s.
const STREAK_PERIOD = 14;
const STREAK_TRAVEL = 6;

const smoothstep = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/**
 * Où sont les lumières à l'instant t, en unités de hauteur d'écran depuis le centre.
 * À t = 0, la scène est celle de decor.jpg : le passage de l'image fixe au décor vivant ne se voit pas.
 */
function lightAt(t: number) {
  return {
    angle: 0.9 + 0.1 * Math.sin(0.07 * t),
    band: 0.02 + 0.28 * Math.sin(0.1 * t) + 0.05 * Math.sin(0.23 * t),
    indigo: -0.55 + 0.16 * Math.sin(0.08 * t),
    streak: -1.4 + 2.8 * smoothstep((t % STREAK_PERIOD) / STREAK_TRAVEL),
  };
}

/**
 * Les mêmes lumières, en dégradés CSS fixés à l'écran, pour le bord des vitres (utilitaire `vitre`, globals.css).
 * Un dégradé linéaire d'angle θ a pour direction (sin θ, −cos θ) : la normale de la traînée, (−sin a, cos a),
 * correspond à θ = a + π. Sa ligne mesure |W sin θ| + |H cos θ| et passe par le centre de l'écran.
 */
function edgeGradients(light: ReturnType<typeof lightAt>, W: number, H: number) {
  const stripe = (theta: number, at: number, color: string, before: number, after: number) => {
    const middle = (Math.abs(W * Math.sin(theta)) + Math.abs(H * Math.cos(theta))) / 2;
    const p = middle + at;
    return `linear-gradient(${theta.toFixed(4)}rad, transparent ${(p - before).toFixed(1)}px, ${color} ${p.toFixed(1)}px, transparent ${(p + after).toFixed(1)}px)`;
  };
  const theta = light.angle + Math.PI;
  // Le trait suit la droite x + 0,3 y = s : sa normale (1 ; 0,3) donne θ = atan2(1, −0,3).
  const streakTheta = Math.atan2(1, -0.3);
  return [
    stripe(theta, (light.band + 0.1) * H, "rgb(255 196 122 / 0.95)", 260, 150),
    stripe(theta, (light.indigo + 0.06) * H, "rgb(163 171 255 / 0.6)", 160, 160),
    stripe(streakTheta, (light.streak * H) / Math.hypot(1, 0.3), "rgb(255 232 196 / 0.9)", 70, 70),
  ].join(", ");
}

/**
 * Décor animé de l'espace marchand. À placer dans un conteneur `relative isolate`, comme FondOrange :
 * sans ce contexte d'empilement, le fond du <body> se peindrait par-dessus.
 * Le dessin se fait hors de React (requestAnimationFrame) : un état React relancerait un rendu à chaque image.
 */
export function FondNuit() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, powerPreference: "low-power" });
    const program = gl ? buildProgram(gl) : null;
    if (!gl || !program) return;

    // Le décor est doux et passe sous des vitres floutées : il se calcule en basse définition, puis s'étire.
    let scale = 1;
    const layout = () => {
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      scale = Math.min(window.devicePixelRatio || 1, 1) * (W < 700 ? 0.5 : 0.75);
      const w = Math.max(1, Math.round(W * scale));
      const h = Math.max(1, Math.round(H * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    // Le temps n'avance que pendant que la page est affichée : au retour sur l'onglet, la lumière reprend où elle était.
    let time = 0;
    const render = () => {
      const u = program.uniforms;
      const light = lightAt(time);
      gl.uniform2f(u.u_res, canvas.width, canvas.height);
      gl.uniform1f(u.u_time, time);
      gl.uniform1f(u.u_rib, Math.max(96, (160 * canvas.clientWidth) / 1920) * scale);
      gl.uniform1f(u.u_angle, light.angle);
      gl.uniform1f(u.u_band, light.band);
      gl.uniform1f(u.u_indigo, light.indigo);
      gl.uniform1f(u.u_streak, light.streak);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return light;
    };

    const root = document.documentElement;
    let raf = 0;
    let previous = performance.now();
    let lastDraw = -Infinity;
    let lastEdge = -Infinity;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      time += Math.min(now - previous, 100) / 1000;
      previous = now;
      if (now - lastDraw < FRAME_MS) return;
      lastDraw = now;
      const light = render();
      canvas.dataset.vivant = "";
      if (now - lastEdge >= EDGE_MS) {
        lastEdge = now;
        root.style.setProperty("--lumiere", edgeGradients(light, canvas.clientWidth, canvas.clientHeight));
      }
    };

    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        layout();
        render();
      }, 100);
    };
    // Contexte perdu (pilote graphique, veille) : on rend la main à l'image fixe, et les vitres s'éteignent.
    const onContextLost = () => {
      cancelAnimationFrame(raf);
      delete canvas.dataset.vivant;
      root.style.removeProperty("--lumiere");
    };

    layout();
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", onResize);
    canvas.addEventListener("webglcontextlost", onContextLost);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      root.style.removeProperty("--lumiere");
      // Pas de loseContext() : en développement, React monte l'effet deux fois sur le même canvas.
    };
  }, []);

  return (
    <div aria-hidden className="fond-nuit">
      <canvas ref={canvasRef} className="fond-nuit-canvas" />
      <div className="fond-nuit-voile" />
    </div>
  );
}

type Uniform = "u_res" | "u_time" | "u_rib" | "u_angle" | "u_band" | "u_indigo" | "u_streak";
type Program = { uniforms: Record<Uniform, WebGLUniformLocation | null> };

function buildProgram(gl: WebGLRenderingContext): Program | null {
  try {
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("shader");
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link");
    gl.useProgram(program);

    // Un seul triangle qui couvre tout l'écran : le fragment shader fait le reste.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const names: Uniform[] = ["u_res", "u_time", "u_rib", "u_angle", "u_band", "u_indigo", "u_streak"];
    const uniforms = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)])) as Program["uniforms"];
    return { uniforms };
  } catch {
    return null;
  }
}
