import { geoOrthographic, geoPath } from "./d3-geo.js"
import LAND from "./land.js"

// Hero globe: a glass Earth with twinkling city lights and short light trails between cities,
// circled by the areas a CTO owns. It rests on Singapore; drag to spin with inertia; a click (or Enter)
// drops a pin with an example question. Everything here is illustrative, not collected data.

const D = Math.PI / 180
const NS = "http://www.w3.org/2000/svg"
const HEADROOM = 1.6 // the canvas is 1.6x the globe so trails can rise past its edge
const RING = { cx: 50, cy: 50, rx: 46, ry: 12.5, tilt: -12 }
const NAMES = [ "Architecture", "AI Agents", "Hiring", "Roadmap", "Security", "Cloud", "Vendors", "Data", "Due Diligence", "Delivery" ]
const QUESTIONS = [
  "why does our vendor keep missing deadlines?", "is our codebase ready for due diligence?", "should we build this or buy it?",
  "who should our first engineering hire be?", "how do we get our AI pilot into production?", "what will our tech debt cost to fix?",
  "are our systems ready for a PDPA review?", "do we need a full-time CTO yet?", "can this platform handle 10x growth?",
  "where can we cut our cloud bill?", "is our roadmap tied to revenue?", "can we trust this offshore team's code?"
]
const REST_YAW = -104 * D, REST_PITCH = 8 * D, SWAY = 26 * D // Singapore faces the viewer at rest
// [longitude, latitude, weight] for business hubs; weight sets how many lights cluster around each.
const HUBS = [
  [ -74, 40.7, 6 ], [ -122.4, 37.8, 5 ], [ -118.2, 34.1, 5 ], [ -87.6, 41.9, 4 ], [ -97.7, 30.3, 3 ], [ -96.8, 32.8, 3 ], [ -95.4, 29.8, 3 ],
  [ -84.4, 33.7, 3 ], [ -80.2, 25.8, 3 ], [ -71.1, 42.4, 4 ], [ -77, 38.9, 4 ], [ -122.3, 47.6, 4 ], [ -104.9, 39.7, 3 ], [ -112.1, 33.4, 2 ],
  [ -93.3, 44.9, 2 ], [ -111.9, 40.8, 2 ], [ -79.4, 43.7, 4 ], [ -73.6, 45.5, 2 ], [ -123.1, 49.3, 2 ], [ -99.1, 19.4, 3 ], [ -46.6, -23.5, 3 ],
  [ -58.4, -34.6, 2 ], [ -70.6, -33.4, 1 ], [ -74.1, 4.7, 1 ], [ -0.1, 51.5, 5 ], [ 13.4, 52.5, 3 ], [ 2.35, 48.9, 4 ], [ 4.9, 52.4, 3 ],
  [ 18.1, 59.3, 2 ], [ -3.7, 40.4, 2 ], [ 12.5, 41.9, 2 ], [ -6.3, 53.3, 2 ], [ 21, 52.2, 2 ], [ 8.5, 47.4, 2 ], [ 103.8, 1.35, 6 ], [ 101.7, 3.1, 3 ], [ 100.5, 13.8, 3 ], [ 106.7, 10.8, 3 ], [ 105.8, 21, 2 ], [ 112.7, -7.3, 1 ],
  [ 151.2, -33.9, 3 ], [ 144.9, -37.8, 2 ], [ 139.7, 35.7, 4 ], [ 127, 37.6, 3 ], [ 121.5, 31.2, 4 ], [ 116.4, 39.9, 3 ], [ 114.2, 22.3, 3 ],
  [ 77.6, 12.97, 3 ], [ 72.9, 19.1, 3 ], [ 77.2, 28.6, 3 ], [ 55.3, 25.2, 2 ], [ 106.8, -6.2, 2 ], [ 121, 14.6, 2 ], [ 3.4, 6.5, 2 ],
  [ 36.8, -1.3, 1 ], [ 18.4, -33.9, 1 ], [ 28, -26.2, 1 ], [ 174.8, -36.8, 1 ]
]

const vec = (lon, lat) => { lon *= D; lat *= D; return [ Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon) ] }
const pick = list => list[Math.floor(Math.random() * list.length)]
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])))
const rgba = (hex, a) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "")
  if (!m) return `rgba(255,255,255,${a})`
  const n = parseInt(m[1], 16)
  return `rgba(${n >> 16},${n >> 8 & 255},${n & 255},${a})`
}

