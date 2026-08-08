/* ============================================================
   About section: continuous rotating DNA double helix
   ============================================================ */
(() => {
  const canvas = document.getElementById('about-scene');
  const wrap = canvas ? canvas.parentElement : null;
  if (!canvas || !wrap || !window.THREE) return;

  const W = wrap.clientWidth || 320;
  const H = wrap.clientHeight || 360;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
  camera.position.set(0, 0, 7);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  /* Strands */
  const STRANDS = 2;
  const POINTS = 180;
  const group = new THREE.Group();

  const gGeo = new THREE.BufferGeometry();
  const gPos = new Float32Array(STRANDS * POINTS * 3);
  gGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));

  const baseColor = new THREE.Color(0x00d4ff);
  const topColor = new THREE.Color(0x7c5cff);
  const gCol = new Float32Array(STRANDS * POINTS * 3);
  for (let s = 0; s < STRANDS; s++) {
    for (let i = 0; i < POINTS; i++) {
      const c = baseColor.clone().lerp(topColor, i / POINTS);
      gCol[(s * POINTS + i) * 3] = c.r;
      gCol[(s * POINTS + i) * 3 + 1] = c.g;
      gCol[(s * POINTS + i) * 3 + 2] = c.b;
    }
  }
  gGeo.setAttribute('color', new THREE.BufferAttribute(gCol, 3));

  const gMat = new THREE.PointsMaterial({
    size: 0.14,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false
  });
  const points = new THREE.Points(gGeo, gMat);
  group.add(points);

  /* Rungs */
  const RUNGS = Math.floor(POINTS / 4);
  const rPos = new Float32Array(RUNGS * 2 * 3);
  const rGeo = new THREE.BufferGeometry();
  rGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3));
  const rMat = new THREE.LineBasicMaterial({
    color: 0x7c5cff,
    transparent: true,
    opacity: 0.25,
    depthWrite: false
  });
  const rungs = new THREE.LineSegments(rGeo, rMat);
  group.add(rungs);

  /* Small orbiting data dots */
  const DOT_COUNT = 26;
  const dPos = new Float32Array(DOT_COUNT * 3);
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  const dMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.05,
    transparent: true,
    opacity: 0.6,
    depthWrite: false
  });
  const dots = new THREE.Points(dGeo, dMat);
  group.add(dots);

  scene.add(group);

  const clock = new THREE.Clock();
  let visible = true;
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
    }, { threshold: 0.05 });
    io.observe(wrap);
  }

  window.addEventListener('resize', () => {
    const w = wrap.clientWidth || 320;
    const h = wrap.clientHeight || 360;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  function animate() {
    requestAnimationFrame(animate);
    if (!visible) return;
    const t = clock.getElapsedTime();
    const dt = 1 / 60;

    const heightHalf = 2.3;
    const turns = 3.0;
    const R = 0.95 + Math.sin(t * 0.6) * 0.05;

    const pos = gGeo.attributes.position;
    for (let s = 0; s < STRANDS; s++) {
      for (let i = 0; i < POINTS; i++) {
        const f = i / POINTS;
        const ang = f * Math.PI * 2 * turns + s * Math.PI;
        const y = -heightHalf + f * heightHalf * 2;
        const rr = R * (1 - 0.05 * Math.sin(t * 1.3 + f * 6));
        pos.setXYZ(s * POINTS + i, rr * Math.cos(ang), y, rr * Math.sin(ang));
      }
    }
    pos.needsUpdate = true;

    const rp = rGeo.attributes.position;
    for (let k = 0; k < RUNGS; k++) {
      const i = k * 4;
      const f = i / POINTS;
      const ang = f * Math.PI * 2 * turns;
      const y = -heightHalf + f * heightHalf * 2;
      const rr = R * (1 - 0.05 * Math.sin(t * 1.3 + f * 6));
      rp.setXYZ(k * 2, rr * Math.cos(ang), y, rr * Math.sin(ang));
      rp.setXYZ(k * 2 + 1, rr * Math.cos(ang + Math.PI), y, rr * Math.sin(ang + Math.PI));
    }
    rp.needsUpdate = true;

    const dp = dGeo.attributes.position;
    for (let i = 0; i < DOT_COUNT; i++) {
      const ang = t * (0.5 + (i % 5) * 0.12) + i * 1.7;
      const rad = 1.35 + 0.4 * Math.sin(t * 0.7 + i);
      const y = -2.1 + ((i * 37) % 100) * 0.042;
      dp.setXYZ(i, rad * Math.cos(ang), y, rad * Math.sin(ang) * 0.6);
    }
    dp.needsUpdate = true;

    group.rotation.y += 0.4 * dt;
    group.rotation.x = Math.sin(t * 0.4) * 0.18;
    group.rotation.z = Math.cos(t * 0.3) * 0.08;
    group.position.y = Math.sin(t * 0.5) * 0.08;

    renderer.render(scene, camera);
  }

  animate();
})();
