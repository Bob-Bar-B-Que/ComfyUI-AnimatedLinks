import { app } from "../../scripts/app.js";

// ─────────────────────────────────────────────
//  Animated Links for ComfyUI  (v2.0)
//
//  Strategy (works across old and new frontends):
//   1. Record real link geometry by wrapping LGraphCanvas.prototype.renderLink
//      (the hook modern link extensions use). If a linkRenderer adapter with
//      renderLinkDirect exists, it is wrapped as a secondary source.
//   2. If a hovered link was NOT recorded this frame, compute its geometry
//      directly from the nodes' slot positions (fallback).
//   3. Draw the animation right after drawConnections, in graph space.
//
//  Debug: type  AnimatedLinks.debug()  in the browser console.
// ─────────────────────────────────────────────

const CONFIG = {
  arrowSize: 7,        // triangle size
  arrowSpacing: 120,   // min distance between triangles (graph px)
  dotSpeed: 0.0008,
  rainbow: true,
  fixedColor: "#00cfff",
  glowWidth: 8,
  glowBlur: 18,
};

const PATCHED = Symbol.for("AnimatedLinks.patched.v2");

let phase = 0;
let pulsePhase = 0;
let hoveredLinkIds = [];   // original link ids (number or string)
let highlightedNodes = []; // {node, type: 'set'|'get'}

// String(link.id) -> [{ start, end, cp1, cp2 }], rebuilt every drawConnections pass.
const linkSegments = new Map();

let renderLinkDepth = 0;   // re-entrancy guard, so a segment isn't recorded twice

const stats = {
  hookRenderLink: false,
  hookAdapter: false,
  hookDrawConnections: false,
  recordedLastFrame: 0,
  fallbackUsed: 0,
  overlayDraws: 0,
  hoveredNode: null,
  lastError: null,
};

app.registerExtension({
  name: "AnimatedLinks.NodeHover",

  async setup() {
    await waitForCanvas();
    const canvas = app.canvas;
    if (!canvas) {
      console.warn("[AnimatedLinks] canvas not available, extension disabled");
      return;
    }

    patchRenderLink(canvas);
    patchAdapter(canvas);
    patchDrawConnections(canvas);
    bindHoverEvents(canvas);
    startLoop(canvas);

    window.AnimatedLinks = {
      config: CONFIG,
      stats,
      debug() {
        const info = {
          ...stats,
          hoveredLinkIds: [...hoveredLinkIds],
          segmentsKnown: linkSegments.size,
          linksRenderMode: app.canvas?.links_render_mode,
          canvasProtoHasRenderLink: !!findOwner(app.canvas, "renderLink"),
          adapterPresent: !!app.canvas?.linkRenderer,
        };
        console.table(info);
        return info;
      },
    };

    console.log(
      "[AnimatedLinks] v2.0 initialized",
      { renderLink: stats.hookRenderLink, adapter: stats.hookAdapter, drawConnections: stats.hookDrawConnections }
    );
    if (!stats.hookDrawConnections) {
      console.warn("[AnimatedLinks] drawConnections could not be hooked - nothing will be drawn. Run AnimatedLinks.debug()");
    }
  },
});

// ───────────── patching ─────────────

// Finds the object in the prototype chain that actually owns a method.
function findOwner(obj, name) {
  let o = obj;
  while (o) {
    const d = Object.getOwnPropertyDescriptor(o, name);
    if (d && typeof d.value === "function") return o;
    o = Object.getPrototypeOf(o);
  }
  return null;
}

// Primary geometry source: LGraphCanvas.renderLink
// (ctx, a, b, link, skip_border, flow, color, start_dir, end_dir, extras?)
function patchRenderLink(canvas) {
  const owner = findOwner(canvas, "renderLink");
  if (!owner) return;
  const orig = owner.renderLink;
  if (orig[PATCHED]) { stats.hookRenderLink = true; return; }

  const patched = function (...args) {
    try {
      recordLinkSegment(args);
    } catch (err) {
      warnOnce("recordRenderLink", err); // never break ComfyUI's own rendering
    }
    renderLinkDepth++;
    try {
      return orig.apply(this, args);
    } finally {
      renderLinkDepth--;
    }
  };
  patched[PATCHED] = true;
  owner.renderLink = patched;
  stats.hookRenderLink = true;
}

