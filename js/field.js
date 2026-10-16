// Particle field: noise -> signal (Gaussian clusters) -> build (the ">_" glyph).
// All three layouts live in vertex attributes; the scroll only moves the uProgress uniform (0..2)
// and the vertex shader blends between them. The frame loop allocates nothing.
import {
  WebGLRenderer, Scene, PerspectiveCamera, BufferGeometry, BufferAttribute, Points, ShaderMaterial,
  LineSegments, LineBasicMaterial, AdditiveBlending,
} from 'three';

const CLUSTER_COLORS = [
  [0.49, 0.89, 0.77], // mint (the accent)
  [1.00, 0.77, 0.42], // amber
  [1.00, 0.54, 0.48], // coral
  [0.48, 0.66, 1.00], // blue
];
const ACCENT = [0.49, 0.89, 0.77];
const FOV = 50;
const CAM_Z = 10;

const vertexShader = /* glsl */ `
  uniform float uProgress;
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform vec2 uPointer;
  uniform float uPointerOn;
  uniform vec3 uAccent;
  attribute vec3 aSignal;
  attribute vec3 aBuild;
  attribute vec3 aColor;
  attribute float aRand;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float p1 = smoothstep(0.0, 1.0, clamp(uProgress * 1.3 - aRand * 0.3, 0.0, 1.0));
    float p2 = smoothstep(0.0, 1.0, clamp((uProgress - 1.0) * 1.3 - aRand * 0.3, 0.0, 1.0));
    float t = uTime;
    vec3 drift = vec3(sin(t * 0.17 + aRand * 40.0), cos(t * 0.13 + aRand * 31.0), sin(t * 0.11 + aRand * 17.0));
    vec3 pos = mix(position + drift * 0.35, aSignal + drift * 0.04, p1);
    pos = mix(pos, aBuild + drift * 0.02, p2);

    vec2 d = pos.xy - uPointer;
    float dist = length(d) + 1e-4;
    pos.xy += (d / dist) * uPointerOn * smoothstep(1.3, 0.0, dist) * 0.55;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (0.55 + aRand * 0.9) * (${CAM_Z.toFixed(1)} / -mv.z);

    vec3 base = vec3(0.60, 0.66, 0.76);
    vColor = mix(mix(base, aColor, p1), mix(uAccent, aColor, 0.15), p2);
    vAlpha = mix(mix(0.6, 0.8, p1), 0.6, p2);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.1, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

function gauss() {
  // Box-Muller
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function sampleGlyph() {
  const font = '700 160px "JetBrains Mono", ui-monospace, Menlo, monospace';
  const c = document.createElement('canvas');
  let g = c.getContext('2d');
  g.font = font;
  const w = Math.ceil(g.measureText('>_').width) + 40, h = 200;
  c.width = w; c.height = h; // resizing resets the context state
  g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font;
  g.fillText('>_', w / 2, h / 2);
  const data = g.getImageData(0, 0, w, h).data;
  const pts = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (data[(y * w + x) * 4 + 3] > 140) pts.push(x / w - 0.5, (0.5 - y / h) * (h / w));
    }
  }
  return pts; // flat [x, y, ...] in a unit-wide box
}

// Give the main thread back between setup steps, so no single task blocks input for long.
const yieldTask = () => new Promise((r) => setTimeout(r, 0));

export async function startField(canvas, gsap, ScrollTrigger) {
  const mobile = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
  const COUNT = mobile ? 6000 : 12000;
  // Low-end devices (4 cores or fewer) render at 1x from the start.
  const lowEnd = (navigator.hardwareConcurrency || 8) <= 4;
  const dpr = lowEnd ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);

  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);
  renderer.debug.checkShaderErrors = false; // avoids a blocking program-status read on first draw
  await yieldTask();

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.z = CAM_Z;

  const geo = new BufferGeometry();
  const noise = new Float32Array(COUNT * 3);
  const signal = new Float32Array(COUNT * 3);
  const build = new Float32Array(COUNT * 3);
  const color = new Float32Array(COUNT * 3);
  const rand = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) rand[i] = Math.random();

  // Per-particle random choices are fixed once, so a resize only rescales the layouts.
  const cluster = new Uint8Array(COUNT);
  const g1 = new Float32Array(COUNT * 3);
  const u1 = new Float32Array(COUNT * 3);
  const glyph = sampleGlyph();
  await yieldTask();
  const glyphPick = new Uint32Array(COUNT);
  const glyphN = glyph.length / 2;
  const means = [[-0.55, 0.45], [0.5, 0.55], [0.35, -0.45], [-0.45, -0.5]];
  const sigmas = [0.17, 0.2, 0.15, 0.13];
  for (let i = 0; i < COUNT; i++) {
    const k = (i * 7 + Math.floor(rand[i] * 4)) % 4;
    cluster[i] = k;
    g1[i * 3] = gauss(); g1[i * 3 + 1] = gauss(); g1[i * 3 + 2] = gauss();
    u1[i * 3] = Math.random() * 2 - 1; u1[i * 3 + 1] = Math.random() * 2 - 1; u1[i * 3 + 2] = Math.random() * 2 - 1;
    glyphPick[i] = Math.floor(Math.random() * glyphN);
    const col = CLUSTER_COLORS[k];
    color[i * 3] = col[0]; color[i * 3 + 1] = col[1]; color[i * 3 + 2] = col[2];
  }

  geo.setAttribute('position', new BufferAttribute(noise, 3));
  geo.setAttribute('aSignal', new BufferAttribute(signal, 3));
  geo.setAttribute('aBuild', new BufferAttribute(build, 3));
  geo.setAttribute('aColor', new BufferAttribute(color, 3));
  geo.setAttribute('aRand', new BufferAttribute(rand, 1));

  const uniforms = {
    uProgress: { value: 0 },
    uTime: { value: 0 },
    uSize: { value: mobile ? 3.0 : 2.8 },
    uPixelRatio: { value: dpr },
    uPointer: { value: { x: 999, y: 999, isVector2: true } },
    uPointerOn: { value: 0 },
    uAccent: { value: { r: ACCENT[0], g: ACCENT[1], b: ACCENT[2], isColor: true } },
  };
  const mat = new ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  });
  const points = new Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  // Faint axes for the "signal" state.
  const axesGeo = new BufferGeometry();
  const axesPos = new Float32Array(2 * 3 * 2 + 10 * 2 * 3);
  axesGeo.setAttribute('position', new BufferAttribute(axesPos, 3));
  const axesMat = new LineBasicMaterial({ color: 0xa3abb9, transparent: true, opacity: 0, depthWrite: false });
  const axes = new LineSegments(axesGeo, axesMat);
  axes.frustumCulled = false;
  scene.add(axes);

  let halfH = 1, halfW = 1, lastW = 0;

  function layout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    halfH = Math.tan((FOV / 2) * Math.PI / 180) * CAM_Z;
    halfW = halfH * camera.aspect;
    if (Math.abs(w - lastW) < 2) return; // mobile URL bar: height-only change, keep the layout
    lastW = w;

    const wide = camera.aspect > 1.15;
    const cx = wide ? halfW * 0.5 : 0;
    const cy = wide ? 0 : halfH * 0.12;
    const R = wide ? Math.min(halfW * 0.36, halfH * 0.72) : Math.min(halfW * 0.82, halfH * 0.5);

    for (let i = 0; i < COUNT; i++) {
      const j = i * 3;
      noise[j] = u1[j] * halfW * 1.15;
      noise[j + 1] = u1[j + 1] * halfH * 1.15;
      noise[j + 2] = u1[j + 2] * 3;

      const m = means[cluster[i]], s = sigmas[cluster[i]];
      signal[j] = cx + (m[0] + g1[j] * s) * R;
      signal[j + 1] = cy + (m[1] + g1[j + 1] * s) * R;
      signal[j + 2] = g1[j + 2] * 0.15;

      const p = glyphPick[i] * 2;
      const gw = wide ? R * 1.75 : R * 2.1;
      build[j] = cx + (glyph[p] + (Math.random() - 0.5) * 0.006) * gw;
      build[j + 1] = cy + (glyph[p + 1] + (Math.random() - 0.5) * 0.006) * gw;
      build[j + 2] = g1[j + 2] * 0.08;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aSignal.needsUpdate = true;
    geo.attributes.aBuild.needsUpdate = true;

    // L-shaped axes with ticks, just outside the clusters.
    const x0 = cx - R * 1.05, y0 = cy - R * 1.05, x1 = cx + R * 1.05, y1 = cy + R * 1.05;
    const a = axesPos;
    let n = 0;
    const seg = (ax, ay, bx, by) => { a[n++] = ax; a[n++] = ay; a[n++] = 0; a[n++] = bx; a[n++] = by; a[n++] = 0; };
    seg(x0, y0, x1, y0);
    seg(x0, y0, x0, y1);
    const tick = R * 0.04;
    for (let t = 1; t <= 5; t++) {
      const fx = x0 + (x1 - x0) * t / 5.5, fy = y0 + (y1 - y0) * t / 5.5;
      seg(fx, y0, fx, y0 - tick);
      seg(x0, fy, x0 - tick, fy);
    }
    axesGeo.attributes.position.needsUpdate = true;
  }

  layout();
  await yieldTask();
  // KHR_parallel_shader_compile where available: the shaders compile without blocking the page.
  await renderer.compileAsync(scene, camera);
  await yieldTask();

  // Scroll: each chapter scrubs one unit of progress as it comes into view.
  gsap.registerPlugin(ScrollTrigger);
  const prog = { a: 0, b: 0 };
  const triggers = [
    ScrollTrigger.create({ trigger: '#data', start: 'top 85%', end: 'top 25%', scrub: true,
      onUpdate: (s) => { prog.a = s.progress; } }),
    ScrollTrigger.create({ trigger: '#build', start: 'top 85%', end: 'top 25%', scrub: true,
      onUpdate: (s) => { prog.b = s.progress; } }),
  ];
  prog.a = triggers[0].progress;
  prog.b = triggers[1].progress;

  // Pointer repel, desktop only.
  let pointerTarget = 0;
  const onMove = (e) => {
    if (e.pointerType !== 'mouse') return;
    uniforms.uPointer.value.x = (e.clientX / window.innerWidth * 2 - 1) * halfW;
    uniforms.uPointer.value.y = -(e.clientY / window.innerHeight * 2 - 1) * halfH;
    pointerTarget = 1;
  };
  const onLeave = () => { pointerTarget = 0; };
  if (!mobile) {
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
  }

  let raf = 0, last = performance.now(), running = true;
  let slow = 0, frames = 0, lowered = false;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const raw = now - last;
    const dt = Math.min(raw / 1000, 0.05);
    last = now;
    // A weak GPU: drop to 1x resolution once if frames keep missing ~30 fps.
    if (!lowered && ++frames > 10 && frames < 130) {
      if (raw > 34) slow++;
      if (slow > 40) { lowered = true; renderer.setPixelRatio(1); uniforms.uPixelRatio.value = 1; }
    }
    uniforms.uTime.value += dt;
    const target = prog.a + prog.b;
    uniforms.uProgress.value += (target - uniforms.uProgress.value) * Math.min(1, dt * 6);
    uniforms.uPointerOn.value += (pointerTarget - uniforms.uPointerOn.value) * Math.min(1, dt * 4);
    const p = uniforms.uProgress.value;
    axesMat.opacity = Math.max(0, 1 - Math.abs(p - 1) * 2) * 0.28;
    points.rotation.y = Math.sin(uniforms.uTime.value * 0.05) * 0.06 * (1 - Math.min(p, 1));
    renderer.render(scene, camera);
  }

  // Pause when the tab is hidden or the reader is past the chapters (assistant section, footer).
  let inView = true;
  const resume = () => {
    if (running && inView && !document.hidden && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  };
  const pause = () => { cancelAnimationFrame(raf); raf = 0; };
  const onVis = () => { if (document.hidden) pause(); else resume(); };
  const visible = new Set();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target)));
    inView = visible.size > 0;
    if (inView) resume(); else pause();
  });
  document.querySelectorAll('#main > section:not(.assistant)').forEach((el) => io.observe(el));
  const onResize = () => layout();

  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVis);
  raf = requestAnimationFrame(frame);
  requestAnimationFrame(() => canvas.classList.add('on'));

  return function stop() {
    running = false;
    cancelAnimationFrame(raf);
    triggers.forEach((t) => t.kill());
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pointermove', onMove);
    document.documentElement.removeEventListener('pointerleave', onLeave);
    document.removeEventListener('visibilitychange', onVis);
    io.disconnect();
    geo.dispose(); mat.dispose(); axesGeo.dispose(); axesMat.dispose();
    renderer.dispose();
    canvas.classList.remove('on');
  };
}
