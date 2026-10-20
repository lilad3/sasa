"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/cn";

import "./intro.css";

// Noms des classes de intro.css. Les CSS Modules ne passent pas par la configuration Tailwind du projet
// (next.config.ts envoie tous les *.css au chargeur Tailwind) : ce fichier est donc global, et préfixé.
const styles = {
  canvas: "intro-canvas",
  fallback: "intro-fallback",
  final: "intro-final",
  finalMeaning: "intro-final-meaning",
  finalSub: "intro-final-sub",
  finalWord: "intro-final-word",
  gl: "intro-gl",
  hideSm: "intro-hide-sm",
  hint: "intro-hint",
  nav: "intro-nav",
  navInner: "intro-nav-inner",
  navLink: "intro-nav-link",
  noGl: "intro-no-gl",
  onLight: "intro-on-light",
  phrase: "intro-phrase",
  phrases: "intro-phrases",
  progress: "intro-progress",
  reduced: "intro-reduced",
  stage: "intro-stage",
  story: "intro-story",
  thin: "intro-thin",
};

const PHRASES: [string, string][] = [
  ["Vendez", "plus loin."],
  ["Vendez", "sans fermer."],
  ["Vendez", "en FCFA."],
  ["Suivez", "chaque franc."],
];

// Fenêtres d'apparition des phrases sur la progression (0 → 1) : [début entrée, fin entrée, début sortie, fin sortie].
const WINDOWS = [
  [-1, -0.5, 0.11, 0.17],
  [0.17, 0.22, 0.3, 0.35],
  [0.35, 0.4, 0.48, 0.53],
  [0.53, 0.58, 0.65, 0.7],
];

