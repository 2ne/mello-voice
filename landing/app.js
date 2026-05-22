const RELEASE_API = "https://api.github.com/repos/2ne/mello-voice/releases/latest";
const RELEASE_FALLBACK = "https://github.com/2ne/mello-voice/releases/latest";

const platform = detectPlatform();
const downloadLink = document.querySelector("#download-link");
const downloadLabel = document.querySelector("#download-label");
const downloadCaption = document.querySelector("#download-caption");
const windowsIcon = document.querySelector(".platform-icon-windows");
const macIcon = document.querySelector(".platform-icon-macos");
const heroContent = document.querySelector(".hero-content");

updateDownloadIntent(platform);
resolveLatestDownload(platform);
startDemo();
startHeroScroll();
startWebgl();

function detectPlatform() {
  const platformText = [
    navigator.userAgentData?.platform,
    navigator.platform,
    navigator.userAgent,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (platformText.includes("mac")) return "mac";
  if (platformText.includes("win")) return "windows";
  return "other";
}

function updateDownloadIntent(targetPlatform) {
  const isMac = targetPlatform === "mac";
  const isWindows = targetPlatform === "windows";

  macIcon.hidden = !isMac;
  windowsIcon.hidden = isMac;

  if (isMac) {
    downloadLabel.textContent = "Download for macOS";
    if (downloadCaption) downloadCaption.textContent = "Latest macOS disk image from GitHub Releases.";
    return;
  }

  if (isWindows) {
    downloadLabel.textContent = "Download for Windows";
    if (downloadCaption) downloadCaption.textContent = "Recommended installer for Windows 10 and 11.";
    return;
  }

  downloadLabel.textContent = "Download latest release";
  if (downloadCaption) downloadCaption.textContent = "Choose the Windows or macOS installer from GitHub.";
}

async function resolveLatestDownload(targetPlatform) {
  if (targetPlatform === "other") return;

  try {
    const response = await fetch(RELEASE_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) throw new Error(`Release lookup failed: ${response.status}`);

    const release = await response.json();
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const preferred = assets.find((asset) => {
      const name = String(asset.name || "").toLowerCase();
      if (targetPlatform === "mac") return name.endsWith(".dmg");
      return name.endsWith("-setup.exe");
    });

    if (preferred?.browser_download_url) {
      downloadLink.href = preferred.browser_download_url;
      if (downloadCaption) {
        downloadCaption.textContent =
          targetPlatform === "mac"
            ? "Latest macOS disk image from GitHub Releases."
            : "Latest Windows setup installer from GitHub Releases.";
      }
    }
  } catch {
    downloadLink.href = RELEASE_FALLBACK;
    if (downloadCaption) downloadCaption.textContent = "GitHub Releases will show the newest installer.";
  }
}

function startDemo() {
  const recordButton = document.querySelector("#demo-record");
  const overlay = document.querySelector(".demo-overlay");
  const transcript = document.querySelector("#demo-transcript");
  const output = document.querySelector("#demo-output");
  const interimOutput = document.querySelector("#demo-interim");

  if (!recordButton || !overlay || !transcript || !output || !interimOutput) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const initialText = "Click record and say a sentence. Your words will appear here.";
  let recognition = null;
  let finalText = "";
  let isListening = false;
  let pendingIdleMessage = "";

  if (!SpeechRecognition) {
    overlay.dataset.state = "unsupported";
    transcript.textContent = "Use Chrome or Edge to try live recording.";
    recordButton.disabled = true;
    recordButton.setAttribute("aria-label", "Live dictation preview unavailable");
    return;
  }

  function setListening() {
    isListening = true;
    overlay.dataset.state = "recording";
    recordButton.setAttribute("aria-label", "Stop live dictation preview");
    transcript.textContent = "Listening. Click again to stop.";
    if (output.textContent === initialText) output.textContent = "";
  }

  function setIdle(message = "Click here to start recording.") {
    isListening = false;
    overlay.dataset.state = "idle";
    recordButton.setAttribute("aria-label", "Start live dictation preview");
    transcript.textContent = message;
    interimOutput.textContent = "";
    if (!finalText && !output.textContent.trim()) output.textContent = initialText;
  }

  function renderText(interimText = "") {
    output.textContent = finalText || (interimText ? "" : initialText);
    interimOutput.textContent = interimText;
  }

  function stopRecognition() {
    if (!recognition || !isListening) return;
    recognition.stop();
  }

  function startRecognition() {
    recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    finalText = "";
    pendingIdleMessage = "";
    renderText();
    setListening();

    recognition.onresult = (event) => {
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const phrase = event.results[index][0]?.transcript || "";
        if (event.results[index].isFinal) {
          finalText = `${finalText} ${phrase}`.trim();
        } else {
          interimText += phrase;
        }
      }
      renderText(interimText.trim());
    };

    recognition.onerror = (event) => {
      const denied = event.error === "not-allowed" || event.error === "service-not-allowed";
      pendingIdleMessage = denied
        ? "Microphone permission is blocked. Enable it to try the live preview."
        : "Speech recognition stopped. Click record to try again.";
      setIdle(pendingIdleMessage);
    };

    recognition.onend = () => {
      const message = pendingIdleMessage || (finalText
        ? "Captured. Click to record again."
        : "No speech captured yet. Click record and say a short sentence.");
      setIdle(message);
    };

    try {
      recognition.start();
    } catch {
      setIdle("Speech recognition is already starting. Try again in a moment.");
    }
  }

  recordButton.addEventListener("click", () => {
    if (isListening) {
      stopRecognition();
      return;
    }
    startRecognition();
  });
}