const HOME = vec(103.8, 1.35)
const CITIES = HUBS.map(([ lon, lat ]) => vec(lon, lat))
const LIGHTS = (() => {
  const out = []
  let s = 7
  const r = () => (s = s * 16807 % 2147483647) / 2147483647
  for (const [ lon, lat, w ] of HUBS) {
    for (let k = 0; k < w * 16; k++) {
      const d = Math.sqrt(-2 * Math.log(r() + 1e-9)) * (1.2 + w * .45), th = r() * Math.PI * 2
      out.push(...vec(lon + d * Math.cos(th) / Math.max(.3, Math.cos(lat * D)), lat + d * Math.sin(th)), r() * 6.28, r() < .35 ? 1 : 0)
    }
  }
  return new Float32Array(out)
})()

export function mountGlobe(stage) {
  const globeEl = stage.querySelector(".globe"), canvas = stage.querySelector("canvas")
  const ctx = canvas?.getContext("2d")
  if (!ctx) return
  const reduce = matchMedia("(prefers-reduced-motion: reduce)")
  const proj = geoOrthographic().clipAngle(90).precision(.4)

  // Orbit ring, chips and dust, depth-sorted around the globe.
  const point = (r, a, spread) => {
    const t = r.tilt * D, x = r.rx * Math.cos(a), y = r.ry * Math.sin(a)
    return { x: r.cx + (x * Math.cos(t) - y * Math.sin(t)) * spread, y: r.cy + (x * Math.sin(t) + y * Math.cos(t)) * spread, depth: Math.sin(a) }
  }
  const ringSvg = (cls, from, to) => {
    const svg = document.createElementNS(NS, "svg")
    svg.setAttribute("class", `ring ${cls}`); svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("aria-hidden", "true")
    const p = []
    for (let i = 0; i <= 60; i++) { const q = point(RING, from + (to - from) * i / 60, 1); p.push(`${q.x.toFixed(2)} ${q.y.toFixed(2)}`) }
    const path = document.createElementNS(NS, "path"); path.setAttribute("d", `M${p.join(" L")}`); svg.append(path)
    return svg
  }
  stage.prepend(ringSvg("back", Math.PI, 2 * Math.PI))
  stage.append(ringSvg("front", 0, Math.PI))
  const items = NAMES.map((label, i) => ({ label, ring: RING, phase: i * Math.PI * 2 / NAMES.length + .4, speed: Math.PI * 2 / 28 }))
  let seed = 11
  const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647
  for (let i = 0; i < 12; i++) {
    const k = .72 + rnd() * .45
    items.push({ ring: { ...RING, rx: RING.rx * k, ry: RING.ry * (.6 + rnd() * 1.2), tilt: RING.tilt + (rnd() - .5) * 20 }, phase: rnd() * Math.PI * 2,
      speed: Math.PI * 2 / (12 + rnd() * 18) * (rnd() > .85 ? -1 : 1), size: 3 + rnd() * 3.5 })
  }
  for (const it of items) {
    it.el = document.createElement("span"); it.el.setAttribute("aria-hidden", "true")
    if (it.label) { it.el.className = "chip"; it.el.textContent = it.label }
    else { it.el.className = "dust"; it.el.style.width = it.el.style.height = `${it.size.toFixed(1)}px` }
    stage.append(it.el)
  }
  const chips = items.filter(i => i.label)

  let yaw = REST_YAW, pitch = REST_PITCH, vYaw = 0, vPitch = 0, dragging = null, hovering = false
  let time = 0, boost = 1, targetBoost = 1, spread = 1, targetSpread = 1, last = performance.now()
  let colors = {}, size = 0, dpr = 1, nextArc = 0, frame = 0, onScreen = true
  const pins = [], arcs = []

  function project(x, y, z) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch)
    const x1 = x * cy + z * sy, z1 = -x * sy + z * cy
    return [ x1, y * cp - z1 * sp, y * sp + z1 * cp ]
  }
  function unproject(px, py) {
    const h = size / 2, r = h / HEADROOM * .985, x1 = (px - h) / r, y2 = -(py - h) / r, d = x1 * x1 + y2 * y2
    if (d > 1) return null
    const z2 = Math.sqrt(1 - d), cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch)
    const y = y2 * cp + z2 * sp, z1 = -y2 * sp + z2 * cp
    return [ x1 * cy - z1 * sy, y, x1 * sy + z1 * cy ]
  }

  // Light trails: a bright head runs along a raised great-circle arc, its tail drains after it,
  // and the landing point pulses once.
  function launch(a, b, now) {
    const ang = angle(a, b)
    if (ang < .05) return
    arcs.push({ a, b, ang, born: now, dur: 700 + ang * 650, lift: Math.min(.1, .025 + ang * .1) })
    if (arcs.length > 48) arcs.shift()
  }
  function autoLaunch(now) {
    const front = CITIES.filter(v => project(...v)[2] > .2)
    if (front.length < 2) return
    if (project(...HOME)[2] > .1 && Math.random() < .4) { launch(HOME, pick(front), now); return }
    const a = pick(front)
    if (Math.random() < .7) {
      const near = CITIES.filter(v => v !== a && angle(a, v) < .45)
      if (near.length) { launch(a, pick(near), now); return }
    }
    const targets = CITIES.filter(v => v !== a && angle(a, v) > .3 && project(...v)[2] > -.25)
    const count = Math.random() < .3 ? 3 + Math.floor(Math.random() * 2) : 1
    for (let k = 0; k < count && targets.length; k++) launch(a, targets.splice(Math.floor(Math.random() * targets.length), 1)[0], now + k * 110)
  }
  function along(A, s) {
    const sn = Math.sin(A.ang), k1 = Math.sin((1 - s) * A.ang) / sn, k2 = Math.sin(s * A.ang) / sn, h = 1 + A.lift * Math.sin(Math.PI * s)
    return project((A.a[0] * k1 + A.b[0] * k2) * h, (A.a[1] * k1 + A.b[1] * k2) * h, (A.a[2] * k1 + A.b[2] * k2) * h)
  }
  // A raised point is hidden only when it is behind the globe and inside its outline.
  const shown = p => p[2] > 0 || p[0] * p[0] + p[1] * p[1] > 1

  function drawGlobe(c, R, now) {
    const disc = () => { ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2) }
    let g = ctx.createRadialGradient(c - R * .3, c - R * .38, R * .05, c, c, R)
    g.addColorStop(0, colors.hi); g.addColorStop(1, colors.lo); ctx.fillStyle = g; disc(); ctx.fill()
    proj.translate([ c, c ]).scale(R).rotate([ yaw / D, -pitch / D ])
    ctx.beginPath(); geoPath(proj, ctx)(LAND)
    ctx.globalAlpha = .82; ctx.fillStyle = colors.land; ctx.fill()
    ctx.globalAlpha = .75; ctx.lineWidth = 1.1 * dpr; ctx.strokeStyle = colors.coast; ctx.stroke()
    ctx.globalAlpha = 1
    // Limb darkening, a bright fresnel rim and a soft specular highlight make it read as glass.
    g = ctx.createRadialGradient(c, c, R * .55, c, c, R)
    g.addColorStop(0, "rgba(10,25,45,0)"); g.addColorStop(1, "rgba(10,25,45,.22)"); ctx.fillStyle = g; disc(); ctx.fill()
    g = ctx.createRadialGradient(c, c, R * .86, c, c, R)
    g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(1, `rgba(255,255,255,${colors.glass * .55})`); ctx.fillStyle = g; disc(); ctx.fill()
    g = ctx.createRadialGradient(c - R * .4, c - R * .48, 0, c - R * .4, c - R * .48, R * .55)
    g.addColorStop(0, `rgba(255,255,255,${colors.glass * .55})`); g.addColorStop(1, "rgba(255,255,255,0)"); ctx.fillStyle = g; disc(); ctx.fill()
    // City lights, twinkling, brighter toward the viewer; batched into three alpha buckets per tone.
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), t = reduce.matches ? 0 : now / 1000
    for (let tone = 0; tone < 2; tone++) {
      ctx.fillStyle = tone ? colors.arc : "#FFF7E6"
      for (let b = 0; b < 3; b++) {
        ctx.globalAlpha = [ .35, .65, 1 ][b]; ctx.beginPath()
        for (let i = 0; i < LIGHTS.length; i += 5) {
          if (LIGHTS[i + 4] !== tone) continue
          const x = LIGHTS[i], y = LIGHTS[i + 1], z = LIGHTS[i + 2]
          const x1 = x * cy + z * sy, z1 = -x * sy + z * cy, z2 = y * sp + z1 * cp
          if (z2 <= .05) continue
          const tw = (.5 + .5 * Math.sin(t * 2.2 + LIGHTS[i + 3])) * Math.min(1, z2 * 1.6), bucket = tw < .34 ? 0 : tw < .67 ? 1 : 2
          if (bucket !== b) continue
          const px = c + x1 * R, py = c - (y * cp - z1 * sp) * R, r = (.7 + .7 * tw) * dpr
          ctx.moveTo(px + r, py); ctx.arc(px, py, r, 0, Math.PI * 2)
        }
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }

  function drawArcs(now, c, R) {
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round"
    const dot = (p, r) => { ctx.beginPath(); ctx.arc(c + p[0] * R, c - p[1] * R, r * dpr, 0, Math.PI * 2); ctx.fill() }
    for (let i = arcs.length - 1; i >= 0; i--) {
      const A = arcs[i], t = (now - A.born) / A.dur
      if (t > 1.9) { arcs.splice(i, 1); continue }
      if (t < 0) continue
      const head = Math.min(1, t), tail = Math.max(0, Math.min(1, t - .55)), N = 32
      if (head > tail) {
        const pts = []
        for (let j = 0; j <= N; j++) pts.push(along(A, tail + (head - tail) * j / N))
        const p0 = pts[0], pN = pts[N]
        const stroke = (color, alpha, width) => {
          const gr = ctx.createLinearGradient(c + p0[0] * R, c - p0[1] * R, c + pN[0] * R, c - pN[1] * R)
          gr.addColorStop(0, rgba(color, 0)); gr.addColorStop(1, rgba(color, alpha))
          ctx.strokeStyle = gr; ctx.lineWidth = width * dpr; ctx.beginPath()
          let pen = false
          for (const p of pts) {
            if (!shown(p)) { pen = false; continue }
            if (pen) ctx.lineTo(c + p[0] * R, c - p[1] * R); else ctx.moveTo(c + p[0] * R, c - p[1] * R)
            pen = true
          }
          ctx.stroke()
        }
        stroke(colors.arc, .35, 3)
        stroke(colors.core, 1, .9)
        if (t < 1 && shown(pN)) { ctx.fillStyle = colors.core; ctx.shadowColor = colors.arc; ctx.shadowBlur = 10 * dpr; dot(pN, 1.8); ctx.shadowBlur = 0 }
      }
      const to = project(...A.b)
      if (t > 1 && to[2] > 0) {
        const k = Math.min(1, (t - 1) / .9)
        ctx.globalAlpha = 1 - k; ctx.fillStyle = colors.core; ctx.shadowColor = colors.arc; ctx.shadowBlur = 8 * dpr; dot(to, 1.8); ctx.shadowBlur = 0
        if (A.ang > .4) {
          ctx.strokeStyle = colors.arc; ctx.lineWidth = dpr; ctx.globalAlpha = (1 - k) * .6
          ctx.beginPath(); ctx.arc(c + to[0] * R, c - to[1] * R, (3 + k * 16) * dpr, 0, Math.PI * 2); ctx.stroke()
        }
        ctx.globalAlpha = 1
      }
    }
    ctx.restore()
  }

  // Singapore: a steady pulse and a label, always on while it faces the viewer.
  function drawHome(now, c, R) {
    const [ x1, y2, z2 ] = project(...HOME), px = c + x1 * R, py = c - y2 * R
    if (z2 <= .05) return
    ctx.strokeStyle = colors.arc; ctx.lineWidth = 1.5 * dpr
    const pulses = reduce.matches ? 1 : 2
    for (let k = 0; k < pulses; k++) {
      const t = reduce.matches ? .4 : ((now / 1000 + k) % 2) / 2
      ctx.globalAlpha = (1 - t) * .9; ctx.beginPath(); ctx.arc(px, py, (4 + t * 24) * dpr, 0, Math.PI * 2); ctx.stroke()
    }
    ctx.globalAlpha = 1; ctx.fillStyle = colors.core; ctx.shadowColor = colors.arc; ctx.shadowBlur = 12 * dpr
    ctx.beginPath(); ctx.arc(px, py, 4 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0
    ctx.font = `600 ${13 * dpr}px Inter, system-ui, sans-serif`; ctx.fillStyle = colors.label; ctx.textBaseline = "middle"
    ctx.lineWidth = 4 * dpr; ctx.lineJoin = "round"; ctx.strokeStyle = colors.lo; ctx.strokeText("Singapore", px + 14 * dpr, py)
    ctx.fillText("Singapore", px + 14 * dpr, py)
  }

  // Pins: a dot with two expanding rings, plus a question bubble positioned in stage space.
  function drawPins(now, c, R) {
    for (let i = pins.length - 1; i >= 0; i--) {
      const p = pins[i], age = (now - p.born) / 1000
      if (age > 4.2) { p.bubble.remove(); pins.splice(i, 1); continue }
      const [ x1, y2, z2 ] = project(...p.v), px = c + x1 * R, py = c - y2 * R, visible = z2 > .05
      p.bubble.style.opacity = visible && age < 3.6 ? 1 : 0
      p.bubble.style.left = `${((globeEl.offsetLeft + canvas.offsetLeft + px / dpr) / stage.clientWidth * 100).toFixed(2)}%`
      p.bubble.style.top = `${((globeEl.offsetTop + canvas.offsetTop + py / dpr) / stage.clientHeight * 100).toFixed(2)}%`
      if (!visible) continue
      ctx.fillStyle = colors.accent; ctx.strokeStyle = colors.accent; ctx.lineWidth = 1.5 * dpr
      for (let k = 0; k < 2; k++) {
        const t = ((age + k * .6) % 1.2) / 1.2
        ctx.globalAlpha = (1 - t) * .8; ctx.beginPath(); ctx.arc(px, py, (4 + t * 22) * dpr, 0, Math.PI * 2); ctx.stroke()
      }
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(px, py, 4 * dpr, 0, Math.PI * 2); ctx.fill()
    }
  }

  function draw(now) {
    if (!size) return
    const W = canvas.width, R = W / 2 / HEADROOM * .985, c = W / 2
    ctx.clearRect(0, 0, W, W)
    drawGlobe(c, R, now)
    drawArcs(now, c, R)
    drawHome(now, c, R)
    drawPins(now, c, R)
  }

  function placeOrbit() {
    for (const it of items) {
      const p = point(it.ring, it.phase + time * it.speed, spread), s = .7 + .3 * (p.depth + 1) / 2
      it.el.style.left = `${p.x.toFixed(2)}%`; it.el.style.top = `${p.y.toFixed(2)}%`; it.el.style.zIndex = p.depth > 0 ? 4 : 0
      it.el.style.transform = `translate(-50%,-50%) scale(${s.toFixed(3)})`
      it.el.style.opacity = (it.label ? (p.depth > 0 ? 1 : .5 + .5 * (p.depth + 1)) : .25 + .6 * (p.depth + 1) / 2).toFixed(2)
    }
  }

  function tick(now) {
    frame = 0
    const dt = Math.min(.05, (now - last) / 1000); last = now
    boost += (targetBoost - boost) * .06; spread += (targetSpread - spread) * .1
    if (!dragging) {
      yaw += vYaw * dt; pitch += vPitch * dt
      vYaw *= Math.pow(.04, dt); vPitch *= Math.pow(.04, dt)
      if (!reduce.matches && !hovering) { // sway around Singapore, drifting back after a drag
        const target = REST_YAW + SWAY * Math.sin(now / 1000 * Math.PI * 2 / 36), off = target - yaw
        yaw += Math.atan2(Math.sin(off), Math.cos(off)) * (1 - Math.pow(.6, dt))
        pitch += (REST_PITCH - pitch) * (1 - Math.pow(.5, dt))
      }
    }
    pitch = Math.max(-60 * D, Math.min(60 * D, pitch))
    if (!reduce.matches) time += dt * boost
    if (!reduce.matches && now > nextArc) { autoLaunch(now); nextArc = now + 70 + Math.random() * 140 }
    placeOrbit(); draw(now)
    schedule()
  }
  // Only animate while the hero is visible and the tab is in the foreground.
  function schedule() {
    if (!frame && onScreen && !document.hidden) frame = requestAnimationFrame(tick)
  }
  const wake = () => { last = performance.now(); schedule() }

  function addPin(v) {
    const bubble = document.createElement("div"); bubble.className = "ask"; bubble.setAttribute("role", "status")
    const label = document.createElement("small"); label.textContent = "A founder asks"
    bubble.append(label, `“${pick(QUESTIONS)}”`)
    stage.append(bubble)
    const now = performance.now()
    pins.push({ v, born: now, bubble })
    for (let k = 0; k < 5; k++) launch(v, pick(CITIES), now + k * 90)
    if (pins.length > 3) pins.shift().bubble.remove()
    const chip = pick(chips).el
    chip.classList.add("lit"); setTimeout(() => chip.classList.remove("lit"), 1600)
    targetBoost = 3.5; setTimeout(() => { targetBoost = 1 }, 600)
    wake()
  }

  canvas.addEventListener("pointerenter", () => { hovering = true })
  canvas.addEventListener("pointerleave", () => { hovering = false })
  canvas.addEventListener("pointerdown", e => {
    canvas.setPointerCapture(e.pointerId)
    dragging = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() }; vYaw = vPitch = 0
  })
  canvas.addEventListener("pointermove", e => {
    if (!dragging) return
    const now = performance.now(), dt = Math.max(1, now - dragging.t) / 1000, k = HEADROOM / (size || 300) * Math.PI
    const dYaw = (e.clientX - dragging.x) * k, dPitch = (e.clientY - dragging.y) * k
    yaw += dYaw; pitch += dPitch; vYaw = dYaw / dt; vPitch = dPitch / dt
    dragging.x = e.clientX; dragging.y = e.clientY; dragging.t = now
    wake()
  })
  const end = e => {
    if (!dragging) return
    const moved = Math.hypot(e.clientX - dragging.sx, e.clientY - dragging.sy)
    if (performance.now() - dragging.t > 80) vYaw = vPitch = 0
    vYaw = Math.max(-6, Math.min(6, vYaw)); vPitch = Math.max(-3, Math.min(3, vPitch))
    if (moved < 5 && e.type === "pointerup") {
      const b = canvas.getBoundingClientRect(), v = unproject(e.clientX - b.left, e.clientY - b.top)
      if (v) addPin(v)
    }
    dragging = null
  }
  canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end)
  canvas.addEventListener("keydown", e => {
    const step = 12 * D
    if (e.key === "ArrowLeft") yaw -= step
    else if (e.key === "ArrowRight") yaw += step
    else if (e.key === "ArrowUp") pitch -= step
    else if (e.key === "ArrowDown") pitch += step
    else if (e.key === "Enter" || e.key === " ") { const v = unproject(size / 2, size / 2); if (v) addPin(v) }
    else return
    e.preventDefault(); wake()
  })
  // Email buttons speed the orbit up a little while hovered or focused.
  document.querySelectorAll(".js-boost").forEach(a => {
    const on = () => { targetBoost = 3; targetSpread = 1.05 }, off = () => { targetBoost = 1; targetSpread = 1 }
    a.addEventListener("pointerenter", on); a.addEventListener("focus", on); a.addEventListener("pointerleave", off); a.addEventListener("blur", off)
  })

  const css = getComputedStyle(stage), v = n => css.getPropertyValue(n).trim()
  colors = { hi: v("--sea-hi"), lo: v("--sea-lo"), land: v("--land"), accent: v("--accent"), arc: v("--arc"), core: v("--arc-core") || v("--arc"), coast: v("--coast"), label: v("--label"), glass: parseFloat(v("--glass")) || 1 }
  const resize = () => {
    size = canvas.clientWidth; dpr = Math.min(size > 800 ? 1.5 : 2, devicePixelRatio || 1) // big background globe: cap pixels drawn per frame
    canvas.width = Math.round(size * dpr); canvas.height = Math.round(size * dpr)
    if (!frame) draw(performance.now())
  }
  new ResizeObserver(resize).observe(canvas)
  new IntersectionObserver(([ entry ]) => { onScreen = entry.isIntersecting; if (onScreen) wake() }).observe(stage)
  document.addEventListener("visibilitychange", wake)
  stage.dataset.ready = "true"
  resize(); placeOrbit(); schedule()
}