// Secondary source: link renderer adapter (some frontend versions only).
// Called again periodically because the adapter can be re-created.
function patchAdapter(canvas) {
  const adapter = canvas.linkRenderer;
  if (!adapter) return;
  const owner = findOwner(adapter, "renderLinkDirect");
  if (!owner) return;
  const orig = owner.renderLinkDirect;
  if (orig[PATCHED]) { stats.hookAdapter = true; return; }

  const patched = function (...args) {
    // If renderLink already recorded this call, don't record twice.
    if (renderLinkDepth === 0) {
      try {
        recordLinkSegment(args);
      } catch (err) {
        warnOnce("recordAdapter", err);
      }
    }
    return orig.apply(this, args);
  };
  patched[PATCHED] = true;
  owner.renderLinkDirect = patched;
  stats.hookAdapter = true;
}

function patchDrawConnections(canvas) {
  const owner = findOwner(canvas, "drawConnections");
  if (!owner) {
    console.warn("[AnimatedLinks] drawConnections not found");
    return;
  }
  const orig = owner.drawConnections;
  if (orig[PATCHED]) { stats.hookDrawConnections = true; return; }

  // Forward ALL arguments, whatever the frontend passes.
  const patched = function (...args) {
    linkSegments.clear();
    stats.recordedLastFrame = 0;
    const result = orig.apply(this, args);
    try {
      drawOverlay(this, args[0]);
    } catch (err) {
      warnOnce("draw", err);
    }
    return result;
  };
  patched[PATCHED] = true;
  owner.drawConnections = patched;
  stats.hookDrawConnections = true;
}

// ───────────── geometry recording ─────────────

function toXY(p) {
  if (!p) return null;
  if (Array.isArray(p) || ArrayBuffer.isView(p)) {
    return Number.isFinite(p[0]) && Number.isFinite(p[1]) ? { x: p[0], y: p[1] } : null;
  }
  if (typeof p === "object" && Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y };
  return null;
}

function findExtras(args) {
  for (let i = 9; i < args.length; i++) {
    const v = args[i];
    if (v && typeof v === "object" && !Array.isArray(v) && ("startControl" in v || "endControl" in v)) return v;
  }
  return null;
}

function normalizeDir(dir, fallback) {
  if (typeof dir === "string") return dir;
  const mapped = { 1: "up", 2: "down", 3: "left", 4: "right" }[dir];
  return mapped || fallback;
}

function offsetPoint(p, dir, d) {
  switch (dir) {
    case "left":  return { x: p.x - d, y: p.y };
    case "right": return { x: p.x + d, y: p.y };
    case "up":    return { x: p.x, y: p.y - d };
    case "down":  return { x: p.x, y: p.y + d };
    default:      return { x: p.x, y: p.y };
  }
}

function buildSegment(start, end, startDir, endDir, extras) {
  const mode = app.canvas?.links_render_mode;
  // 0 = straight, 1 = linear: approximate with a straight line.
  if (mode === 0 || mode === 1) {
    return { start, end, cp1: { ...start }, cp2: { ...end } };
  }
  const dist = Math.hypot(end.x - start.x, end.y - start.y) * 0.25;
  const cp1 = extras?.startControl
    ? { x: start.x + (extras.startControl[0] || 0), y: start.y + (extras.startControl[1] || 0) }
    : offsetPoint(start, startDir, dist);
  const cp2 = extras?.endControl
    ? { x: end.x + (extras.endControl[0] || 0), y: end.y + (extras.endControl[1] || 0) }
    : offsetPoint(end, endDir, dist);
  return { start, end, cp1, cp2 };
}

function recordLinkSegment(args) {
  const start = toXY(args[1]);
  const end = toXY(args[2]);
  const link = args[3];
  if (!start || !end || !link || link.id == null) return;

  const seg = buildSegment(
    start,
    end,
    normalizeDir(args[7], "right"),
    normalizeDir(args[8], "left"),
    findExtras(args)
  );

  const key = String(link.id);
  let list = linkSegments.get(key);
  if (!list) linkSegments.set(key, (list = []));

  // Skip exact duplicates (the same piece reported twice)
  const dup = list.some(
    (s) =>
      Math.abs(s.start.x - seg.start.x) < 0.01 && Math.abs(s.start.y - seg.start.y) < 0.01 &&
      Math.abs(s.end.x - seg.end.x) < 0.01 && Math.abs(s.end.y - seg.end.y) < 0.01
  );
  if (dup) return;

  list.push(seg);
  stats.recordedLastFrame++;
}

