import { RING, ROPE_BAND, FLOOR_BAND } from '../sim/physics';
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

export interface DraftPickLite {
  pickNumber: number;
  wrestlerId: number | null;
}

export interface FrameOptions {
  leagueName?: string;
  picks?: readonly DraftPickLite[];
  resultsOverlay?: boolean;
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  state: MatchState,
  roster: readonly Player[],
  sheets: SpriteSheets,
  opts: FrameOptions = {},
): void {
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  drawCrowd(ctx);
  drawRing(ctx, opts.leagueName ?? '');
  drawWrestlers(ctx, state, roster, sheets);
  drawHud(ctx, state);
  if (opts.picks) drawDraftOverlay(ctx, opts.picks, roster);
  if (opts.resultsOverlay) {
    drawResultsOverlay(ctx, state.scheduler.schedule.eliminationOrder, roster);
  }
}

/**
 * Compact draft-order overlay drawn on the right side of the canvas (over
 * the crowd, so it doesn't cover the action). Filled-in picks light up as
 * eliminations land. This is what gets captured into the exported video.
 */
function drawDraftOverlay(
  ctx: CanvasRenderingContext2D,
  picks: readonly DraftPickLite[],
  roster: readonly Player[],
): void {
  const overlayW = 132;
  const overlayX = CANVAS_W - overlayW - 4;
  const overlayY = 4;
  const overlayH = CANVAS_H - 8;
  ctx.fillStyle = 'rgba(10, 10, 20, 0.78)';
  ctx.fillRect(overlayX, overlayY, overlayW, overlayH);
  ctx.strokeStyle = '#ffcc00';
  ctx.lineWidth = 1;
  ctx.strokeRect(overlayX + 0.5, overlayY + 0.5, overlayW - 1, overlayH - 1);

  ctx.fillStyle = '#ffcc00';
  ctx.font = 'bold 10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('DRAFT ORDER', overlayX + overlayW / 2, overlayY + 5);

  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'left';
  const rowH = Math.max(11, Math.min(20, (overlayH - 22) / picks.length));
  const startY = overlayY + 20;
  for (let i = 0; i < picks.length; i++) {
    const pick = picks[i];
    const rowY = startY + i * rowH;
    if (rowY + 9 > overlayY + overlayH - 2) break;
    const player = pick.wrestlerId !== null ? roster[pick.wrestlerId] : null;
    const isWinner = pick.pickNumber === 1;
    const label = `#${pick.pickNumber}`;
    if (player) {
      ctx.fillStyle = isWinner ? '#ffd700' : '#ffffff';
      const name = displayName(player, pick.wrestlerId!);
      ctx.fillText(`${label} ${name}`, overlayX + 6, rowY);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.30)';
      ctx.fillText(label, overlayX + 6, rowY);
    }
  }
}

/**
 * End-of-match takeover. Dims the canvas, shows WINNER in gold, 2nd in
 * silver, 3rd in bronze, then ranks 4..N in plain white. Held on screen
 * while the recorder is still running so the final results bake into the
 * exported video.
 */
function drawResultsOverlay(
  ctx: CanvasRenderingContext2D,
  eliminationOrder: readonly number[],
  roster: readonly Player[],
): void {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.86)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffcc00';
  ctx.font = 'bold 32px ui-monospace, monospace';
  ctx.fillText('DRAFT ORDER', CANVAS_W / 2, 20);

  const N = eliminationOrder.length;
  if (N === 0) return;
  const nameFor = (idx: number) => {
    const id = eliminationOrder[idx];
    return roster[id] ? displayName(roster[id], id) : `Player ${id + 1}`;
  };

  let y = 64;
  // Winner (gold)
  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 26px ui-monospace, monospace';
  ctx.fillText(`WINNER: ${nameFor(N - 1)}`, CANVAS_W / 2, y);
  y += 40;

  if (N >= 2) {
    ctx.fillStyle = '#d8d8d8';
    ctx.font = 'bold 20px ui-monospace, monospace';
    ctx.fillText(`2ND: ${nameFor(N - 2)}`, CANVAS_W / 2, y);
    y += 28;
  }
  if (N >= 3) {
    ctx.fillStyle = '#cd7f32';
    ctx.font = 'bold 20px ui-monospace, monospace';
    ctx.fillText(`3RD: ${nameFor(N - 3)}`, CANVAS_W / 2, y);
    y += 34;
  }

  ctx.fillStyle = '#f0f0ff';
  ctx.font = '15px ui-monospace, monospace';
  for (let pick = 4; pick <= N; pick++) {
    const idx = N - pick;
    if (idx < 0) break;
    ctx.fillText(`${pick}. ${nameFor(idx)}`, CANVAS_W / 2, y);
    y += 19;
    if (y > CANVAS_H - 14) break;
  }
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

function drawRing(ctx: CanvasRenderingContext2D, leagueName: string): void {
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

  // League name printed on the mat (faded gold so wrestlers stay readable).
  const name = leagueName.trim();
  if (name) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 204, 0, 0.32)';
    ctx.font = 'bold 26px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name.toUpperCase(), RING.cx, RING.cy);
    ctx.restore();
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

