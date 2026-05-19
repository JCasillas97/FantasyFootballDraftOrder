import { RING, ROPE_BAND } from '../sim/physics';
import type { MatchState } from '../sim/tickLoop';
import type { Player } from '../state/store';

export const CANVAS_W = 960;
export const CANVAS_H = 540;

/**
 * Phase 1 renderer: colored squares with name tags. Phase 3 swaps these out
 * for sprite blits but the draw entry point stays the same.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  state: MatchState,
  roster: readonly Player[],
  colors: readonly string[],
): void {
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  drawCrowd(ctx);
  drawRing(ctx);
  drawWrestlers(ctx, state, roster, colors);
  drawHud(ctx, state);
}

function drawCrowd(ctx: CanvasRenderingContext2D): void {
  // Static crowd silhouette behind the ring (animated in Phase 6 polish).
  ctx.fillStyle = '#1a1a30';
  ctx.fillRect(0, 0, CANVAS_W, RING.cy - RING.halfH - 4);
  ctx.fillRect(0, RING.cy + RING.halfH + 4, CANVAS_W, CANVAS_H - (RING.cy + RING.halfH + 4));
  ctx.fillRect(0, 0, RING.cx - RING.halfW - 4, CANVAS_H);
  ctx.fillRect(RING.cx + RING.halfW + 4, 0, CANVAS_W - (RING.cx + RING.halfW + 4), CANVAS_H);

  // Pixel-dot crowd heads (deterministic-looking pattern, not RNG-driven).
  ctx.fillStyle = '#2a2a4a';
  for (let y = 8; y < CANVAS_H; y += 14) {
    for (let x = 8; x < CANVAS_W; x += 12) {
      const insideRing =
        x > RING.cx - RING.halfW - 4 &&
        x < RING.cx + RING.halfW + 4 &&
        y > RING.cy - RING.halfH - 4 &&
        y < RING.cy + RING.halfH + 4;
      if (insideRing) continue;
      if ((x * 31 + y * 53) % 11 === 0) {
        ctx.fillRect(x, y, 4, 4);
      }
    }
  }
}

function drawRing(ctx: CanvasRenderingContext2D): void {
  const left = RING.cx - RING.halfW;
  const top = RING.cy - RING.halfH;
  const w = RING.halfW * 2;
  const h = RING.halfH * 2;

  // Mat
  ctx.fillStyle = '#3a2a1a';
  ctx.fillRect(left, top, w, h);
  // Mat stripes for texture
  ctx.fillStyle = '#4a3520';
  for (let y = top + 8; y < top + h; y += 24) {
    ctx.fillRect(left, y, w, 2);
  }

  // Ropes
  const ropeColors = ['#cc3030', '#cc8030', '#30cc60'];
  for (let i = 0; i < 3; i++) {
    const offset = ROPE_BAND - i * 6;
    ctx.fillStyle = ropeColors[i];
    ctx.fillRect(left - 4, top + offset, w + 8, 2);
    ctx.fillRect(left - 4, top + h - offset, w + 8, 2);
    ctx.fillRect(left + offset, top - 4, 2, h + 8);
    ctx.fillRect(left + w - offset, top - 4, 2, h + 8);
  }

  // Turnbuckles
  ctx.fillStyle = '#ffcc00';
  for (const [tx, ty] of [
    [left - 4, top - 4],
    [left + w - 4, top - 4],
    [left - 4, top + h - 4],
    [left + w - 4, top + h - 4],
  ]) {
    ctx.fillRect(tx, ty, 10, 10);
  }
}

function drawWrestlers(
  ctx: CanvasRenderingContext2D,
  state: MatchState,
  roster: readonly Player[],
  colors: readonly string[],
): void {
  // Render eliminated wrestlers underneath (they're outside the ring).
  const sorted = [...state.wrestlers].sort((a, b) => {
    if (a.state === 'eliminated' && b.state !== 'eliminated') return -1;
    if (b.state === 'eliminated' && a.state !== 'eliminated') return 1;
    return a.y - b.y;
  });

  for (const w of sorted) {
    const color = colors[w.id % colors.length];
    const wrestlerW = 16;
    const wrestlerH = 24;
    const x = Math.round(w.x - wrestlerW / 2);
    const y = Math.round(w.y - wrestlerH);

    if (w.state === 'eliminated') {
      ctx.globalAlpha = 0.35;
    }

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(w.x, w.y + 2, wrestlerW / 2, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = color;
    ctx.fillRect(x, y, wrestlerW, wrestlerH);

    // Head (slightly lighter)
    ctx.fillStyle = lighten(color, 0.25);
    ctx.fillRect(x + 3, y - 8, wrestlerW - 6, 10);

    // Facing pixel
    ctx.fillStyle = '#000';
    const eyeX = w.facing === 1 ? x + wrestlerW - 6 : x + 3;
    ctx.fillRect(eyeX, y - 4, 2, 2);

    ctx.globalAlpha = 1;

    // Name tag
    if (w.state !== 'eliminated') {
      const name = roster[w.id]?.name ?? `P${w.id}`;
      ctx.fillStyle = '#000';
      const tagW = name.length * 7 + 4;
      ctx.fillRect(w.x - tagW / 2, y - 22, tagW, 10);
      ctx.fillStyle = '#fff';
      ctx.font = '8px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, w.x, y - 17);
    }
  }
}

function drawHud(ctx: CanvasRenderingContext2D, state: MatchState): void {
  const active = state.wrestlers.filter((w) => w.state !== 'eliminated').length;
  ctx.fillStyle = '#ffcc00';
  ctx.font = 'bold 14px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`Wrestlers: ${active}`, 16, 16);
  ctx.fillText(`Time: ${state.t.toFixed(1)}s`, 16, 36);
}

function lighten(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, ((num >> 16) & 0xff) + amount * 255);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount * 255);
  const b = Math.min(255, (num & 0xff) + amount * 255);
  return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
}

/**
 * Stable distinct colors for the 12 placeholder wrestlers. Replaced by
 * proper sprites in Phase 3.
 */
export const PLAYER_COLORS = [
  '#ff4444',
  '#44aaff',
  '#ffcc00',
  '#44dd88',
  '#dd44dd',
  '#ff8800',
  '#88ddff',
  '#dd8855',
  '#aaff44',
  '#ff4488',
  '#8844ff',
  '#ffffff',
];
