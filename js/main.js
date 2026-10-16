// Boot the particle field after first paint. The page is complete without it:
// reduced motion, no WebGL or any load failure leaves the CSS poster in place.
const canvas = document.getElementById('field');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function whenIdle(fn) {
  if ('requestIdleCallback' in window) requestIdleCallback(fn, { timeout: 1500 });
  else setTimeout(fn, 200);
}

// Hardware WebGL only: a software rasteriser (SwiftShader, llvmpipe) would make every frame a long task.
function hardwareGL() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    if (!gl) return false;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return !/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}

async function boot() {
  if (reduce.matches || !canvas || !hardwareGL()) {
    canvas?.remove();
    return;
  }
  try {
    await loadScript('vendor/gsap.min.js');
    await loadScript('vendor/ScrollTrigger.min.js');
    const { startField } = await import('./field.js');
    const stop = await startField(canvas, window.gsap, window.ScrollTrigger);
    // If the visitor turns on reduced motion mid-visit, drop back to the poster.
    reduce.addEventListener('change', (e) => { if (e.matches) stop(); }, { once: true });
  } catch {
    canvas.remove();
  }
}

if (document.readyState === 'complete') whenIdle(boot);
else addEventListener('load', () => whenIdle(boot), { once: true });
