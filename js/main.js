/* ============================================================
   Scroll-driven 3D particle network that assembles into a brain
   ============================================================ */
(() => {
  const canvas = document.getElementById('scene');
  const hero = document.querySelector('.hero');
  if (!canvas || !window.THREE) return;

  let width = window.innerWidth;
  let height = window.innerHeight;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 200);
  camera.position.set(0, 0, 8);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const clock = new THREE.Clock();
  const mouse = { x: 0, y: 0 };

  /* ---------------- Deterministic RNG ---------------- */
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rnd = mulberry32(2026);

  /* ---------------- Tiny math renderer for formula sprites ---------------- */
  const MATH_FONT = '"Cambria Math", "STIX Two Math", "Times New Roman", serif';
  const SYM = {
    '\\sigma': 'σ', '\\mu': 'μ', '\\theta': 'θ', '\\alpha': 'α',
    '\\nabla': '∇', '\\cdot': '·', '\\to': '→', '\\leftarrow': '←',
    '\\times': '×', '\\ldots': '…', '\\in': '∈', '\\epsilon': 'ε',
    '\\sum': '∑'
  };
  const TALL_CHARS = { '(': true, ')': true, '[': true, ']': true, '∑': true, '√': true, '|': true };

  function tokenize(tex) {
    const toks = [];
    let i = 0;
    while (i < tex.length) {
      const c = tex[i];
      if (c === ' ') { toks.push({ t: 'space' }); i++; }
      else if (c === '\\') {
        let j = i + 1;
        while (j < tex.length && /[a-zA-Z]/.test(tex[j])) j++;
        if (j === i + 1) { toks.push({ t: 'char', v: '\\' }); i++; }
        else { toks.push({ t: 'cmd', v: tex.slice(i, j) }); i = j; }
      }
      else if (c === '{') {
        let depth = 1, j = i + 1, out = '';
        while (j < tex.length && depth > 0) {
          if (tex[j] === '{') depth++;
          else if (tex[j] === '}') depth--;
          if (depth > 0) out += tex[j];
          j++;
        }
        toks.push({ t: 'group', v: out });
        i = j;
      }
      else if (c === '^' || c === '_') { toks.push({ t: c }); i++; }
      else { toks.push({ t: 'char', v: c }); i++; }
    }
    return toks;
  }

  function parseSeq(toks) {
    const items = [];
    let i = 0;
    while (i < toks.length) {
      const tok = toks[i];
      if (tok.t === 'space') { items.push({ type: 'space' }); i++; }
      else if (tok.t === 'char') { items.push({ type: 'char', v: tok.v }); i++; }
      else if (tok.t === 'group') { items.push({ type: 'group', children: parseSeq(tokenize(tok.v)) }); i++; }
      else if (tok.t === 'cmd') {
        const name = tok.v.slice(1);
        if (name === 'frac') {
          const num = parseSeq(tokenize(toks[++i].v));
          const den = parseSeq(tokenize(toks[++i].v));
          items.push({ type: 'frac', num, den });
          i++;
        } else if (name === 'text') {
          const v = toks[++i].v;
          items.push({ type: 'char', v, text: true });
          i++;
        } else if (name === 'sqrt') {
          const arg = parseSeq(tokenize(toks[++i].v));
          items.push({ type: 'sqrt', arg });
          i++;
        } else if (name === 'left' || name === 'right') {
          const delim = toks[i + 1];
          if (name === 'left') {
            const inner = [];
            let depth = 1;
            let j = i + 2;
            while (j < toks.length && depth > 0) {
              const t = toks[j];
              if (t.t === 'cmd' && t.v === '\\left') depth++;
              if (t.t === 'cmd' && t.v === '\\right') {
                depth--;
                if (depth === 0) break;
              }
              inner.push(t);
              j++;
            }
            const close = toks[j + 1];
            items.push({ type: 'pgroup', open: delim.v, close: close && close.t === 'char' ? close.v : ')', children: parseSeq(inner) });
            i = j + 2;
          } else {
            items.push({ type: 'char', v: delim && delim.t === 'char' ? delim.v : '' });
            i += 2;
          }
        } else if (SYM[tok.v]) {
          items.push({ type: 'char', v: SYM[tok.v] });
          i++;
        } else {
          i++;
        }
      }
      else if (tok.t === '^' || tok.t === '_') {
        const which = tok.t;
        const next = toks[i + 1];
        const content = next ? parseSeq(tokenize(next.v)) : [];
        const last = items[items.length - 1];
        if (last) {
          if (which === '^') last.sup = content; else last.sub = content;
        }
        i += 2;
      } else i++;
    }
    return items;
  }

  function fontStr(fs, italic, bold) {
    return (bold ? '700 ' : '400 ') + (italic ? 'italic ' : 'normal ') + Math.round(fs) + 'px ' + MATH_FONT;
  }

  function textW(ctx, v, fs, italic) {
    ctx.font = fontStr(fs, italic, false);
    return ctx.measureText(v).width;
  }

  function emptyBox() {
    return { w: 0, h: 0, base: 0, draw() {} };
  }

  function charBox(ctx, it, fs) {
    const v = it.v;
    const italic = !it.text && v.length === 1 && /[a-zA-Z]/.test(v);
    const tall = TALL_CHARS[v];
    const h = fs * (tall ? 1.55 : 1.3);
    const base = fs * (tall ? 1.12 : 0.86);
    const w = textW(ctx, v, fs, italic);
    return {
      w, h, base,
      draw(x, y) {
        ctx.font = fontStr(fs, italic, false);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(v, x, y + base);
      }
    };
  }

  function seqBox(ctx, items, fs) {
    const boxes = items.map(it => layoutItem(ctx, it, fs));
    const gap = fs * 0.1;
    let w = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (i) w += gap;
      w += boxes[i].w;
    }
    let h = 0, base = 0;
    for (const b of boxes) {
      if (b.h > h) h = b.h;
      if (b.base > base) base = b.base;
    }
    return {
      w, h, base,
      draw(x, y) {
        let cx = x;
        for (let i = 0; i < boxes.length; i++) {
          const b = boxes[i];
          if (i) cx += gap;
          b.draw(cx, y + (base - b.base));
          cx += b.w;
        }
      }
    };
  }

  function fracBox(ctx, item, fs) {
    const n = seqBox(ctx, item.num, fs * 0.82);
    const d = seqBox(ctx, item.den, fs * 0.82);
    const gap = fs * 0.16;
    const lineW = Math.max(n.w, d.w) + fs * 0.2;
    const w = Math.max(n.w, d.w);
    const h = n.h + gap * 2 + d.h;
    const base = n.h + gap * 1.2;
    return {
      w, h, base,
      draw(x, y) {
        n.draw(x + (w - n.w) / 2, y);
        const ly = y + n.h + gap * 0.7;
        ctx.fillRect(x + (w - lineW) / 2, ly, lineW, fs * 0.045);
        d.draw(x + (w - d.w) / 2, y + n.h + gap * 1.4);
      }
    };
  }

  function sqrtBox(ctx, item, fs) {
    const arg = seqBox(ctx, item.arg, fs * 0.95);
    const radW = textW(ctx, '√', fs * 1.25, false);
    const w = radW + arg.w + fs * 0.18;
    const h = arg.h + fs * 0.35;
    const base = fs * 0.28 + arg.base;
    return {
      w, h, base,
      draw(x, y) {
        ctx.font = fontStr(fs * 1.25, false, false);
        ctx.fillText('√', x, y + fs * 0.34 + arg.base);
        ctx.fillRect(x + radW + fs * 0.05, y + fs * 0.08, arg.w + fs * 0.05, fs * 0.05);
        arg.draw(x + radW + fs * 0.1, y + fs * 0.28);
      }
    };
  }

  function pgroupBox(ctx, item, fs) {
    const inner = seqBox(ctx, item.children, fs * 0.95);
    const ph = Math.max(inner.h, fs * 1.15);
    const pad = fs * 0.12;
    const openW = textW(ctx, '(', ph, false);
    const closeW = textW(ctx, ')', ph, false);
    const w = openW + inner.w + closeW + pad * 2;
    const h = Math.max(ph, inner.h);
    const base = ph * 0.78;
    return {
      w, h, base,
      draw(x, y) {
        ctx.font = fontStr(ph, false, false);
        ctx.fillText('(', x, y + ph * 0.78);
        inner.draw(x + openW + pad, y + (h - inner.h) / 2);
        ctx.font = fontStr(ph, false, false);
        ctx.fillText(')', x + openW + pad + inner.w + pad, y + ph * 0.78);
      }
    };
  }

  function subSupBox(ctx, item, fs) {
    const b = charBox(ctx, item, fs);
    const sup = item.sup ? seqBox(ctx, item.sup, fs * 0.66) : null;
    const sub = item.sub ? seqBox(ctx, item.sub, fs * 0.66) : null;
    const gap = fs * 0.08;
    const w = b.w + Math.max(sup ? sup.w : 0, sub ? sub.w : 0) + gap;
    const supBaseOff = b.base - fs * 0.5;
    const subBaseOff = b.base + fs * 0.32;
    let top = 0, bottom = b.h;
    if (sup) {
      const t = supBaseOff - sup.base;
      if (t < top) top = t;
      if (t + sup.h > bottom) bottom = t + sup.h;
    }
    if (sub) {
      const t = subBaseOff - sub.base;
      if (t < top) top = t;
      if (t + sub.h > bottom) bottom = t + sub.h;
    }
    const base = b.base - top;
    return {
      w, h: bottom - top, base,
      draw(x, y) {
        b.draw(x, y - top);
        if (sup) sup.draw(x + b.w + gap, y - top + (supBaseOff - sup.base));
        if (sub) sub.draw(x + b.w + gap, y - top + (subBaseOff - sub.base));
      }
    };
  }

  function sumBox(ctx, item, fs) {
    const sym = charBox(ctx, { v: '∑' }, fs * 1.4);
    const sup = item.sup ? seqBox(ctx, item.sup, fs * 0.6) : null;
    const sub = item.sub ? seqBox(ctx, item.sub, fs * 0.6) : null;
    const gap = fs * 0.16;
    const w = Math.max(sym.w, sup ? sup.w : 0, sub ? sub.w : 0) + fs * 0.1;
    let h = sym.h;
    if (sup) h += sup.h + gap;
    if (sub) h += sub.h + gap;
    const base = (sup ? sup.h + gap : 0) + sym.base;
    return {
      w, h, base,
      draw(x, y) {
        let top = y;
        if (sup) { sup.draw(x + (w - sup.w) / 2, top); top += sup.h + gap; }
        sym.draw(x + (w - sym.w) / 2, top);
        if (sub) sub.draw(x + (w - sub.w) / 2, top + sym.h + gap);
      }
    };
  }

  function layoutItem(ctx, it, fs) {
    switch (it.type) {
      case 'group': return seqBox(ctx, it.children, fs);
      case 'frac': return fracBox(ctx, it, fs);
      case 'sqrt': return sqrtBox(ctx, it, fs);
      case 'pgroup': return pgroupBox(ctx, it, fs);
      case 'space': return { w: fs * 0.3, h: fs * 1.3, base: fs * 0.86, draw() {} };
      case 'char':
        if (it.v === '∑') return sumBox(ctx, it, fs);
        if (it.sub || it.sup) return subSupBox(ctx, it, fs);
        return charBox(ctx, it, fs);
      default: return emptyBox();
    }
  }

  const FORMULAS = [
    '\\sigma^2 = \\frac{\\sum_{i=1}^{n} \\left( x_i - \\mu \\right)^2}{n}',
    '\\theta \\leftarrow \\theta - \\alpha \\nabla J(\\theta)',
    'a = \\text{ReLU}( W \\cdot x + b )',
    '\\text{Attn}( Q, K, V ) = \\text{softmax} \\left( \\frac{Q K^{T}}{\\sqrt{d_{k}}} \\right) V'
  ];

  function makeFormulaSprite(tex) {
    const c = document.createElement('canvas');
    const mctx = c.getContext('2d');
    const fs = 132;
    const box = seqBox(mctx, parseSeq(tokenize(tex)), fs);
    const padX = 48, padY = 36;
    c.width = Math.max(420, Math.ceil(box.w + padX * 2));
    c.height = Math.max(180, Math.ceil(box.h + padY * 2));
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    const grad = ctx.createLinearGradient(0, 0, c.width, 0);
    grad.addColorStop(0, '#7c5cff');
    grad.addColorStop(1, '#00d4ff');
    ctx.shadowColor = 'rgba(124,92,255,0.85)';
    ctx.shadowBlur = 36;
    ctx.fillStyle = '#ffffff';
    box.draw(padX, padY);
    ctx.shadowBlur = 0;
    ctx.fillStyle = grad;
    box.draw(padX, padY);

    const texObj = new THREE.CanvasTexture(c);
    texObj.minFilter = THREE.LinearFilter;
    texObj.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({
      map: texObj,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const sprite = new THREE.Sprite(mat);
    sprite.userData.aspect = c.width / c.height;
    return sprite;
  }

  const formulaSprites = FORMULAS.map(makeFormulaSprite);
  const spritePos = [
    { x: 4.4, y: 1.9, z: 0.5 },
    { x: -4.4, y: 0.9, z: -0.5 },
    { x: 4.4, y: -0.9, z: 0.5 },
    { x: -4.4, y: -1.9, z: -0.5 }
  ];
  formulaSprites.forEach((s, i) => {
    s.position.set(spritePos[i].x, spritePos[i].y, spritePos[i].z);
    scene.add(s);
  });

  /* ---------------- Brain target point cloud ---------------- */
  function buildBrain(count) {
    const pts = [];
    const rx = 1.0, ry = 0.95, rz = 0.52;
    const cz = [-0.58, 0.58];
    const hemiTarget = Math.round(count * 0.74);
    const r2 = mulberry32(777);
    while (pts.length < hemiTarget) {
      const hemi = r2() < 0.5 ? 0 : 1;
      const th = r2() * Math.PI * 2;
      const ph = Math.acos(1 - 2 * r2());
      const sp = Math.sin(ph), cp = Math.cos(ph);
      const cth = Math.cos(th), sth = Math.sin(th);
      const bx = sp * cth, by = cp, bz = sp * sth;

      /* pronounced gyri / sulci so the surface reads as a brain */
      const fold =
        0.14 * Math.sin(5 * th + 0.7) * Math.sin(6 * ph) +
        0.085 * Math.sin(9 * th + 2.1) * Math.sin(7 * ph + 1.2) +
        0.055 * Math.sin(15 * th + 3.0) * Math.sin(10 * ph + 0.4) +
        0.04 * Math.sin(22 * th + 1.0) * Math.sin(13 * ph + 2.5);

      /* lateral (sylvian) fissure crease on the lower sides */
      const sylvian = -0.11 * Math.exp(-Math.pow(ph - 1.95, 2) / 0.05);

      /* flatten the medial face so the two hemispheres sit clearly apart */
      const medial = 1 - 0.45 * Math.exp(-(bz * bz) / 0.045);

      /* flatten the underside (ventral surface) */
      const bottom = 1 - 0.22 * Math.exp(-Math.pow(cp + 0.85, 2) / 0.045);

      /* subtle lateral bulge for the temporal lobes */
      const temporal = 1 + 0.1 * Math.exp(-Math.pow(ph - 2.3, 2) / 0.12) * Math.abs(cth) * 0.6;

      let r = (1 + fold + sylvian) * medial * bottom * temporal;
      if (r2() < 0.16) r *= 0.35 + r2() * 0.5;

      pts.push([
        bx * rx * r,
        by * ry * r,
        bz * rz * r + cz[hemi]
      ]);
    }

    /* Cerebellum: distinct lobed knob at the back-bottom, on the midline */
    const cbN = Math.round(count * 0.16);
    for (let i = 0; i < cbN; i++) {
      const th = r2() * Math.PI * 2;
      const ph = Math.acos(1 - 2 * r2());
      const sp = Math.sin(ph), cp = Math.cos(ph);
      let r = (1 + 0.18 * Math.sin(4 * th) * Math.sin(5 * ph)) * 0.5;
      if (r2() < 0.25) r *= 0.4 + r2() * 0.5;
      pts.push([
        Math.cos(th) * sp * r + 0.52,
        Math.sin(th) * sp * r * 0.8 - 0.82,
        Math.cos(ph) * r * 0.9
      ]);
    }

    /* Brainstem: short vertical stalk hanging below */
    const bsN = Math.round(count * 0.1);
    for (let i = 0; i < bsN; i++) {
      const a = r2() * Math.PI * 2;
      const y = -0.88 - r2() * 0.45;
      const r = 0.16 + r2() * 0.08;
      pts.push([Math.cos(a) * r + 0.05, y, Math.sin(a) * r * 0.8]);
    }

    const S = 2.1;
    return pts.map(p => [p[0] * S, p[1] * S, p[2] * S]);
  }

  const COUNT = 1300;
  const targets = buildBrain(COUNT);
  const N = targets.length;

  /* Scattered home positions (hollow shell) */
  const homes = [];
  for (let i = 0; i < N; i++) {
    const th = rnd() * Math.PI * 2;
    const ph = Math.acos(1 - 2 * rnd());
    const sp = Math.sin(ph);
    const r = 1.3 + rnd() * 1.9;
    homes.push([r * sp * Math.cos(th), r * sp * Math.sin(th) * 0.9, r * Math.cos(ph) * 0.9]);
  }

  /* Edges: proximity graph computed in target (brain) space */
  function buildEdges(pts, thresh, maxN) {
    const cell = thresh;
    const grid = new Map();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const k = Math.floor(p[0] / cell) + ',' + Math.floor(p[1] / cell) + ',' + Math.floor(p[2] / cell);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
    const edges = [];
    const deg = new Uint8Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let oz = -1; oz <= 1; oz++) {
            const b = grid.get((cx + ox) + ',' + (cy + oy) + ',' + (cz + oz));
            if (!b) continue;
            for (const j of b) {
              if (j <= i || deg[i] >= maxN) continue;
              const dx = pts[j][0] - p[0], dy = pts[j][1] - p[1], dz = pts[j][2] - p[2];
              if (dx * dx + dy * dy + dz * dz < thresh * thresh) {
                deg[i]++; deg[j]++;
                edges.push(i, j);
              }
            }
          }
        }
      }
    }
    return edges;
  }
  const edgePairs = buildEdges(targets, 0.55, 3);

  /* ---------------- Network group ---------------- */
  const netGroup = new THREE.Group();

  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(N * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const pCol = new Float32Array(N * 3);
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pMat = new THREE.PointsMaterial({
    size: 0.09,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false
  });
  const points = new THREE.Points(pGeo, pMat);
  netGroup.add(points);

  const eGeo = new THREE.BufferGeometry();
  const ePos = new Float32Array(edgePairs.length * 3);
  eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
  const eMat = new THREE.LineBasicMaterial({
    color: 0x7c5cff,
    transparent: true,
    opacity: 0.2,
    depthWrite: false
  });
  const edges = new THREE.LineSegments(eGeo, eMat);
  netGroup.add(edges);

  scene.add(netGroup);

  /* Per-particle colour gradient by height (cyan to purple) */
  let minY = Infinity, maxY = -Infinity;
  for (const p of targets) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const colA = new THREE.Color(0x22d3ee);
  const colB = new THREE.Color(0x7c5cff);
  const formedColors = targets.map(p => colA.clone().lerp(colB, (p[1] - minY) / (maxY - minY)));
  const dimColor = new THREE.Color(0x141a33);
  const tmpCol = new THREE.Color();

  const delays = [], durs = [], phasesP = [];
  for (let i = 0; i < N; i++) {
    delays.push(rnd() * 0.45);
    durs.push(0.4 + rnd() * 0.6);
    phasesP.push(rnd() * Math.PI * 2);
  }

  /* Ambient background particles */
  const ACOUNT = 260;
  const aPos = new Float32Array(ACOUNT * 3);
  for (let i = 0; i < ACOUNT * 3; i += 3) {
    const r = 5 + Math.random() * 6;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    aPos[i] = r * Math.sin(ph) * Math.cos(th);
    aPos[i + 1] = r * Math.sin(ph) * Math.sin(th);
    aPos[i + 2] = r * Math.cos(ph);
  }
  const aGeo = new THREE.BufferGeometry();
  aGeo.setAttribute('position', new THREE.BufferAttribute(aPos, 3));
  const aMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.04,
    transparent: true,
    opacity: 0.35,
    depthWrite: false
  });
  const ambient = new THREE.Points(aGeo, aMat);
  scene.add(ambient);

  /* Per-phase keyframes: [camZ, spinSpeed] */
  const KEYFRAMES = [
    { cam: 8.6, spd: 0.10 },
    { cam: 8.3, spd: 0.13 },
    { cam: 8.0, spd: 0.16 },
    { cam: 7.8, spd: 0.20 }
  ];

  /* ---------------- Scroll scrub state ---------------- */
  const phases = Array.from(document.querySelectorAll('.phase'));
  const progressBar = document.querySelector('.hero-progress-bar');
  const progressCount = document.querySelector('.hero-progress-count');
  let target = 0;
  let smooth = 0;

  function updateScroll() {
    const max = hero.offsetHeight - window.innerHeight;
    target = max > 0 ? Math.min(Math.max(window.scrollY / max, 0), 1) : 0;
  }

  window.addEventListener('scroll', updateScroll, { passive: true });
  window.addEventListener('resize', () => {
    width = window.innerWidth;
    height = window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    layoutSprites();
    updateScroll();
  });

  window.addEventListener('mousemove', (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
  });

  updateScroll();
  layoutSprites();

  /* ---------------- Animation loop ---------------- */
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(x) { return x * x * (3 - 2 * x); }

  function layoutSprites() {
    const compact = width < 760;
    formulaSprites.forEach((s, i) => {
      const x = compact ? (i % 2 === 0 ? 3.0 : -3.0) : spritePos[i].x;
      const y = compact ? (i % 2 === 0 ? 2.1 : -2.1) : spritePos[i].y;
      s.position.x = x;
      s.position.y = y;
      s.userData.baseY = y;
      const h = compact ? 1.1 : 1.4;
      const a = s.userData.aspect || 1.4;
      s.scale.set(Math.min(4.6, h * a), h, 1);
    });
  }

  function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    const dt = 1 / 60;

    smooth = lerp(smooth, target, 1 - Math.pow(0.001, dt));

    const p = smooth;
    const nPhases = KEYFRAMES.length;
    const idx = Math.min(Math.floor(p * nPhases), nPhases - 1);
    const frac = p * nPhases - idx;
    const a = KEYFRAMES[idx];
    const b = KEYFRAMES[Math.min(idx + 1, nPhases - 1)];
    const spd = lerp(a.spd, b.spd, frac);

    const mix = Math.min(1, p * 1.15);

    /* Morph particles from scattered shell into brain */
    const pos = pGeo.attributes.position;
    const col = pGeo.attributes.color;
    for (let i = 0; i < N; i++) {
      const raw = smoothstep(Math.max(0, Math.min(1, (mix - delays[i]) / durs[i])));
      const hx = homes[i][0], hy = homes[i][1], hz = homes[i][2];
      const tx = targets[i][0], ty = targets[i][1], tz = targets[i][2];
      const amp = 0.03 + (1 - raw) * 0.12;
      pos.setXYZ(i,
        lerp(hx, tx, raw) + Math.sin(t * 0.9 + phasesP[i]) * amp,
        lerp(hy, ty, raw) + Math.cos(t * 0.8 + phasesP[i] * 1.3) * amp,
        lerp(hz, tz, raw) + Math.sin(t * 1.1 + phasesP[i] * 0.7) * amp
      );
      tmpCol.copy(dimColor).lerp(formedColors[i], raw);
      col.setXYZ(i, tmpCol.r, tmpCol.g, tmpCol.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;

    /* Network edges follow their particle pairs */
    const ep = eGeo.attributes.position;
    for (let e = 0; e < edgePairs.length; e += 2) {
      const i = edgePairs[e], j = edgePairs[e + 1];
      ep.setXYZ(e, pos.getX(i), pos.getY(i), pos.getZ(i));
      ep.setXYZ(e + 1, pos.getX(j), pos.getY(j), pos.getZ(j));
    }
    ep.needsUpdate = true;
    eMat.opacity = 0.06 + mix * 0.3;

    netGroup.rotation.y += spd * dt;
    netGroup.rotation.x = Math.sin(t * 0.2) * 0.05;

    /* Formula sprite: only the active phase's formula is shown */
    formulaSprites.forEach((spr, k) => {
      spr.material.opacity = k === idx ? 1 : 0;
      spr.position.y = spr.userData.baseY + Math.sin(t * 0.8 + k) * 0.2;
    });

    /* Phase HTML: instant switch, only one phase visible at a time */
    phases.forEach((el, k) => {
      const on = k === idx;
      el.classList.toggle('active', on);
      el.style.pointerEvents = on ? 'auto' : 'none';
    });

    /* Progress indicator */
    const curPhase = Math.min(idx + 1, nPhases);
    progressBar.style.transform = `scaleY(${p.toFixed(3)})`;
    progressCount.textContent = String(curPhase).padStart(2, '0');

    /* Mouse parallax */
    camera.position.x = lerp(camera.position.x, mouse.x * 0.6, 0.04);
    camera.position.y = lerp(camera.position.y, -mouse.y * 0.4, 0.04);
    camera.position.z = lerp(camera.position.z, lerp(a.cam, b.cam, frac), 0.06);
    camera.lookAt(0, 0, 0);

    ambient.rotation.y = t * 0.03;
    ambient.rotation.x = Math.sin(t * 0.05) * 0.08;

    renderer.render(scene, camera);
  }

  animate();
})();

/* ============ LOADER ============ */
(() => {
  const loader = document.getElementById('loader');
  window.addEventListener('load', () => {
    setTimeout(() => loader.classList.add('hidden'), 600);
  });
  setTimeout(() => loader.classList.add('hidden'), 3500);
})();

/* ============ NAV ============ */
(() => {
  const nav = document.querySelector('.nav');
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');

  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });

  toggle.addEventListener('click', () => {
    toggle.classList.toggle('open');
    links.classList.toggle('open');
  });

  links.querySelectorAll('a').forEach((a) =>
    a.addEventListener('click', () => {
      toggle.classList.remove('open');
      links.classList.remove('open');
    })
  );
})();

/* ============ SCROLL REVEAL ============ */
(() => {
  const reveals = document.querySelectorAll('.reveal');
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );
  reveals.forEach((el) => io.observe(el));
})();
