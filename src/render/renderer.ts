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
  podiumOverlay?: boolean;
  /** Crowd liveliness 0..1+ (>1 = peak eruption). */
  crowdEnergy?: number;
  /** Whether the spot table has been smashed. */
  tableBroken?: boolean;
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

  drawCrowd(ctx, opts.crowdEnergy ?? 0, opts.tableBroken ?? false);
  drawRing(ctx, opts.leagueName ?? '', computeRopeBounce(state));
  drawWrestlers(ctx, state, roster, sheets);
  drawHud(ctx, state);
  if (opts.picks) drawDraftOverlay(ctx, opts.picks, roster);
  if (opts.resultsOverlay) {
    drawResultsOverlay(ctx, state.scheduler.schedule.eliminationOrder, roster);
  }
  if (opts.podiumOverlay) {
    drawPodiumOverlay(ctx, state.scheduler.schedule.eliminationOrder, roster, sheets);
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

/**
 * Podium scene: three steps with top-3 wrestlers standing on them, 4..N
 * shuffling around in the background looking beat up. Drawn over a dimmed
 * stadium so it reads as a separate "trophy ceremony" frame.
 */
function drawPodiumOverlay(
  ctx: CanvasRenderingContext2D,
  eliminationOrder: readonly number[],
  roster: readonly Player[],
  sheets: SpriteSheets,
): void {
  ctx.fillStyle = 'rgba(8, 4, 18, 0.92)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Background spotlight cone
  ctx.fillStyle = 'rgba(255, 220, 100, 0.06)';
  ctx.beginPath();
  ctx.moveTo(CANVAS_W / 2 - 240, 0);
  ctx.lineTo(CANVAS_W / 2 + 240, 0);
  ctx.lineTo(CANVAS_W / 2 + 160, CANVAS_H);
  ctx.lineTo(CANVAS_W / 2 - 160, CANVAS_H);
  ctx.closePath();
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 28px ui-monospace, monospace';
  ctx.fillText('FINAL PODIUM', CANVAS_W / 2, 14);

  const N = eliminationOrder.length;
  const nameOf = (idx: number) => {
    const id = eliminationOrder[idx];
    return roster[id] ? displayName(roster[id], id) : `Player ${id + 1}`;
  };

  // -------- Background row: 4..N moping --------
  const losers: number[] = [];
  for (let pick = 4; pick <= N; pick++) {
    const idx = N - pick;
    if (idx < 0) break;
    losers.push(eliminationOrder[idx]);
  }
  const wallSec = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
  const bgScale = 1.4;
  const bgW = SPRITE_W * bgScale;
  const bgH = SPRITE_H * bgScale;
  const bgY = 70;
  const usableW = CANVAS_W - 60;
  const gap = losers.length > 0 ? usableW / losers.length : 0;
  losers.forEach((id, i) => {
    const sheet = sheets.get(id);
    if (!sheet) return;
    const cx = 30 + gap * i + gap / 2;
    const bob = Math.round(Math.sin((wallSec + i * 0.3) * 1.8) * 1);
    // Idle frame
    ctx.drawImage(
      sheet,
      0,
      Animation.Idle * SPRITE_H,
      SPRITE_W,
      SPRITE_H,
      cx - bgW / 2,
      bgY + bob,
      bgW,
      bgH,
    );
    // Battle damage decals: red blood specks + white bandage strips.
    const seed = (id * 31) >>> 0;
    for (let k = 0; k < 4; k++) {
      const hx = ((seed + k * 17) % 16) - 8;
      const hy = ((seed + k * 23) % 20) - 4;
      ctx.fillStyle = '#cc1010';
      ctx.fillRect(cx + hx, bgY + bob + 14 + hy, 2, 2);
    }
    // Forehead bandage
    if ((seed & 1) === 1) {
      ctx.fillStyle = '#e8e8d8';
      ctx.fillRect(cx - 7, bgY + bob + 6, 14, 2);
      ctx.fillStyle = '#a85040';
      ctx.fillRect(cx - 2, bgY + bob + 6, 4, 2); // bloody patch
    }
    // Arm sling
    if ((seed & 2) === 2) {
      ctx.fillStyle = '#e8e8d8';
      ctx.fillRect(cx - 9, bgY + bob + 24, 6, 8);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText(displayName(roster[id], id), cx, bgY + bgH + 2);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText(`#${i + 4}`, cx, bgY + bgH + 14);
  });

  // -------- Foreground: three podium steps --------
  const podiumY = CANVAS_H - 30;
  const steps: Array<{ rank: 1 | 2 | 3; cx: number; height: number; color: string; ringColor: string }> = [
    { rank: 2, cx: CANVAS_W / 2 - 140, height: 80, color: '#c8c8d0', ringColor: '#d8d8d8' },
    { rank: 1, cx: CANVAS_W / 2, height: 120, color: '#d4a020', ringColor: '#ffd700' },
    { rank: 3, cx: CANVAS_W / 2 + 140, height: 60, color: '#a47038', ringColor: '#cd7f32' },
  ];
  const fgScale = 2.4;
  const fgW = SPRITE_W * fgScale;
  const fgH = SPRITE_H * fgScale;
  for (const step of steps) {
    const stepW = 110;
    const stepY = podiumY - step.height;
    // Step block
    ctx.fillStyle = step.color;
    ctx.fillRect(step.cx - stepW / 2, stepY, stepW, step.height);
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(step.cx - stepW / 2, stepY, stepW, 3);
    // Rank label on the step
    ctx.fillStyle = step.ringColor;
    ctx.font = 'bold 30px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(step.rank), step.cx, stepY + step.height / 2 - 18);
    // Wrestler standing on top, idle
    if (N >= step.rank) {
      const id = eliminationOrder[N - step.rank];
      const sheet = sheets.get(id);
      const bob = Math.round(Math.sin((wallSec + step.rank * 0.4) * 2.4) * 2);
      if (sheet) {
        ctx.drawImage(
          sheet,
          0,
          Animation.Celebrate * SPRITE_H,
          SPRITE_W,
          SPRITE_H,
          step.cx - fgW / 2,
          stepY - fgH + bob,
          fgW,
          fgH,
        );
      }
      // Name label above the wrestler
      ctx.fillStyle = step.ringColor;
      ctx.font = 'bold 14px ui-monospace, monospace';
      ctx.fillText(nameOf(N - step.rank), step.cx, stepY - fgH - 16);
    }
  }
}

function drawCrowd(ctx: CanvasRenderingContext2D, energy: number, tableBroken: boolean): void {
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
  ctx.fillRect(0, 0, CANVAS_W, ringTop - FLOOR_BAND);
  ctx.fillRect(0, ringBottom + FLOOR_BAND, CANVAS_W, CANVAS_H - (ringBottom + FLOOR_BAND));
  ctx.fillRect(0, 0, ringLeft - FLOOR_BAND, CANVAS_H);
  ctx.fillRect(ringRight + FLOOR_BAND, 0, CANVAS_W - (ringRight + FLOOR_BAND), CANVAS_H);

  // Crowd rows — pseudo-random people with varied shirt colors. Heads bob
  // gently at idle and big during eruption (energy → 1+). Wall-clock driven
  // so the crowd keeps moving even when sim time is paused.
  const shirtColors = ['#aa3030', '#3060c0', '#30a060', '#c0a030', '#a040b0', '#d06030'];
  const skinTones = ['#e8b88c', '#cc9264', '#a87044', '#80502c', '#583820'];
  const wallSec = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
  const baseBob = 0.6; // pixels — gentle idle sway
  const eruptBob = Math.min(2.5, energy * 4); // adds up to ~4px of jitter at peak
  const armsUpThreshold = 0.55; // above this energy, some fans throw their arms up

  const drawCrowdRow = (x0: number, x1: number, y: number, rowHash: number) => {
    for (let x = x0; x < x1; x += 6) {
      const h = (x * 31 + y * 53 + rowHash * 17) | 0;
      if (((h >>> 3) & 0x7) === 0) continue;
      const shirt = shirtColors[Math.abs(h) % shirtColors.length];
      const skin = skinTones[Math.abs(h >> 4) % skinTones.length];
      const phase = ((h >>> 7) & 0xff) / 255;
      // Idle sway + eruption jitter.
      const bob =
        Math.sin((wallSec + phase) * 6) * baseBob +
        Math.sin((wallSec + phase) * 14) * eruptBob;
      const yy = y + Math.round(bob);
      ctx.fillStyle = shirt;
      ctx.fillRect(x, yy + 3, 4, 4);
      ctx.fillStyle = skin;
      ctx.fillRect(x + 1, yy, 3, 3);
      // Arms-up: a fraction of the crowd at peak eruption pumps their fists.
      if (energy > armsUpThreshold && ((h >>> 12) & 0x3) === 0) {
        ctx.fillRect(x, yy - 2, 1, 2);
        ctx.fillRect(x + 4, yy - 2, 1, 2);
      }
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

  // Announcer table at the bottom — also the table that breaks during the
  // table-spot event.
  drawAnnouncerTable(ctx, ringLeft, ringBottom, energy, wallSec, tableBroken);

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

/**
 * Bigger, animated commentators behind the announcer table. Each has a head,
 * shoulders, and a headset; both bob to wall-clock so they look engaged.
 * During eruption they throw a hand up. When the table is broken, the
 * commentators dive out of the way and the table is shown split in half.
 */
function drawAnnouncerTable(
  ctx: CanvasRenderingContext2D,
  ringLeft: number,
  ringBottom: number,
  energy: number,
  wallSec: number,
  broken: boolean,
): void {
  // Bigger table for proportionality with the (48x64px) wrestler sprites.
  // Pushed down enough that commentator heads stay below the ring's bottom
  // rope rather than poking up behind the mat.
  const tableY = ringBottom + 42;
  const tableLeft = ringLeft + RING.halfW - 130;
  const tableW = 260;

  if (broken) {
    // Two halves splayed apart; toppled mic stands; splintered middle.
    ctx.fillStyle = '#5a3a20';
    ctx.fillRect(tableLeft - 10, tableY + 6, tableW / 2 - 12, 14);
    ctx.fillStyle = '#7a5230';
    ctx.fillRect(tableLeft - 10, tableY + 3, tableW / 2 - 12, 4);
    ctx.fillStyle = '#5a3a20';
    ctx.fillRect(tableLeft + tableW / 2 + 12, tableY + 6, tableW / 2 - 12, 14);
    ctx.fillStyle = '#7a5230';
    ctx.fillRect(tableLeft + tableW / 2 + 12, tableY + 3, tableW / 2 - 12, 4);
    // Splintered middle gap
    ctx.fillStyle = '#3a2515';
    ctx.fillRect(tableLeft + tableW / 2 - 12, tableY + 14, 24, 7);
    ctx.fillStyle = '#8a6238';
    ctx.fillRect(tableLeft + tableW / 2 - 5, tableY + 6, 1, 6);
    ctx.fillRect(tableLeft + tableW / 2 - 1, tableY + 6, 1, 6);
    ctx.fillRect(tableLeft + tableW / 2 + 3, tableY + 6, 1, 6);
    // Loose splinter bits scattered
    ctx.fillStyle = '#5a3a20';
    ctx.fillRect(tableLeft + tableW / 2 - 12, tableY + 18, 2, 1);
    ctx.fillRect(tableLeft + tableW / 2 + 6, tableY + 18, 2, 1);
    ctx.fillRect(tableLeft + tableW / 2 - 2, tableY + 20, 3, 1);
    // Toppled mics on the floor
    ctx.fillStyle = '#aaaaaa';
    ctx.fillRect(tableLeft + 24, tableY + 22, 8, 1);
    ctx.fillRect(tableLeft + tableW - 32, tableY + 22, 8, 1);
    ctx.fillRect(tableLeft + 23, tableY + 21, 3, 2);
    ctx.fillRect(tableLeft + tableW - 26, tableY + 21, 3, 2);

    // Commentators FREAKING OUT — bigger jump, both hands up, panicked.
    const freakOut = (
      cx: number,
      skin: string,
      hair: string,
      shirt: string,
      phase: number,
    ) => {
      const jump = Math.round(Math.abs(Math.sin((wallSec + phase) * 9)) * 6);
      const handFlail = Math.sin((wallSec + phase) * 12) > 0;
      // Shoulders/torso visible above the wreckage.
      ctx.fillStyle = shirt;
      ctx.fillRect(cx - 10, tableY - 8 - jump, 20, 10);
      ctx.fillStyle = skin;
      ctx.fillRect(cx - 2, tableY - 13 - jump, 5, 5);
      ctx.fillRect(cx - 8, tableY - 26 - jump, 16, 14);
      ctx.fillStyle = hair;
      ctx.fillRect(cx - 8, tableY - 28 - jump, 16, 4);
      ctx.fillRect(cx - 10, tableY - 25 - jump, 2, 5);
      ctx.fillRect(cx + 8, tableY - 25 - jump, 2, 5);
      // Eyes — wide open.
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(cx - 5, tableY - 20 - jump, 3, 3);
      ctx.fillRect(cx + 2, tableY - 20 - jump, 3, 3);
      // Open mouth (shouting).
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(cx - 3, tableY - 15 - jump, 6, 3);
      // Both hands UP — flailing.
      ctx.fillStyle = skin;
      const lH = handFlail ? -5 : -1;
      const rH = handFlail ? -1 : -5;
      ctx.fillRect(cx - 14, tableY - 22 - jump + lH, 3, 10);
      ctx.fillRect(cx + 11, tableY - 22 - jump + rH, 3, 10);
    };
    freakOut(tableLeft + 60, '#cc9264', '#3a2418', '#222244', 0);
    freakOut(tableLeft + tableW - 60, '#a87044', '#1a1a1a', '#552222', 0.5);
    return;
  }

  // ---- Intact table ----
  ctx.fillStyle = '#5a3a20';
  ctx.fillRect(tableLeft, tableY, tableW, 16);
  ctx.fillStyle = '#3a2515';
  ctx.fillRect(tableLeft, tableY + 14, tableW, 2);
  // Black skirt
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(tableLeft, tableY + 16, tableW, 22);
  // Two taller mic stands
  ctx.fillStyle = '#aaaaaa';
  ctx.fillRect(tableLeft + 52, tableY - 14, 2, 14);
  ctx.fillRect(tableLeft + tableW - 54, tableY - 14, 2, 14);
  ctx.fillRect(tableLeft + 50, tableY - 18, 5, 5);
  ctx.fillRect(tableLeft + tableW - 56, tableY - 18, 5, 5);

  const commentator = (
    cx: number,
    skin: string,
    hair: string,
    shirt: string,
    phase: number,
  ) => {
    const bob = Math.round(Math.sin((wallSec + phase) * 3.2) * 0.8);
    const handUp = energy > 0.6 && Math.sin((wallSec + phase) * 4) > 0.3;
    // Shoulders/shirt (bigger so it reads at sprite scale)
    ctx.fillStyle = shirt;
    ctx.fillRect(cx - 10, tableY - 8 + bob, 20, 10);
    // Neck
    ctx.fillStyle = skin;
    ctx.fillRect(cx - 2, tableY - 13 + bob, 5, 5);
    // Head
    ctx.fillRect(cx - 8, tableY - 26 + bob, 16, 14);
    // Hair on top
    ctx.fillStyle = hair;
    ctx.fillRect(cx - 8, tableY - 28 + bob, 16, 4);
    ctx.fillRect(cx - 10, tableY - 25 + bob, 2, 5); // sideburn left
    ctx.fillRect(cx + 8, tableY - 25 + bob, 2, 5);
    // Eyes
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(cx - 5, tableY - 20 + bob, 2, 2);
    ctx.fillRect(cx + 3, tableY - 20 + bob, 2, 2);
    // Mouth — open when bob is up (talking effect)
    if (bob <= 0) {
      ctx.fillRect(cx - 2, tableY - 16 + bob, 5, 2);
    } else {
      ctx.fillRect(cx - 2, tableY - 16 + bob, 4, 1);
    }
    // Headset
    ctx.fillStyle = '#222233';
    ctx.fillRect(cx - 8, tableY - 30 + bob, 16, 2);
    ctx.fillRect(cx - 10, tableY - 22 + bob, 2, 4); // ear cup left
    ctx.fillRect(cx + 8, tableY - 22 + bob, 2, 4); // ear cup right
    // Hand raised during eruption
    if (handUp) {
      ctx.fillStyle = skin;
      ctx.fillRect(cx - 14, tableY - 18 + bob, 3, 9);
    }
  };

  commentator(tableLeft + 60, '#cc9264', '#3a2418', '#222244', 0);
  commentator(tableLeft + tableW - 60, '#a87044', '#1a1a1a', '#552222', 0.5);
}

interface RopeBounce {
  side: 'top' | 'bottom' | 'left' | 'right';
  pos: number; // position along the rope (canvas pixels)
  bulge: number; // pixels of inward stretch
}

/**
 * Detect a clothesline-bouncing wrestler and compute how much the nearest
 * rope should stretch inward (slingshot). Bulge peaks during the bounce
 * phase (animPhase 0.40-0.55).
 */
function computeRopeBounce(state: MatchState): RopeBounce | null {
  for (const w of state.wrestlers) {
    if (w.state !== 'attacking' || w.attackMove !== 'clothesline') continue;
    // Tight window: bulge only shows during the actual rope contact (0.38-0.52
    // animPhase). Outside that, the rope is normal. This stops the sliding-
    // along-the-rope effect that read as "ropes dancing around."
    if (w.animPhase < 0.38 || w.animPhase > 0.52) continue;
    // Pick the nearest rope side and snap the bulge position to the wrestler's
    // contact spot at the moment of bounce.
    const left = RING.cx - RING.halfW;
    const right = RING.cx + RING.halfW;
    const top = RING.cy - RING.halfH;
    const bottom = RING.cy + RING.halfH;
    const distLeft = w.x - left;
    const distRight = right - w.x;
    const distTop = w.y - top;
    const distBottom = bottom - w.y;
    const minD = Math.min(distLeft, distRight, distTop, distBottom);
    let side: 'left' | 'right' | 'top' | 'bottom';
    let pos: number;
    if (minD === distLeft) {
      side = 'left';
      pos = w.y;
    } else if (minD === distRight) {
      side = 'right';
      pos = w.y;
    } else if (minD === distTop) {
      side = 'top';
      pos = w.x;
    } else {
      side = 'bottom';
      pos = w.x;
    }
    // Single sine pulse over the 0.14-wide window: 0 → peak → 0.
    const t = (w.animPhase - 0.38) / 0.14;
    const bulge = Math.sin(t * Math.PI) * 12;
    return { side, pos, bulge };
  }
  return null;
}

function drawRing(
  ctx: CanvasRenderingContext2D,
  leagueName: string,
  rb: RopeBounce | null,
): void {
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

  // Ropes — drawn as polylines so they can bulge inward for the clothesline
  // slingshot. Each rope on each side gets a triangular V-pinch at the bounce
  // point, peak inward at rb.bulge pixels.
  const ropeColors = ['#cc3030', '#cc8030', '#30cc60'];
  const drawRope = (
    pts: ReadonlyArray<[number, number]>,
    color: string,
    thick: number,
  ) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = thick;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  };
  const PINCH_HALFW = 28; // how wide the V is along the rope
  const sidePoints = (
    side: 'top' | 'bottom' | 'left' | 'right',
    offset: number,
  ): Array<[number, number]> => {
    // Horizontal ropes (top/bottom): two endpoints at the corners, plus
    // optional bulge point. Vertical ropes (left/right): similar.
    if (side === 'top' || side === 'bottom') {
      const ropeY = side === 'top' ? top + offset : top + h - offset;
      const pts: Array<[number, number]> = [[left - 4, ropeY]];
      if (rb && rb.side === side) {
        const bp = Math.max(left + 6, Math.min(left + w - 6, rb.pos));
        const inward = side === 'top' ? rb.bulge : -rb.bulge;
        pts.push([bp - PINCH_HALFW, ropeY]);
        pts.push([bp, ropeY + inward]);
        pts.push([bp + PINCH_HALFW, ropeY]);
      }
      pts.push([left + w + 4, ropeY]);
      return pts;
    }
    const ropeX = side === 'left' ? left + offset : left + w - offset;
    const pts: Array<[number, number]> = [[ropeX, top - 4]];
    if (rb && rb.side === side) {
      const bp = Math.max(top + 6, Math.min(top + h - 6, rb.pos));
      const inward = side === 'left' ? rb.bulge : -rb.bulge;
      pts.push([ropeX, bp - PINCH_HALFW]);
      pts.push([ropeX + inward, bp]);
      pts.push([ropeX, bp + PINCH_HALFW]);
    }
    pts.push([ropeX, top + h + 4]);
    return pts;
  };

  for (let i = 0; i < 3; i++) {
    const off = ROPE_BAND - i * 6;
    drawRope(sidePoints('top', off), ropeColors[i], 2);
    drawRope(sidePoints('bottom', off), ropeColors[i], 2);
    drawRope(sidePoints('left', off), ropeColors[i], 2);
    drawRope(sidePoints('right', off), ropeColors[i], 2);
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
    case 'celebrating':
      anim = Animation.Celebrate;
      break;
    case 'mounting':
      // Reuse the Attack row (arm extended) — the mounted attacker is
      // cycling through punches at MOUNT_PUNCH_INTERVAL.
      anim = Animation.Attack;
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