function startHeroScroll() {
  if (!heroContent) return;

  let ticking = false;

  function updateHero() {
    const progress = Math.min(Math.max(window.scrollY / Math.max(window.innerHeight * 0.78, 1), 0), 1);
    const fade = 1 - smoothStep(0.18, 0.86, progress);
    const lift = progress * -28;
    heroContent.style.opacity = fade.toFixed(3);
    heroContent.style.transform = `translate3d(0, ${lift.toFixed(2)}px, 0)`;
    heroContent.style.pointerEvents = fade < 0.08 ? "none" : "";
    ticking = false;
  }

  function requestUpdate() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(updateHero);
  }

  updateHero();
  window.addEventListener("scroll", requestUpdate, { passive: true });
  window.addEventListener("resize", requestUpdate);
}

function startWebgl() {
  const canvas = document.querySelector("#field");
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "high-performance",
  });

  if (!gl) {
    canvas.style.display = "none";
    return;
  }

  const vertexSource = `
    attribute vec2 position;
    void main() {
      gl_Position = vec4(position, 0.0, 1.0);
    }
  `;

  const fragmentSource = `
    precision highp float;

    uniform vec2 resolution;
    uniform vec2 pointer;
    uniform float time;
    uniform float scrollProgress;

    mat3 rotateX(float angle) {
      float s = sin(angle);
      float c = cos(angle);
      return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
    }

    mat3 rotateY(float angle) {
      float s = sin(angle);
      float c = cos(angle);
      return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
    }

    float roundedBox(vec2 p, vec2 halfSize, float radius) {
      vec2 q = abs(p) - halfSize + radius;
      return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    }

    float logoSdf(vec2 p) {
      float center = roundedBox(p, vec2(0.092, 0.52), 0.092);
      float sideSpread = mix(0.32, 0.52, smoothstep(0.08, 0.86, scrollProgress));
      float left = roundedBox(p - vec2(-sideSpread, 0.0), vec2(0.077, 0.305), 0.077);
      float right = roundedBox(p - vec2(sideSpread, 0.0), vec2(0.077, 0.305), 0.077);
      return min(center, min(left, right));
    }

    float logoMask(vec2 p) {
      return 1.0 - smoothstep(0.0, 0.018, logoSdf(p));
    }

    vec2 hash22(vec2 p) {
      p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
      return fract(sin(p) * 43758.5453123);
    }

    float barSurfaceShade(vec2 q) {
      float centerChoice = step(0.16, abs(q.x));
      float sideSpread = mix(0.32, 0.52, smoothstep(0.08, 0.86, scrollProgress));
      float barCenter = centerChoice * sign(q.x) * sideSpread;
      float halfWidth = mix(0.092, 0.077, centerChoice);
      float lateral = clamp(abs(q.x - barCenter) / halfWidth, 0.0, 1.0);
      float roundness = sqrt(max(0.0, 1.0 - lateral * lateral));
      float vertical = smoothstep(0.58, 0.2, abs(q.y));
      return 0.44 + roundness * 0.42 + vertical * 0.14;
    }

    float jitteredDots(vec2 coord, float scale, float seed) {
      vec2 scaled = coord * scale;
      vec2 cell = floor(scaled);
      vec2 local = fract(scaled);
      vec2 rnd = hash22(cell + vec2(seed, seed * 1.37));
      vec2 center = vec2(0.5) + (rnd - 0.5) * 0.78;
      float radius = mix(0.024, 0.046, rnd.x);
      float dotShape = 1.0 - smoothstep(radius, radius + 0.014, length(local - center));
      float keep = step(0.1, rnd.y);
      return dotShape * keep * (0.62 + rnd.y * 0.38);
    }

    vec2 localPoint(vec2 uv, mat3 rotation, mat3 inverseRotation, float planeDepth) {
      vec3 camera = vec3(0.0, 0.0, 2.45);
      vec3 ray = normalize(vec3(uv, -1.55));
      vec3 normal = rotation * vec3(0.0, 0.0, 1.0);
      vec3 point = rotation * vec3(0.0, -0.04, planeDepth);
      float denom = dot(ray, normal);
      float t = dot(point - camera, normal) / denom;
      vec3 hit = camera + ray * t;
      return (inverseRotation * (hit - point)).xy;
    }

    float dottedLogo(vec2 p, float scale, float seed) {
      vec2 q = p * 0.42;
      float sdf = logoSdf(q);
      float mask = logoMask(q);
      vec2 warped = q;
      warped += vec2(
        sin(q.y * 13.0 + seed + time * 0.22) * 0.009,
        sin(q.x * 11.0 - seed * 0.7 - time * 0.18) * 0.009
      );
      warped += vec2(
        sin(time * 0.11 + q.x * 4.0 + q.y * 1.8),
        cos(time * 0.13 + q.y * 4.4 - q.x * 1.5)
      ) * 0.004;
      float dotsA = jitteredDots(warped + pointer * 0.006, scale, seed);
      float dotsB = jitteredDots(warped * 1.017 + vec2(0.19, -0.11), scale * 0.73, seed + 23.0) * 0.38;
      float edge = 1.0 - smoothstep(0.015, 0.13, abs(sdf));
      float surface = barSurfaceShade(q);
      float shimmer = 0.78 + 0.16 * sin(time * 0.38 + seed + q.x * 5.0 + q.y * 2.0);
      return (dotsA + dotsB) * mask * (surface + edge * 0.28) * shimmer;
    }

    float softLogo(vec2 p) {
      vec2 q = p * 0.42;
      return logoMask(q);
    }

    void main() {
      vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);
      mat3 rotation = rotateY(pointer.x * 0.48) * rotateX(-pointer.y * 0.25);
      mat3 inverseRotation = rotateX(pointer.y * 0.25) * rotateY(-pointer.x * 0.48);
      vec3 normal = rotation * vec3(0.0, 0.0, 1.0);
      vec3 light = normalize(vec3(-0.25 + pointer.x * 0.22, 0.34 - pointer.y * 0.12, 0.9));

      float heroScale = mix(0.94, 1.06, scrollProgress);
      float heroLift = mix(0.02, -0.12, scrollProgress);
      float heroFade = 1.0 - smoothstep(0.16, 0.82, scrollProgress);
      vec2 sceneUv = uv * heroScale + vec2(0.0, heroLift);
      vec2 front = localPoint(sceneUv, rotation, inverseRotation, 0.0);
      vec2 back = localPoint(sceneUv, rotation, inverseRotation, -0.16);
      vec2 glow = localPoint(sceneUv, rotation, inverseRotation, -0.08);

      float frontDots = dottedLogo(front, 192.0, 0.0);
      float backDots = dottedLogo(back, 192.0, 19.0) * 0.1;
      float softCore = softLogo(glow) * 0.038;
      float lighting = 0.56 + 0.44 * max(dot(normal, light), 0.0);
      float premiumSheen = smoothstep(-0.55, 0.8, front.y - front.x * 0.22) * smoothstep(0.95, -0.15, front.y);
      float fade = smoothstep(1.55, 0.08, length(uv));

      vec3 graphite = vec3(0.012);
      vec3 silver = vec3(0.72);
      vec3 color = graphite + silver * ((frontDots * (0.84 + premiumSheen * 0.22) + backDots) * lighting + softCore);

      float alpha = fade * heroFade * clamp(frontDots * 0.78 + backDots * 0.12 + softCore * 0.36, 0.0, 0.68);
      gl_FragColor = vec4(color, alpha);
    }
  `;

  const program = createProgram(gl, vertexSource, fragmentSource);
  if (!program) return;

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );

  const position = gl.getAttribLocation(program, "position");
  const resolution = gl.getUniformLocation(program, "resolution");
  const pointer = gl.getUniformLocation(program, "pointer");
  const time = gl.getUniformLocation(program, "time");
  const scrollProgress = gl.getUniformLocation(program, "scrollProgress");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let start = performance.now();
  let targetPointerX = 0;
  let targetPointerY = 0;
  let pointerX = 0;
  let pointerY = 0;
  let targetScrollProgress = 0;
  let currentScrollProgress = 0;

  function resize() {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.floor(canvas.clientWidth * pixelRatio);
    const height = Math.floor(canvas.clientHeight * pixelRatio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  }

  function render(now) {
    resize();
    gl.useProgram(program);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    pointerX += (targetPointerX - pointerX) * 0.065;
    pointerY += (targetPointerY - pointerY) * 0.065;
    targetScrollProgress = Math.min(Math.max(window.scrollY / Math.max(window.innerHeight * 0.95, 1), 0), 1);
    currentScrollProgress += (targetScrollProgress - currentScrollProgress) * 0.08;
    const canvasFade = 1 - smoothStep(0.28, 0.92, currentScrollProgress);
    const canvasScale = 1;
    const canvasLift = currentScrollProgress * -6;
    canvas.style.opacity = canvasFade.toFixed(3);
    canvas.style.transform = `translate3d(0, ${canvasLift.toFixed(2)}vh, 0) scale(${canvasScale.toFixed(4)})`;
    gl.uniform2f(resolution, canvas.width, canvas.height);
    gl.uniform2f(pointer, pointerX, pointerY);
    gl.uniform1f(time, (now - start) * 0.001);
    gl.uniform1f(scrollProgress, currentScrollProgress);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (!reducedMotion) requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", (event) => {
    targetPointerX = (event.clientX / window.innerWidth - 0.5) * 2;
    targetPointerY = (event.clientY / window.innerHeight - 0.5) * 2;
  });

  function resetPointer() {
    targetPointerX = 0;
    targetPointerY = 0;
  }

  window.addEventListener("pointerleave", resetPointer);
  window.addEventListener("blur", resetPointer);
  document.documentElement.addEventListener("mouseleave", resetPointer);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) resetPointer();
  });
}

function smoothStep(edge0, edge1, value) {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) return null;

  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  return program;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}