// Fallback: derive a link's geometry from the slot positions of its nodes.
function fallbackSegments(canvas, linkId) {
  const graph = canvas.graph;
  const link = getLink(graph, linkId);
  if (!link) return null;
  const o = graph.getNodeById?.(link.origin_id);
  const t = graph.getNodeById?.(link.target_id);
  if (!o || !t) return null;
  const start = slotPos(o, false, link.origin_slot);
  const end = slotPos(t, true, link.target_slot);
  if (!start || !end) return null;
  return [buildSegment(start, end, "right", "left", null)];
}

function slotPos(node, isInput, slot) {
  try {
    if (isInput && typeof node.getInputPos === "function") return toXY(node.getInputPos(slot));
    if (!isInput && typeof node.getOutputPos === "function") return toXY(node.getOutputPos(slot));
    if (typeof node.getConnectionPos === "function") return toXY(node.getConnectionPos(isInput, slot));
  } catch (_) { /* ignore */ }
  return null;
}

// ───────────── hover handling ─────────────

function bindHoverEvents(canvas) {
  const canvasEl = canvas.canvas;

  // Listen on document: with "Nodes 2.0" (Vue nodes) the nodes are DOM elements
  // on top of the canvas, so the canvas itself never gets events over them.
  document.addEventListener(
    "pointermove",
    (e) => {
      try {
        updateHover(canvas, findHoveredNode(canvas, canvasEl, e));
      } catch (err) {
        warnOnce("hover", err);
      }
    },
    { passive: true }
  );
  document.documentElement.addEventListener("mouseleave", () => updateHover(canvas, null));
}

function findHoveredNode(canvas, canvasEl, e) {
  const graph = canvas.graph;
  const target = e.target;
  if (!graph || !(target instanceof Element)) return null;

  // Vue nodes mode: the node is a DOM element that carries its id
  const vueEl = target.closest("[data-node-id]");
  if (vueEl) {
    const raw = vueEl.getAttribute("data-node-id");
    try {
      const n = graph.getNodeById(raw) ?? graph.getNodeById(Number(raw));
      if (n) return n;
    } catch (_) { /* fall through */ }
  }

  // Classic canvas mode: hit-test in graph space
  if (target === canvasEl) {
    const raw = canvas.convertEventToCanvasOffset(e);
    const isArr = Array.isArray(raw) || ArrayBuffer.isView(raw);
    const x = isArr ? raw[0] : raw.x;
    const y = isArr ? raw[1] : raw.y;
    return graph.getNodeOnPos?.(x, y) ?? getNodeAtPos(graph, x, y);
  }
  return null;
}

function updateHover(canvas, node) {
  const prevLinks = hoveredLinkIds.join(",");
  const prevHL = highlightedNodes.map((h) => h.node.id).join(",");

  hoveredLinkIds = node ? getLinkIdsForNode(node) : [];
  highlightedNodes = node ? getSetGetHighlights(canvas.graph, node) : [];
  stats.hoveredNode = node ? `${node.type}#${node.id}` : null;

  const currLinks = hoveredLinkIds.join(",");
  const currHL = highlightedNodes.map((h) => h.node.id).join(",");
  if (prevLinks !== currLinks || prevHL !== currHL) requestRedraw(canvas);
}

// Links are drawn in the *background* pass, so the background layer has to be
// marked dirty too, otherwise drawConnections (and our animation) isn't called.
function requestRedraw(canvas) {
  canvas.setDirty(true, true);
}

