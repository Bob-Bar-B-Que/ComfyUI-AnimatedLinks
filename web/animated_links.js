import { app } from "../../scripts/app.js";

// ─────────────────────────────────────────────
//  Animated Links for ComfyUI  (v1.7)
//  Intercepts renderLinkDirect to get real coords
// ─────────────────────────────────────────────

const CONFIG = {
  arrowSize: 7,        // розмір трикутника
  arrowSpacing: 120,   // мінімальна відстань між трикутниками (px в graph space)
  dotSpeed: 0.0008,
  rainbow: true,
  fixedColor: "#00cfff",
  glowWidth: 8,
  glowBlur: 18,
};

let phase = 0;
let pulsePhase = 0;
let hoveredLinks = [];
const linkCoords = new Map();
let highlightedNodes = []; // {node, type: 'set'|'get'}

app.registerExtension({
  name: "AnimatedLinks.NodeHover",

  async setup() {
    await waitForCanvas();

    const LGC = app.canvas.constructor;
    const proto = LGC.prototype;

    // Intercept renderLinkDirect to capture real coordinates
    // renderLinkDirect(ctx, start, end, link, flow, color, output, startDir, endDir, renderContext, opts)
    const origRenderLink = app.canvas.linkRenderer.constructor.prototype.renderLinkDirect.bind(app.canvas.linkRenderer);
    app.canvas.linkRenderer.renderLinkDirect = function(ctx, start, end, link, flow, color, output, startDir, endDir, renderContext, opts={}) {
      if (link && link.id != null) {
        const pr = app.canvas.linkRenderer.pathRenderer;
        const s = {x: start[0], y: start[1]};
        const e = {x: end[0],   y: end[1]  };
        let cp1, cp2;
        // Use actual startDir/endDir from ComfyUI
        const sDir = startDir || "right";
        const eDir = endDir   || "left";
        try {
          // Handle startControl/endControl from opts
          if (opts.startControl || opts.endControl) {
            cp1 = opts.startControl ? {x: start[0]+(opts.startControl[0]||0), y: start[1]+(opts.startControl[1]||0)} : null;
            cp2 = opts.endControl   ? {x: end[0]  +(opts.endControl[0]  ||0), y: end[1]  +(opts.endControl[1]  ||0)} : null;
          }
          if (!cp1 || !cp2) {
            const cps = pr.calculateControlPoints(s, e, sDir, eDir);
            cp1 = cp1 || cps[0];
            cp2 = cp2 || cps[1];
          }
        } catch(err) {
          const dist = Math.sqrt((e.x-s.x)**2+(e.y-s.y)**2);
          const off = Math.max(30, dist*0.25);
          const sign = e.x >= s.x ? 1 : -1;
          cp1 = {x: s.x+sign*off, y: s.y};
          cp2 = {x: e.x-sign*off, y: e.y};
        }
        linkCoords.set(link.id, { start: s, end: e, cp1, cp2 });
      }
      return origRenderLink(ctx, start, end, link, flow, color, output, startDir, endDir, renderContext, opts);
    };

    // Patch drawConnections to draw our animation after
    const origDraw = proto.drawConnections;
    proto.drawConnections = function (ctx) {
      origDraw.call(this, ctx);

      // Draw Set/Get highlights
      if (highlightedNodes.length > 0) {
        const scale = this.ds?.scale || 1;
        for (const hl of highlightedNodes) {
          const node = hl.node;
          // Use boundingRect - same as ComfyUI white border
          const br = node.boundingRect;
          const pad = 6 / scale;
          // boundingRect is in absolute coords already
          const x = br[0] - pad;
          const y = br[1] - pad;
          const w = br[2] + pad * 2;
          const h = br[3] + pad * 2;
          const r = br[3] * 0.15; // proportional rounded corners
          ctx.save();
          if (hl.type === 'set') {
            ctx.strokeStyle = '#ffcc00';
            ctx.shadowColor = '#ffcc00';
            ctx.shadowBlur = 20;
            ctx.lineWidth = 3 / scale;
            ctx.globalAlpha = 0.9;
          } else {
            const pulse = 0.5 + 0.5 * Math.sin(pulsePhase * Math.PI * 2);
            ctx.strokeStyle = '#00cfff';
            ctx.shadowColor = '#00cfff';
            ctx.shadowBlur = 15 + 15 * pulse;
            ctx.lineWidth = 2 / scale;
            ctx.globalAlpha = 0.5 + 0.4 * pulse;
          }
          // Rounded rect
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
      }

      // Draw link animations
      for (const link of hoveredLinks) {
        const coords = linkCoords.get(link.id);
        if (coords) {
          const { cp1, cp2 } = computeCP(coords);
          drawLinkAnimation(ctx, coords.start, coords.end, this.ds?.scale || 1, cp1, cp2);
        }
      }
    };



    const canvasEl = app.canvas.canvas;

    canvasEl.addEventListener("mousemove", (e) => {
      const raw = app.canvas.convertEventToCanvasOffset(e);
      const mousePos = Array.isArray(raw)
        ? { x: raw[0], y: raw[1] }
        : { x: raw.x, y: raw.y };

      const prevLinks = hoveredLinks.map(l => l.id).join(",");
      const prevHL = highlightedNodes.map(h => h.node.id).join(",");

      const hoveredNode = getNodeAtPos(mousePos);
      hoveredLinks = hoveredNode ? getLinksForNode(hoveredNode) : [];
      highlightedNodes = hoveredNode ? getSetGetHighlights(hoveredNode) : [];

      const currLinks = hoveredLinks.map(l => l.id).join(",");
      const currHL = highlightedNodes.map(h => h.node.id).join(",");

      if (prevLinks !== currLinks || prevHL !== currHL) app.canvas.setDirty(true, false);
    });

    canvasEl.addEventListener("mouseleave", () => {
      if (hoveredLinks.length > 0 || highlightedNodes.length > 0) {
        hoveredLinks = [];
        highlightedNodes = [];
        app.canvas.setDirty(true, false);
      }
    });

    function loop() {
      phase = (phase + CONFIG.dotSpeed) % 1;
      pulsePhase = (pulsePhase + 0.008) % 1;
      if (hoveredLinks.length > 0 || highlightedNodes.length > 0) app.canvas.setDirty(true, false);
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    console.log("[AnimatedLinks] v1.7 initialized with renderLink intercept");
  },
});

function waitForCanvas() {
  return new Promise((resolve) => {
    if (app.canvas && app.canvas.constructor && app.canvas.ds) {
      resolve(); return;
    }
    const interval = setInterval(() => {
      if (app.canvas && app.canvas.constructor && app.canvas.ds) {
        clearInterval(interval); resolve();
      }
    }, 50);
    setTimeout(() => { clearInterval(interval); resolve(); }, 15000);
  });
}

function getNodeAtPos(mousePos) {
  if (!app.canvas.graph) return null;
  const nodes = app.canvas.graph._nodes;
  if (!nodes) return null;
  // Search from end (top-rendered nodes first)
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (mousePos.x >= node.pos[0] && mousePos.x <= node.pos[0] + node.size[0] &&
        mousePos.y >= node.pos[1] - 30 && mousePos.y <= node.pos[1] + node.size[1]) {
      return node;
    }
  }
  return null;
}

function getLinksForNode(node) {
  const links = [];
  if (node.inputs) {
    for (const input of node.inputs) {
      if (input.link != null) {
        const link = app.canvas.graph.links.get(input.link);
        if (link) links.push(link);
      }
    }
  }
  if (node.outputs) {
    for (const output of node.outputs) {
      if (output.links) {
        for (const linkId of output.links) {
          const link = app.canvas.graph.links.get(linkId);
          if (link) links.push(link);
        }
      }
    }
  }
  return links;
}

function getSetGetHighlights(node) {
  const result = [];
  const isSet = node.type === 'SetNode';
  const isGet = node.type === 'GetNode';
  if (!isSet && !isGet) return result;

  const tag = node.widgets?.[0]?.value;
  if (!tag) return result;

  const nodes = app.canvas.graph._nodes;

  if (isSet) {
    // Highlight this Set node + all matching Get nodes
    result.push({ node, type: 'set' });
    for (const n of nodes) {
      if (n.type === 'GetNode' && n.widgets?.[0]?.value === tag) {
        result.push({ node: n, type: 'get' });
      }
    }
  } else {
    // Highlight this Get node + matching Set node
    result.push({ node, type: 'get' });
    for (const n of nodes) {
      if (n.type === 'SetNode' && n.widgets?.[0]?.value === tag) {
        result.push({ node: n, type: 'set' });
      }
    }
  }
  return result;
}

function drawLinkAnimation(ctx, start, end, scale, cp1ext, cp2ext) {
  const { cp1: cp1calc, cp2: cp2calc } = getControlPoints(start, end);
  const cp1 = cp1ext || cp1calc;
  const cp2 = cp2ext || cp2calc;

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

  // Calculate curve length to determine arrow count and normalize speed
  const curveLen = estimateBezierLength(start, cp1, cp2, end);
  const arrowCount = Math.max(1, Math.floor(curveLen / CONFIG.arrowSpacing));
  // Normalize phase by length so speed is constant in pixels/sec
  const baseLen = 600; // reference length in graph px
  const normalizedPhase = (phase * baseLen / Math.max(curveLen, 1)) % 1;

  ctx.shadowBlur = 10;
  for (let i = 0; i < arrowCount; i++) {
    const t = (normalizedPhase + i / arrowCount) % 1;
    const pos = getBezierPoint(t, start, cp1, cp2, end);
    // Get tangent direction for arrow orientation
    const dt = 0.02;
    const t2 = Math.min(t + dt, 1);
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

function computeCP(coords) {
  const { start, end, startControl, endControl } = coords;
  try {
    const pr = app.canvas.linkRenderer.pathRenderer;
    // Always use right->left as ComfyUI does (sDir=4=right, eDir=3=left)
    const cps = pr.calculateControlPoints(start, end, "right", "left");
    let cp1 = cps[0];
    let cp2 = cps[1];
    if (startControl) cp1 = {x: start.x+(startControl[0]||0), y: start.y+(startControl[1]||0)};
    if (endControl)   cp2 = {x: end.x  +(endControl[0]  ||0), y: end.y  +(endControl[1]  ||0)};
    return { cp1, cp2 };
  } catch(e) {
    return getControlPoints(start, end);
  }
}

function getControlPoints(start, end) {
  try {
    const pr = app.canvas.linkRenderer.pathRenderer;
    const startDir = start.x <= end.x ? "right" : "left";
    const endDir   = start.x <= end.x ? "left"  : "right";
    const cps = pr.calculateControlPoints(start, end, startDir, endDir);
    return { cp1: cps[0], cp2: cps[1] };
  } catch(e) {
    const dist = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
    const offset = Math.max(30, dist * 0.25);
    const sign = end.x >= start.x ? 1 : -1;
    return {
      cp1: { x: start.x + sign * offset, y: start.y },
      cp2: { x: end.x - sign * offset,   y: end.y   }
    };
  }
}

function drawBezier(ctx, start, cp1, cp2, end) {
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y);
  ctx.stroke();
}

function getBezierPoint(t, start, cp1, cp2, end) {
  try {
    return app.canvas.linkRenderer.pathRenderer.findPointOnBezier(t, start, cp1, cp2, end);
  } catch(e) {
    const mt = 1 - t;
    return {
      x: mt*mt*mt*start.x + 3*mt*mt*t*cp1.x + 3*mt*t*t*cp2.x + t*t*t*end.x,
      y: mt*mt*mt*start.y + 3*mt*mt*t*cp1.y + 3*mt*t*t*cp2.y + t*t*t*end.y,
    };
  }
}

function estimateBezierLength(start, cp1, cp2, end, steps=20) {
  let len = 0;
  let prev = start;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const p = getBezierPoint(t, start, cp1, cp2, end);
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    len += Math.sqrt(dx*dx + dy*dy);
    prev = p;
  }
  return len;
}

function getRainbowColor(t) {
  return `hsl(${Math.round(t * 360)}, 100%, 65%)`;
}
