import { RING, ROPE_BAND } from '../sim/physics';
import type { MatchState } from '../sim/tickLoop';
import { displayName, type Player } from '../state/store';
import { Animation, SPRITE_W, SPRITE_H, SPRITE_COLS } from '../avatar/compose';
import type { Wrestler } from '../sim/wrestler';

export const CANVAS_W = 960;
export const CANVAS_H = 540;

/**
 * Sprite scale: each sprite pixel is drawn at SPRITE_SCALE canvas pixels.
 * Higher = chunkier 8-bit look + bigger wrestlers, but ring fits fewer.
 */
const SPRITE_SCALE = 2;
const DRAW_W = SPRITE_W * SPRITE_SCALE;
const DRAW_H = SPRITE_H * SPRITE_SCALE;

export type SpriteSheets = Map<number, HTMLCanvasElement>;

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  state: MatchState,
  roster: readonly Player[],
  sheets: SpriteSheets,
): void {
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  drawCrowd(ctx);
  drawRing(ctx);
  drawWrestlers(ctx, state, roster, sheets);
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
  sheets: SpriteSheets,
): void {
  // Draw in Y order so closer-to-camera wrestlers occlude farther ones, with
  // eliminated wrestlers underneath everything (they're outside the ring).
  const sorted = [...state.wrestlers].sort((a, b) => {
    if (a.state === 'eliminated' && b.state !== 'eliminated') return -1;
    if (b.state === 'eliminated' && a.state !== 'eliminated') return 1;
    return a.y - b.y;
  });

  for (const w of sorted) {
    const sheet = sheets.get(w.id);
    if (!sheet) continue;

    const drawX = Math.round(w.x - DRAW_W / 2);
    // renderYOffset is positive = higher on screen (e.g., climbed turnbuckle).
    const drawY = Math.round(w.y - DRAW_H + 4 + airborneOffset(w) - w.renderYOffset);

    if (w.state === 'eliminated') {
      ctx.globalAlpha = 0.5;
    }

    // Shadow
    if (w.state !== 'beingEliminated' && w.state !== 'eliminated') {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(w.x, w.y + 2, DRAW_W / 3, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const { anim, frame } = animationFor(w, state.t);
    const sx = frame * SPRITE_W;
    const sy = anim * SPRITE_H;

    // Flip horizontally if facing left.
    if (w.facing === -1) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(sheet, sx, sy, SPRITE_W, SPRITE_H, -drawX - DRAW_W, drawY, DRAW_W, DRAW_H);
      ctx.restore();
    } else {
      ctx.drawImage(sheet, sx, sy, SPRITE_W, SPRITE_H, drawX, drawY, DRAW_W, DRAW_H);
    }

    ctx.globalAlpha = 1;

    // Name tag for active wrestlers only.
    if (w.state !== 'eliminated') {
      const player = roster[w.id];
      const name = player ? displayName(player) : `Player ${w.id + 1}`;
      ctx.font = 'bold 10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tagW = ctx.measureText(name).width + 6;
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(w.x - tagW / 2, drawY - 14, tagW, 12);
      ctx.fillStyle = '#fff';
      ctx.fillText(name, w.x, drawY - 8);
    }
  }
}

function animationFor(w: Wrestler, t: number): { anim: Animation; frame: number } {
  let anim: Animation;
  switch (w.state) {
    case 'eliminated':
      anim = Animation.Eliminated;
      break;
    case 'beingEliminated':
      anim = Animation.Thrown;
      break;
    case 'stunned':
      // A laid-out victim uses the flat Eliminated pose; quick stun shows
      // them dazed-but-standing in idle pose.
      anim = w.downed ? Animation.Eliminated : Animation.Idle;
      break;
    case 'attacking':
      // Pick the right animation row based on the move type so kicks look
      // like kicks, tackles look like spears, and top-rope dives look
      // airborne.
      if (w.attackMove === 'kick') {
        anim = Animation.Kick;
      } else if (
        w.attackMove === 'topRope' ||
        w.attackMove === 'splash' ||
        w.attackMove === 'tackle'
      ) {
        // Tackle reuses the dive pose (forward Superman) but without the
        // airborne Y arc — same visual silhouette, on the ground.
        anim = Animation.TopRope;
      } else {
        anim = Animation.Attack;
      }
      break;
    case 'wandering':
    case 'engaging':
      anim = Math.hypot(w.vx, w.vy) > 8 ? Animation.Walk : Animation.Idle;
      break;
    default:
      anim = Animation.Idle;
  }

  let frame: number;
  if (anim === Animation.Thrown) {
    frame = Math.min(SPRITE_COLS - 1, Math.floor(w.animPhase * SPRITE_COLS));
  } else if (anim === Animation.Eliminated) {
    frame = 0;
  } else if (anim === Animation.Attack || anim === Animation.Kick) {
    // Drive attack/kick frames off animPhase so the wind-up and hit visibly
    // land with the sim's hit-frame timing, not desynced wall-clock cycles.
    frame = Math.min(SPRITE_COLS - 1, Math.floor(w.animPhase * SPRITE_COLS));
  } else if (anim === Animation.TopRope) {
    // Hold the dive pose for the whole airborne phase.
    frame = 0;
  } else {
    const cycleSec = anim === Animation.Walk ? 0.4 : 0.8;
    const offset = w.id * 0.05;
    frame = Math.floor(((t + offset) / cycleSec) * SPRITE_COLS) % SPRITE_COLS;
  }
  return { anim, frame };
}

/**
 * Y offset applied to top-rope attackers so they visibly arc through the air.
 * Climbs fast at the start (the "leap"), peaks well above the mat, and
 * crashes down right at the hit frame.
 */
function airborneOffset(w: Wrestler): number {
  if (w.state !== 'attacking') return 0;
  if (w.attackMove !== 'topRope' && w.attackMove !== 'splash') return 0;
  // Skewed arc: fast launch up, hangs at the top, slams down at hit. Sine
  // of phase^0.6 puts the peak earlier than 0.5 and stretches the descent.
  const skewed = Math.pow(w.animPhase, 0.6);
  return -Math.sin(skewed * Math.PI) * 80;
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