function startLoop(canvas) {
  let lastRehook = 0;
  function loop(now) {
    phase = (phase + CONFIG.dotSpeed) % 1;
    pulsePhase = (pulsePhase + 0.008) % 1;
    if (hoveredLinkIds.length > 0 || highlightedNodes.length > 0) requestRedraw(canvas);

    // The link renderer adapter can be re-created; re-apply the (idempotent) patches.
    if (now - lastRehook > 1000) {
      lastRehook = now;
      try {
        patchRenderLink(canvas);
        patchAdapter(canvas);
        patchDrawConnections(canvas);
      } catch (err) {
        warnOnce("rehook", err);
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

function waitForCanvas() {
  return new Promise((resolve) => {
    const ready = () => app.canvas && app.canvas.constructor && app.canvas.ds;
    if (ready()) { resolve(); return; }
    const interval = setInterval(() => {
      if (ready()) { clearInterval(interval); resolve(); }
    }, 50);
    setTimeout(() => { clearInterval(interval); resolve(); }, 15000);
  });
}

// ───────────── graph helpers ─────────────

function getNodeRect(node) {
  const br = node.boundingRect;
  if (br && br.length >= 4) return [br[0], br[1], br[2], br[3]];
  return [node.pos[0], node.pos[1] - 30, node.size[0], node.size[1] + 30];
}

function getGraphNodes(graph) {
  return graph?._nodes ?? graph?.nodes ?? [];
}

function getNodeAtPos(graph, x, y) {
  const nodes = getGraphNodes(graph);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const [rx, ry, rw, rh] = getNodeRect(nodes[i]);
    if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) return nodes[i];
  }
  return null;
}

function getLink(graph, id) {
  if (!graph) return null;
  const links = graph.links ?? graph._links;
  const tryGet = (k) => (links ? (typeof links.get === "function" ? links.get(k) : links[k]) : null);
  return tryGet(id) ?? tryGet(Number(id)) ?? tryGet(String(id)) ?? graph.getLink?.(id) ?? null;
}

// Only ids are needed for drawing, so this doesn't depend on how links are stored.
function getLinkIdsForNode(node) {
  const ids = [];
  if (node.inputs) {
    for (const input of node.inputs) {
      if (input.link != null) ids.push(input.link);
    }
  }
  if (node.outputs) {
    for (const output of node.outputs) {
      if (output.links) for (const id of output.links) ids.push(id);
    }
  }
  return ids;
}

function getSetGetHighlights(graph, node) {
  const result = [];
  const isSet = node.type === "SetNode";
  const isGet = node.type === "GetNode";
  if (!isSet && !isGet) return result;

  const tag = node.widgets?.[0]?.value;
  if (!tag) return result;

  const nodes = getGraphNodes(graph);

  if (isSet) {
    result.push({ node, type: "set" });
    for (const n of nodes) {
      if (n.type === "GetNode" && n.widgets?.[0]?.value === tag) result.push({ node: n, type: "get" });
    }
  } else {
    result.push({ node, type: "get" });
    for (const n of nodes) {
      if (n.type === "SetNode" && n.widgets?.[0]?.value === tag) result.push({ node: n, type: "set" });
    }
  }
  return result;
}

// ───────────── drawing ─────────────

function drawOverlay(canvas, ctx) {
  if (!ctx) return;
  stats.overlayDraws++;
  const scale = canvas.ds?.scale || 1;

  // Set/Get highlights
  for (const hl of highlightedNodes) {
    const [bx, by, bw, bh] = getNodeRect(hl.node);
    const pad = 6 / scale;
    const x = bx - pad;
    const y = by - pad;
    const w = bw + pad * 2;
    const h = bh + pad * 2;
    const r = bh * 0.15;
    ctx.save();
    if (hl.type === "set") {
      ctx.strokeStyle = "#ffcc00";
      ctx.shadowColor = "#ffcc00";
      ctx.shadowBlur = 20;
      ctx.lineWidth = 3 / scale;
      ctx.globalAlpha = 0.9;
    } else {
      const pulse = 0.5 + 0.5 * Math.sin(pulsePhase * Math.PI * 2);
      ctx.strokeStyle = "#00cfff";
      ctx.shadowColor = "#00cfff";
      ctx.shadowBlur = 15 + 15 * pulse;
      ctx.lineWidth = 2 / scale;
      ctx.globalAlpha = 0.5 + 0.4 * pulse;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  // Link animations
  stats.fallbackUsed = 0;
  for (const id of hoveredLinkIds) {
    let segments = linkSegments.get(String(id));
    if (!segments) {
      segments = fallbackSegments(canvas, id);
      if (segments) stats.fallbackUsed++;
    }
    if (!segments) continue;
    for (const seg of segments) drawLinkAnimation(ctx, seg, scale);
  }
}

function drawLinkAnimation(ctx, seg, scale) {
  const { start, end, cp1, cp2 } = seg;

  ctx.save();

  const glowColor = CONFIG.rainbow ? getRainbowColor(phase) : CONFIG.fixedColor;

  ctx.strokeStyle = glowColor;
  ctx.lineWidth = CONFIG.glowWidth / scale;
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = CONFIG.glowBlur;
  ctx.globalAlpha = 0.55;
  drawBezier(ctx, start, cp1, cp2, end);

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2 / scale;
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 6;
  ctx.globalAlpha = 0.7;
  drawBezier(ctx, start, cp1, cp2, end);

  const curveLen = estimateBezierLength(start, cp1, cp2, end);
  const arrowCount = Math.max(1, Math.floor(curveLen / CONFIG.arrowSpacing));
  const baseLen = 600;
  const normalizedPhase = (phase * baseLen / Math.max(curveLen, 1)) % 1;

  ctx.shadowBlur = 10;
  for (let i = 0; i < arrowCount; i++) {
    const t = (normalizedPhase + i / arrowCount) % 1;
    const pos = getBezierPoint(t, start, cp1, cp2, end);
    const t2 = Math.min(t + 0.02, 1);
    const pos2 = getBezierPoint(t2, start, cp1, cp2, end);
    const angle = Math.atan2(pos2.y - pos.y, pos2.x - pos.x);

    const arrowColor = CONFIG.rainbow
      ? getRainbowColor((phase + i / arrowCount) % 1)
      : CONFIG.fixedColor;

    const sz = CONFIG.arrowSize / scale;

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(angle);

    // Glow halo
    ctx.beginPath();
    ctx.moveTo(sz * 1.2, 0);
    ctx.lineTo(-sz * 0.8, sz * 0.8);
    ctx.lineTo(-sz * 0.8, -sz * 0.8);
    ctx.closePath();
    ctx.fillStyle = arrowColor;
    ctx.shadowColor = arrowColor;
    ctx.shadowBlur = 12 / scale;
    ctx.globalAlpha = 0.4;
    ctx.fill();

    // White core
    ctx.beginPath();
    ctx.moveTo(sz, 0);
    ctx.lineTo(-sz * 0.6, sz * 0.6);
    ctx.lineTo(-sz * 0.6, -sz * 0.6);
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = arrowColor;
    ctx.shadowBlur = 8 / scale;
    ctx.globalAlpha = 0.95;
    ctx.fill();

    ctx.restore();
  }

  drawEndMarker(ctx, start, glowColor, scale);
  drawEndMarker(ctx, end, glowColor, scale);

  ctx.restore();
}

function drawEndMarker(ctx, pos, color, scale) {
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, 6 / scale, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 / scale;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.globalAlpha = 0.9;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(pos.x, pos.y, 3 / scale, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = 1;
  ctx.fill();
}

function drawBezier(ctx, start, cp1, cp2, end) {
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y);
  ctx.stroke();
}

function getBezierPoint(t, start, cp1, cp2, end) {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * start.x + 3 * mt * mt * t * cp1.x + 3 * mt * t * t * cp2.x + t * t * t * end.x,
    y: mt * mt * mt * start.y + 3 * mt * mt * t * cp1.y + 3 * mt * t * t * cp2.y + t * t * t * end.y,
  };
}

function estimateBezierLength(start, cp1, cp2, end, steps = 20) {
  let len = 0;
  let prev = start;
  for (let i = 1; i <= steps; i++) {
    const p = getBezierPoint(i / steps, start, cp1, cp2, end);
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return len;
}

function getRainbowColor(t) {
  return `hsl(${Math.round(t * 360)}, 100%, 65%)`;
}

const warned = new Set();
function warnOnce(key, err) {
  stats.lastError = `${key}: ${err?.message ?? err}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[AnimatedLinks] ${key} error (further errors of this kind are suppressed):`, err);
}