const VERTEX = `
attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// Le décor : nuit chaude, traînée orange bordée d'ocre, lueur indigo, vu à travers un verre cannelé.
// En fin de défilement, l'orange envahit la scène (plus de blanc) et le mot AKWABA apparaît en encre.
// La scène ne se fige jamais : la traînée brune oscille et le champ orange ondule tant que la page est visible.
const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_p;
uniform float u_dpr;
uniform sampler2D u_text;
uniform vec4 u_rect;
uniform float u_hasText;

const vec3 NUIT   = vec3(0.055, 0.047, 0.039);
const vec3 NUIT2  = vec3(0.110, 0.090, 0.075);
const vec3 ORANGE = vec3(1.000, 0.478, 0.122);
const vec3 OCRE   = vec3(0.949, 0.702, 0.239);
const vec3 INDIGO = vec3(0.290, 0.341, 0.839);
const vec3 SABLE  = vec3(0.941, 0.867, 0.729);
// Phase claire, mesurée sur la référence : cuivre, abricot, pêche, et la traînée brune.
const vec3 CUIVRE  = vec3(0.690, 0.412, 0.208);
const vec3 ABRICOT = vec3(0.918, 0.604, 0.357);
const vec3 PECHE   = vec3(0.961, 0.753, 0.549);
const vec3 BRUN    = vec3(0.439, 0.267, 0.125);
const vec3 ENCRE  = vec3(0.090, 0.067, 0.039);

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

vec3 scene(vec2 px, float p, float t, float light){
  vec2 c = (px - 0.5 * u_res) / u_res.y;
  float ang = mix(0.95, 0.62, smoothstep(0.42, 0.72, p)) + 0.06 * sin(0.21 * t) * light;
  vec2 nrm = vec2(-sin(ang), cos(ang));
  float d = dot(c, nrm);
  d += 0.10 * (fbm(c * 1.7 + vec2(0.05 * t, -0.04 * t)) - 0.5);
  float shift = mix(0.42, 0.0, smoothstep(0.0, 0.64, p)) + 0.02 * sin(0.4 * t);
  shift = mix(shift, -0.40 + 0.10 * sin(0.27 * t), smoothstep(0.70, 0.95, p));
  float b = d - shift;
  float glow = exp(-b * b * mix(9.0, 6.0, p));
  float core = exp(-(b + 0.04) * (b + 0.04) * 55.0);
  float rim  = exp(-(b - 0.09) * (b - 0.09) * 90.0);
  float side = smoothstep(-0.6, 0.6, c.y - c.x);
  vec3 dark = mix(NUIT, mix(NUIT2, INDIGO * 0.55, side * 0.6), 0.35 + 0.65 * side);
  // Le champ orange : cuivre en haut à gauche, pêche en bas à droite, qui ondule avec le temps.
  float diag = dot(c, vec2(0.7071, -0.7071));
  float wave = 0.10 * sin(0.35 * t + c.x * 1.6) + 0.12 * (fbm(c * 1.3 + vec2(0.06 * t, 0.045 * t)) - 0.5);
  vec3 bright = mix(ABRICOT, PECHE, smoothstep(-0.30, 0.60, diag + wave));
  bright = mix(bright, CUIVRE, smoothstep(0.0, -0.75, diag + wave) * 0.6);
  vec3 col = mix(dark, bright, light);
  col = mix(col, OCRE, 0.22 * light * (1.0 - light) * 4.0);
  col = mix(col, ORANGE, glow * mix(0.86, 0.5, light));
  col = mix(col, mix(mix(NUIT, NUIT2, 0.6), BRUN, light), core * mix(0.9, 0.8, light));
  col += OCRE * rim * mix(0.35, 0.25, light);
  return col;
}

void main(){
  float p = u_p, t = u_time;
  vec2 fc = gl_FragCoord.xy;
  float light = smoothstep(0.66, 0.90, p);
  float strength = 1.0 - smoothstep(0.72, 0.96, p);

  float ribW = mix(84.0, 56.0, p) * u_dpr;
  float ri = floor(fc.x / ribW);
  float f = fract(fc.x / ribW);
  vec2 sp = vec2(fc.x + (f - 0.5) * ribW * 1.8 * strength, fc.y);

  vec3 col = scene(sp, p, t, light);

  if (u_hasText > 0.5){
    vec2 tuv = (sp - u_rect.xy) / u_rect.zw;
    float a = 0.0;
    if (tuv.x > -0.1 && tuv.x < 1.1 && tuv.y > -0.3 && tuv.y < 1.3){
      float bias = 4.5 * (1.0 - smoothstep(0.70, 0.95, p));
      a = texture2D(u_text, clamp(tuv, 0.0, 1.0), bias).a;
    }
    float reveal = smoothstep(0.64, 0.82, p);
    col = mix(col, mix(SABLE, ENCRE, smoothstep(0.66, 0.86, p)), a * reveal);
  }

  float rnd = hash(vec2(ri, 7.0));
  col *= 1.0 - strength * 0.14 * f;
  col += strength * (smoothstep(0.06, 0.0, f) * 0.10 + smoothstep(0.94, 1.0, f) * 0.05) * (0.5 + rnd);
  col += mix(ORANGE, INDIGO, step(0.5, hash(vec2(ri, 3.0)))) * step(0.82, rnd) * exp(-pow((f - 0.5) * 12.0, 2.0)) * strength * 0.22;

  col += (hash(fc + floor(t * 10.0) * 13.17) - 0.5) * 0.06;

  vec2 uv = fc / u_res;
  float vig = smoothstep(1.1, 0.3, length(uv - 0.5));
  col *= mix(0.8 + 0.2 * vig, 1.0, light);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

type Mode = "pending" | "gl" | "no-gl";

/**
 * Ouverture de la landing. Tout le dessin se fait hors de React (requestAnimationFrame + styles directs) :
 * mettre la progression du défilement dans un état React relancerait un rendu à chaque image.
 */
export function LandingIntro() {
  const storyRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const finalRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const phraseRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const [mode, setMode] = useState<Mode>("pending");
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const story = storyRef.current;
    const canvas = canvasRef.current;
    const finalUi = finalRef.current;
    const nav = navRef.current;
    if (!story || !canvas || !finalUi || !nav) return;

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" });
    const program = gl ? buildProgram(gl) : null;

    // Ces deux réglages dépendent du navigateur : ils ne sont connus qu'ici, une fois la page chargée.
    queueMicrotask(() => {
      setMode(program ? "gl" : "no-gl");
      setReduced(prefersReduced);
    });

    let textTexture: WebGLTexture | null = null;
    let glyphBottom = 0.3;
    let dpr = 1;
    const rect = { w: 0, h: 0, cy: 0 };

    const layout = () => {
      const W = canvas.clientWidth || window.innerWidth;
      const H = canvas.clientHeight || window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, W < 700 ? 1 : 1.25);
      rect.w = Math.min(W * 0.88, 1080);
      rect.h = rect.w / 4;
      rect.cy = H * 0.44;
      if (gl && program) {
        finalUi.style.top = `${Math.round(rect.cy + glyphBottom * rect.h + 26)}px`;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        gl.viewport(0, 0, canvas.width, canvas.height);
      }
    };

    const render = (p: number, t: number) => {
      if (!gl || !program) return;
      const H = canvas.height;
      const u = program.uniforms;
      gl.uniform2f(u.u_res, canvas.width, H);
      gl.uniform1f(u.u_time, t);
      gl.uniform1f(u.u_p, p);
      gl.uniform1f(u.u_dpr, dpr);
      gl.uniform1f(u.u_hasText, textTexture ? 1 : 0);
      const rw = rect.w * dpr;
      const rh = rect.h * dpr;
      gl.uniform4f(u.u_rect, canvas.width / 2 - rw / 2, H - rect.cy * dpr - rh / 2, rw, rh);
      if (textTexture) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, textTexture);
        gl.uniform1i(u.u_text, 0);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const ui = (p: number) => {
      phraseRefs.current.forEach((el, i) => {
        if (!el) return;
        const [a, b, c, d] = WINDOWS[i];
        const enter = smoothstep(a, b, p);
        const leave = smoothstep(c, d, p);
        const o = enter * (1 - leave);
        el.style.opacity = o.toFixed(3);
        el.style.transform = `translateY(${((1 - enter) * 24 - leave * 24).toFixed(1)}px)`;
        el.style.filter = o > 0.99 ? "none" : `blur(${((1 - o) * 8).toFixed(1)}px)`;
      });
      const fo = smoothstep(0.86, 0.95, p);
      finalUi.style.opacity = fo.toFixed(3);
      finalUi.style.visibility = fo < 0.02 ? "hidden" : "visible";
      finalUi.style.transform = `translateY(${((1 - fo) * 16).toFixed(1)}px)`;
      if (hintRef.current) hintRef.current.style.opacity = (1 - smoothstep(0.01, 0.06, p)).toFixed(3);
      if (barRef.current) barRef.current.style.transform = `scaleX(${p.toFixed(4)})`;
    };

    // La barre passe en clair dès que la lumière arrive, et le reste sur les sections claires de la page.
    const updateNav = (p: number) => {
      const r = story.getBoundingClientRect();
      nav.classList.toggle(styles.onLight, prefersReduced || p > 0.8 || r.bottom < 80);
    };

    const target = () => {
      const r = story.getBoundingClientRect();
      const total = r.height - window.innerHeight;
      return total > 0 ? clamp(-r.top / total, 0, 1) : 1;
    };

    let current = target();
    let running = false;
    let visible = true;
    let raf = 0;
    const t0 = performance.now();

    const frame = (now: number) => {
      const goal = target();
      current += (goal - current) * 0.32;
      if (Math.abs(goal - current) < 0.0006) current = goal;
      ui(current);
      updateNav(current);
      render(current, (now - t0) / 1000);
      if (visible && !document.hidden) raf = requestAnimationFrame(frame);
      else running = false;
    };

    const kick = () => {
      if (prefersReduced) {
        layout();
        render(1, 2);
        updateNav(1);
        return;
      }
      if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };

    // Texture du mot AKWABA, dessinée une fois la police chargée.
    const buildText = () => {
      if (!gl || !program) return;
      const built = drawWordTexture(gl, getComputedStyle(document.body).fontFamily);
      textTexture = built.texture;
      glyphBottom = built.glyphBottom;
      layout();
      kick();
    };

    layout();
    if (gl && program) {
      Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 2500))]).then(buildText, buildText);
    }

    const onScroll = () => {
      updateNav(current);
      kick();
    };
    const onVisibility = () => {
      if (!document.hidden) kick();
    };
    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        layout();
        kick();
      }, 100);
    };

    const observer = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible) kick();
    });

    if (prefersReduced) {
      render(1, 2);
      updateNav(1);
    } else {
      ui(current);
      observer.observe(story);
      document.addEventListener("visibilitychange", onVisibility);
      kick();
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.clearTimeout(resizeTimer);
      // Pas de loseContext() ici : en développement, React monte l'effet deux fois de suite, et le
      // second montage récupérerait un contexte WebGL déjà détruit. Le navigateur libère le contexte avec le canvas.
    };
  }, []);

  return (
    <div className={cn(mode === "gl" && styles.gl, mode === "no-gl" && styles.noGl, reduced && styles.reduced)}>
      <nav ref={navRef} className={styles.nav} aria-label="Navigation principale">
        <div className={styles.navInner}>
          <Link href="/" aria-label="Akwaba, accueil">
            <Logo tone="inherit" />
          </Link>
          <div className="flex items-center gap-1.5">
            <a className={cn(styles.navLink, styles.hideSm)} href="#fonctionnalites">
              Fonctionnalités
            </a>
            <a className={cn(styles.navLink, styles.hideSm)} href="#tarifs">
              Tarifs
            </a>
            <Link className={styles.navLink} href="/connexion">
              Connexion
            </Link>
            <Link href="/inscription" className="bouton-nuit rounded-full px-4 py-2.5 text-[15px] font-semibold whitespace-nowrap">
              <span className="hidden sm:inline">Créer ma boutique</span>
              <span className="sm:hidden">Commencer</span>
            </Link>
          </div>
        </div>
      </nav>

      <section ref={storyRef} className={styles.story} aria-label="Akwaba, de l’idée à la boutique">
        <div className={styles.stage}>
          <div className={styles.fallback} aria-hidden />
          <canvas ref={canvasRef} className={styles.canvas} aria-hidden />

          <div className={styles.phrases}>
            {PHRASES.map(([bold, thin], i) => (
              <p
                key={thin}
                className={styles.phrase}
                ref={(el) => {
                  phraseRefs.current[i] = el;
                }}
              >
                <span>{bold}</span> <span className={styles.thin}>{thin}</span>
              </p>
            ))}
          </div>

          <div ref={finalRef} className={styles.final}>
            <h1 className={styles.finalWord}>Akwaba</h1>
            <p className={styles.finalSub}>La boutique en ligne faite pour vous.</p>
            <div className="mt-1.5 flex flex-wrap justify-center gap-2">
              <Link href="/inscription" className="bouton-nuit rounded-full px-6 py-3.5 font-semibold">
                Créer ma boutique
              </Link>
              <Link href="/boutique/maison-adjoua" className="bouton-verre rounded-full px-6 py-3.5 font-semibold">
                Voir une boutique
              </Link>
            </div>
            <p className={styles.finalMeaning}>« Akwaba » veut dire « bienvenue » en baoulé.</p>
          </div>

          <div ref={hintRef} className={styles.hint} aria-hidden>
            Faites défiler
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
          <div className={styles.progress} aria-hidden>
            <span ref={barRef} />
          </div>
        </div>
      </section>
    </div>
  );
}

type Program = {
  uniforms: Record<"u_res" | "u_time" | "u_p" | "u_dpr" | "u_text" | "u_rect" | "u_hasText", WebGLUniformLocation | null>;
};

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

    const names = ["u_res", "u_time", "u_p", "u_dpr", "u_text", "u_rect", "u_hasText"] as const;
    const uniforms = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)])) as Program["uniforms"];
    return { uniforms };
  } catch {
    return null;
  }
}

function drawWordTexture(gl: WebGLRenderingContext, fontFamily: string) {
  const c = document.createElement("canvas");
  c.width = 2048;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  const stretch = "fontStretch" in ctx;
  const setFont = (size: number) => {
    ctx.font = `800 ${size}px ${fontFamily}`;
    if (stretch) ctx.fontStretch = "expanded";
  };
  let size = 380;
  setFont(size);
  const sx = stretch ? 1 : 1.2;
  size *= 1900 / (ctx.measureText("AKWABA").width * sx);
  setFont(size);
  const m = ctx.measureText("AKWABA");
  const asc = m.actualBoundingBoxAscent || size * 0.72;
  const desc = m.actualBoundingBoxDescent || 0;
  ctx.clearRect(0, 0, 2048, 512);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "alphabetic";
  ctx.save();
  ctx.translate(1024, 256 + (asc - desc) / 2);
  ctx.scale(sx, 1);
  ctx.textAlign = "center";
  ctx.fillText("AKWABA", 0, 0);
  ctx.restore();

  // Bas réel du mot, mesuré sur les pixels (plus fiable que les métriques de la police).
  let glyphBottom = 0.3;
  const px = ctx.getImageData(0, 0, 2048, 512).data;
  outer: for (let y = 511; y >= 0; y--) {
    for (let x = 0; x < 2048; x += 3) {
      if (px[(y * 2048 + x) * 4 + 3] > 60) {
        if (y > 256) glyphBottom = (y - 256) / 512;
        break outer;
      }
    }
  }

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { texture, glyphBottom };
}
