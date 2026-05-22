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
  // Arena floor (concrete around the ring).
  ctx.fillStyle = '#262638';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Crowd zones (darker — tiered seating behind barriers).
  const ringLeft = RING.cx - RING.halfW;
  const ringRight = RING.cx + RING.halfW;
  const ringTop = RING.cy - RING.halfH;
  const ringBottom = RING.cy + RING.halfH;
  const FLOOR_BAND = 40; // concrete space between ring and crowd

  // Crowd-seating fill (dark blue gradient feel)
  ctx.fillStyle = '#15152a';
  // Top tier
  ctx.fillRect(0, 0, CANVAS_W, ringTop - FLOOR_BAND);
  // Bottom tier
  ctx.fillRect(0, ringBottom + FLOOR_BAND, CANVAS_W, CANVAS_H - (ringBottom + FLOOR_BAND));
  // Left tier
  ctx.fillRect(0, 0, ringLeft - FLOOR_BAND, CANVAS_H);
  // Right tier
  ctx.fillRect(ringRight + FLOOR_BAND, 0, CANVAS_W - (ringRight + FLOOR_BAND), CANVAS_H);

  // Crowd rows — pseudo-random people with varied shirt colors.
  const shirtColors = ['#aa3030', '#3060c0', '#30a060', '#c0a030', '#a040b0', '#d06030'];
  const skinTones = ['#e8b88c', '#cc9264', '#a87044', '#80502c', '#583820'];

  const drawCrowdRow = (x0: number, x1: number, y: number, rowHash: number) => {
    for (let x = x0; x < x1; x += 6) {
      const h = (x * 31 + y * 53 + rowHash * 17) | 0;
      if (((h >>> 3) & 0x7) === 0) continue; // small gaps
      const shirt = shirtColors[Math.abs(h) % shirtColors.length];
      const skin = skinTones[Math.abs(h >> 4) % skinTones.length];
      // Body
      ctx.fillStyle = shirt;
      ctx.fillRect(x, y + 3, 4, 4);
      // Head
      ctx.fillStyle = skin;
      ctx.fillRect(x + 1, y, 3, 3);
    }
  };

  // Top crowd: multiple rows
  for (let row = 0; row < ringTop - FLOOR_BAND - 4; row += 9) {
    drawCrowdRow(2, CANVAS_W - 2, row, row);
  }
  // Bottom crowd: multiple rows
  for (let row = ringBottom + FLOOR_BAND + 4; row < CANVAS_H - 6; row += 9) {
    drawCrowdRow(2, CANVAS_W - 2, row, row + 100);
  }
  // Left crowd: vertical strips
  for (let row = 0; row < CANVAS_H; row += 9) {
    drawCrowdRow(2, ringLeft - FLOOR_BAND - 4, row, row + 200);
  }
  // Right crowd
  for (let row = 0; row < CANVAS_H; row += 9) {
    drawCrowdRow(ringRight + FLOOR_BAND + 4, CANVAS_W - 2, row, row + 300);
  }

  // Steel barricades around the ring
  ctx.fillStyle = '#888899';
  // Top barricade
  ctx.fillRect(ringLeft - FLOOR_BAND, ringTop - FLOOR_BAND, ringRight - ringLeft + FLOOR_BAND * 2, 4);
  ctx.fillStyle = '#444455';
  ctx.fillRect(ringLeft - FLOOR_BAND, ringTop - FLOOR_BAND + 4, ringRight - ringLeft + FLOOR_BAND * 2, 2);
  // Bottom barricade
  ctx.fillStyle = '#888899';
  ctx.fillRect(ringLeft - FLOOR_BAND, ringBottom + FLOOR_BAND - 6, ringRight - ringLeft + FLOOR_BAND * 2, 4);
  ctx.fillStyle = '#444455';
  ctx.fillRect(ringLeft - FLOOR_BAND, ringBottom + FLOOR_BAND - 2, ringRight - ringLeft + FLOOR_BAND * 2, 2);
  // Left barricade
  ctx.fillStyle = '#888899';
  ctx.fillRect(ringLeft - FLOOR_BAND, ringTop - FLOOR_BAND, 4, ringBottom - ringTop + FLOOR_BAND * 2);
  // Right barricade
  ctx.fillRect(ringRight + FLOOR_BAND - 4, ringTop - FLOOR_BAND, 4, ringBottom - ringTop + FLOOR_BAND * 2);
  // Barricade vertical posts every 30px
  ctx.fillStyle = '#666677';
  for (let x = ringLeft - FLOOR_BAND + 8; x < ringRight + FLOOR_BAND - 8; x += 30) {
    ctx.fillRect(x, ringTop - FLOOR_BAND - 2, 2, 8);
    ctx.fillRect(x, ringBottom + FLOOR_BAND - 4, 2, 8);
  }

  // Announcer table at the bottom — two seated figures behind it.
  const tableY = ringBottom + 14;
  const tableLeft = ringLeft + RING.halfW - 80;
  const tableW = 160;
  ctx.fillStyle = '#5a3a20';
  ctx.fillRect(tableLeft, tableY, tableW, 12);
  ctx.fillStyle = '#3a2515';
  ctx.fillRect(tableLeft, tableY + 10, tableW, 2);
  // Black skirt/cloth in front
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(tableLeft, tableY + 12, tableW, 16);
  // Mic stand
  ctx.fillStyle = '#aaaaaa';
  ctx.fillRect(tableLeft + 30, tableY - 6, 1, 6);
  ctx.fillRect(tableLeft + tableW - 30, tableY - 6, 1, 6);
  ctx.fillRect(tableLeft + 29, tableY - 7, 3, 2);
  ctx.fillRect(tableLeft + tableW - 31, tableY - 7, 3, 2);
  // Two commentator heads peeking over the table
  ctx.fillStyle = '#cc9264';
  ctx.fillRect(tableLeft + 22, tableY - 8, 6, 6);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(tableLeft + 23, tableY - 4, 1, 1);
  ctx.fillRect(tableLeft + 26, tableY - 4, 1, 1);
  ctx.fillStyle = '#3a2418';
  ctx.fillRect(tableLeft + 22, tableY - 9, 6, 1);

  ctx.fillStyle = '#a87044';
  ctx.fillRect(tableLeft + tableW - 28, tableY - 8, 6, 6);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(tableLeft + tableW - 27, tableY - 4, 1, 1);
  ctx.fillRect(tableLeft + tableW - 24, tableY - 4, 1, 1);
  ctx.fillStyle = '#000';
  ctx.fillRect(tableLeft + tableW - 28, tableY - 9, 6, 1);

  // A few floor tables (production / ring crew) on left and right sides
  ctx.fillStyle = '#5a3a20';
  ctx.fillRect(ringLeft - FLOOR_BAND + 8, ringTop + 60, 22, 8);
  ctx.fillStyle = '#3a2515';
  ctx.fillRect(ringLeft - FLOOR_BAND + 8, ringTop + 66, 22, 2);
  ctx.fillStyle = '#5a3a20';
  ctx.fillRect(ringRight + FLOOR_BAND - 30, ringTop + 60, 22, 8);
  ctx.fillStyle = '#3a2515';
  ctx.fillRect(ringRight + FLOOR_BAND - 30, ringTop + 66, 22, 2);

  // Spotlight beams from above (subtle yellow gradient)
  ctx.fillStyle = 'rgba(255, 220, 100, 0.04)';
  ctx.beginPath();
  ctx.moveTo(RING.cx - 100, 0);
  ctx.lineTo(RING.cx + 100, 0);
  ctx.lineTo(ringRight - 40, ringTop);
  ctx.lineTo(ringLeft + 40, ringTop);
  ctx.closePath();
  ctx.fill();
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
    // Idle/Walk cycle is driven by wall-clock so wrestlers visibly animate
    // (idle bob, walk shuffle) even while the sim time is paused during
    // the spotlight sequence. Visual-only — doesn't affect outcomes.
    const wallSec = typeof performance !== 'undefined' ? performance.now() / 1000 : t;
    const cycleSec = anim === Animation.Walk ? 0.4 : 0.8;
    const offset = w.id * 0.05;
    frame = Math.floor(((wallSec + offset) / cycleSec) * SPRITE_COLS) % SPRITE_COLS;
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

