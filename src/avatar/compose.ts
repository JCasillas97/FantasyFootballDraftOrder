import {
  type Avatar,
  SKIN_PALETTE,
  HAIR_PALETTE,
  HAIR_STYLES,
  HEADGEAR_STYLES,
  FACIAL_STYLES,
  ACCESSORY_STYLES,
  GEAR_PALETTE,
} from './avatar';

/**
 * Sprite sheet layout. Each frame is SPRITE_W × SPRITE_H. The full sheet is
 * SPRITE_COLS × SPRITE_ROWS of frames laid out left-to-right, top-to-bottom.
 *
 * Row indices double as Animation values so the renderer can derive sheet
 * coordinates with simple multiplication.
 */
export const SPRITE_W = 24;
export const SPRITE_H = 32;
export const SPRITE_COLS = 4;
export const SPRITE_ROWS = 8;
export const SHEET_W = SPRITE_W * SPRITE_COLS;
export const SHEET_H = SPRITE_H * SPRITE_ROWS;

export enum Animation {
  Idle = 0,
  Walk = 1,
  Attack = 2,
  Thrown = 3,
  Eliminated = 4,
  Kick = 5,
  TopRope = 6,
  Celebrate = 7,
}

/** Compose an avatar into a baked sprite sheet. Run once per match. */
export function composeAvatarSheet(avatar: Avatar): HTMLCanvasElement {
  const sheet = document.createElement('canvas');
  sheet.width = SHEET_W;
  sheet.height = SHEET_H;
  const ctx = sheet.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  for (let anim = 0; anim < SPRITE_ROWS; anim++) {
    for (let frame = 0; frame < SPRITE_COLS; frame++) {
      const fx = frame * SPRITE_W;
      const fy = anim * SPRITE_H;
      drawFrame(ctx, fx, fy, avatar, anim as Animation, frame);
    }
  }
  return sheet;
}

/** Pose modifiers per (animation, frame). Drives leg/arm positions etc. */
interface Pose {
  legShift: -1 | 0 | 1;
  armExtended: boolean;
  bodyBob: number; // vertical offset
  rotation: number; // radians; non-zero for thrown
  flatten: boolean; // true for eliminated (lying down)
  raiseArms: boolean; // true for victory pose or for thrown
  /** Kicking-leg extension phase (0 = no kick, 1 = full extend right). */
  kickExtended: number;
  /** Top-rope dive: body horizontal, arms forward like a flying tackle. */
  diving: boolean;
}

function getPose(anim: Animation, frame: number): Pose {
  const base: Pose = {
    legShift: 0,
    armExtended: false,
    bodyBob: 0,
    rotation: 0,
    flatten: false,
    raiseArms: false,
    kickExtended: 0,
    diving: false,
  };
  switch (anim) {
    case Animation.Idle:
      return { ...base, bodyBob: frame === 1 || frame === 3 ? -1 : 0 };
    case Animation.Walk:
      return {
        ...base,
        legShift: frame === 1 ? -1 : frame === 3 ? 1 : 0,
        bodyBob: frame === 1 || frame === 3 ? -1 : 0,
      };
    case Animation.Attack:
      return { ...base, armExtended: frame === 1 || frame === 2 };
    case Animation.Kick:
      // Hold the full kick pose across most of the animation so it actually
      // reads visually before the cycle ends.
      return {
        ...base,
        kickExtended: frame === 0 ? 0.4 : 1,
        bodyBob: frame === 0 ? 0 : -1,
      };
    case Animation.TopRope:
      // Forward-diving pose. Body tilts forward, arms thrust out, legs back.
      // Rotation kept modest so the sprite doesn't clip the cell.
      return { ...base, diving: true, rotation: 0.45, bodyBob: -2 };
    case Animation.Thrown:
      return {
        ...base,
        bodyBob: -frame * 2,
        rotation: (frame * Math.PI) / 8,
        raiseArms: true,
      };
    case Animation.Eliminated:
      return {
        ...base,
        rotation: Math.PI / 2,
        flatten: true,
        raiseArms: false,
      };
    case Animation.Celebrate:
      // Arms up; small jumping bob per frame so the winner looks alive.
      return {
        ...base,
        raiseArms: true,
        bodyBob: frame % 2 === 0 ? -2 : 0,
      };
  }
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  fx: number,
  fy: number,
  avatar: Avatar,
  anim: Animation,
  frame: number,
): void {
  const pose = getPose(anim, frame);
  const skin = SKIN_PALETTE[avatar.skinTone] ?? SKIN_PALETTE[1];
  const skinShade = shade(skin, -0.25);
  const hairColor = HAIR_PALETTE[avatar.hairColor] ?? HAIR_PALETTE[0];
  const gear = GEAR_PALETTE[avatar.gearColor] ?? GEAR_PALETTE[0];
  const gearShade = shade(gear, -0.3);
  const outline = '#1a0a14';

  // Body-type modifiers. Width bonus widens torso/trunks; height offset
  // pushes the upper body up/down so taller/shorter wrestlers read at a
  // glance. Boots stay anchored at the bottom; legs stretch to fill.
  const widthBonus = (avatar.build ?? 1) - 1; // -1 skinny, 0 medium, +1 fat
  const heightShift = ((avatar.height ?? 1) - 1) * -2; // tall = -2 (up), short = +2 (down)
  const torsoLeft = 7 - widthBonus;
  const torsoRight = 16 + widthBonus;
  const torsoWidth = torsoRight - torsoLeft + 1;
  const leftArmX = 5 - widthBonus;
  const rightArmX = 17 + widthBonus;

  ctx.save();
  // Translate to frame's center, apply rotation, then translate back. Pixel
  // art rotations look chunky on purpose; smoothing is already off.
  const cx = fx + SPRITE_W / 2;
  const cy = fy + SPRITE_H / 2;
  ctx.translate(cx, cy + pose.bodyBob);
  ctx.rotate(pose.rotation);
  ctx.translate(-SPRITE_W / 2, -SPRITE_H / 2);

  // Pixel helper: x,y are local sprite coords (0..SPRITE_W, 0..SPRITE_H).
  const px = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };

  // ---- Boots + legs ----
  if (pose.kickExtended > 0) {
    const k = pose.kickExtended;
    px(9, 23 + heightShift, 3, 5 - heightShift, skin);
    px(9, 28, 4, 4, '#1a1a1a');
    const kickReach = Math.round(8 * k);
    const baseEndX = 13;
    const kickEndX = baseEndX + kickReach;
    px(baseEndX, 25 + heightShift, kickReach + 1, 3, skin);
    px(kickEndX, 25 + heightShift, 4, 3, '#1a1a1a');
    px(kickEndX, 25 + heightShift, 4, 1, '#3a3a3a');
  } else {
    const bootY = 28;
    const leftBootX = 8 + pose.legShift;
    const rightBootX = 13 - pose.legShift;
    px(leftBootX, bootY, 4, 4, '#1a1a1a');
    px(rightBootX, bootY, 4, 4, '#1a1a1a');
    px(leftBootX, bootY, 4, 1, '#3a3a3a');
    px(rightBootX, bootY, 4, 1, '#3a3a3a');
    // Legs stretch to fill between trunks-bottom and boots.
    const legTop = 23 + heightShift;
    const legHeight = bootY - legTop;
    px(leftBootX, legTop, 3, legHeight, skin);
    px(rightBootX + 1, legTop, 3, legHeight, skin);
    px(leftBootX, bootY - 1, 3, 1, skinShade);
    px(rightBootX + 1, bootY - 1, 3, 1, skinShade);
  }

  // ---- Trunks ----
  px(torsoLeft, 18 + heightShift, torsoWidth, 5, gear);
  px(torsoLeft, 22 + heightShift, torsoWidth, 1, gearShade);
  // Crotch gap
  px(11, 22 + heightShift, 2, 1, outline);

  // ---- Torso (gear color top, like a singlet) ----
  px(torsoLeft, 12 + heightShift, torsoWidth, 7, gear);
  px(torsoLeft, 18 + heightShift, torsoWidth, 1, gearShade);
  // Subtle highlight strap
  px(9, 12 + heightShift, 1, 6, shade(gear, 0.2));

  // ---- Belly bulge for fat builds ----
  if (widthBonus >= 1) {
    px(torsoLeft - 1, 15 + heightShift, 1, 3, gear);
    px(torsoRight + 1, 15 + heightShift, 1, 3, gear);
  }

  // ---- Arms ----
  if (pose.diving) {
    px(rightArmX, 12 + heightShift, 5, 2, skin);
    px(rightArmX + 4, 12 + heightShift, 2, 2, skin);
    px(rightArmX, 14 + heightShift, 5, 2, skin);
    px(rightArmX + 4, 14 + heightShift, 2, 2, skin);
    px(rightArmX, 13 + heightShift, 5, 1, skinShade);
  } else if (pose.armExtended) {
    px(rightArmX, 14 + heightShift, 5, 3, skin);
    px(rightArmX + 4, 14 + heightShift, 2, 3, skin);
    px(rightArmX, 16 + heightShift, 5, 1, skinShade);
    px(leftArmX, 14 + heightShift, 2, 5, skin);
    px(leftArmX, 18 + heightShift, 2, 1, skinShade);
  } else if (pose.kickExtended > 0) {
    px(leftArmX - 1, 14 + heightShift, 2, 5, skin);
    px(leftArmX - 1, 18 + heightShift, 2, 1, skinShade);
    px(torsoLeft, 13 + heightShift, 2, 6, skin);
  } else if (pose.raiseArms) {
    px(leftArmX, 10 + heightShift, 2, 5, skin);
    px(rightArmX, 10 + heightShift, 2, 5, skin);
  } else {
    px(leftArmX, 13 + heightShift, 2, 6, skin);
    px(rightArmX, 13 + heightShift, 2, 6, skin);
    px(leftArmX, 18 + heightShift, 2, 1, skinShade);
    px(rightArmX, 18 + heightShift, 2, 1, skinShade);
  }

  // ---- Head/face (shifts with height so taller wrestlers' heads sit higher) ----
  const hY = heightShift;
  px(8, 4 + hY, 8, 8, skin);
  px(8, 11 + hY, 8, 1, skinShade);
  px(15, 4 + hY, 1, 8, skinShade);
  px(10, 7 + hY, 1, 1, outline);
  px(13, 7 + hY, 1, 1, outline);
  px(11, 9 + hY, 2, 1, outline);

  // ---- Hair / headgear ----
  drawHair(ctx, avatar.hairStyle, hairColor, hY, px);
  drawFacial(ctx, avatar.facialHair, hairColor, hY, px);
  drawHeadgear(ctx, avatar.headgear, gear, hY, px);

  // ---- Accessory (drawn over torso) ----
  drawAccessory(ctx, avatar.accessory, gear, heightShift, px);

  // ---- Outline pass (lightweight) ----
  if (!pose.flatten) {
    px(7, 4 + hY, 1, 8, outline);
    px(16, 4 + hY, 1, 8, outline);
    px(8, 3 + hY, 8, 1, outline);
  }

  ctx.restore();
}

type PxFn = (x: number, y: number, w: number, h: number, color: string) => void;

function drawHair(
  _ctx: CanvasRenderingContext2D,
  styleIdx: number,
  color: string,
  dy: number,
  px: PxFn,
): void {
  const style = HAIR_STYLES[styleIdx] ?? 'bald';
  switch (style) {
    case 'bald':
      return;
    case 'short':
      px(8, 2 + dy, 8, 2, color);
      px(7, 3 + dy, 10, 1, color);
      return;
    case 'crew':
      px(8, 3 + dy, 8, 1, color);
      return;
    case 'mohawk':
      px(11, 0 + dy, 2, 4, color);
      px(10, 1 + dy, 4, 2, color);
      return;
    case 'long':
      px(7, 2 + dy, 10, 3, color);
      px(7, 4 + dy, 1, 8, color);
      px(16, 4 + dy, 1, 8, color);
      return;
    case 'mullet':
      px(8, 3 + dy, 8, 1, color);
      px(7, 11 + dy, 10, 3, color);
      return;
    case 'curly':
      px(7, 1 + dy, 2, 2, color);
      px(10, 1 + dy, 2, 2, color);
      px(13, 1 + dy, 2, 2, color);
      px(16, 1 + dy, 1, 2, color);
      px(7, 3 + dy, 10, 1, color);
      return;
    case 'spiky':
      px(8, 1 + dy, 1, 3, color);
      px(10, 0 + dy, 1, 4, color);
      px(12, 1 + dy, 1, 3, color);
      px(14, 0 + dy, 1, 4, color);
      px(7, 3 + dy, 10, 1, color);
      return;
  }
}

function drawFacial(
  _ctx: CanvasRenderingContext2D,
  styleIdx: number,
  color: string,
  dy: number,
  px: PxFn,
): void {
  const style = FACIAL_STYLES[styleIdx] ?? 'none';
  switch (style) {
    case 'none':
      return;
    case 'mustache':
      px(10, 8 + dy, 4, 1, color);
      return;
    case 'goatee':
      px(11, 10 + dy, 2, 2, color);
      return;
    case 'beard':
      px(8, 10 + dy, 8, 2, color);
      px(10, 8 + dy, 4, 1, color);
      return;
    case 'sideburns':
      px(8, 7 + dy, 1, 4, color);
      px(15, 7 + dy, 1, 4, color);
      return;
  }
}

function drawHeadgear(
  _ctx: CanvasRenderingContext2D,
  styleIdx: number,
  gearColor: string,
  dy: number,
  px: PxFn,
): void {
  const style = HEADGEAR_STYLES[styleIdx] ?? 'none';
  switch (style) {
    case 'none':
      return;
    case 'headband':
      px(7, 5 + dy, 10, 1, '#e6c016');
      px(8, 6 + dy, 1, 1, '#e6c016');
      return;
    case 'mask':
      px(7, 4 + dy, 10, 4, gearColor);
      px(10, 7 + dy, 1, 1, '#ffffff');
      px(13, 7 + dy, 1, 1, '#ffffff');
      return;
    case 'cap':
      px(7, 2 + dy, 10, 2, '#2a2a2a');
      px(7, 4 + dy, 10, 1, '#2a2a2a');
      px(13, 4 + dy, 4, 1, '#2a2a2a');
      return;
    case 'crown':
      px(8, 1 + dy, 1, 2, '#ffcc00');
      px(11, 0 + dy, 1, 3, '#ffcc00');
      px(14, 1 + dy, 1, 2, '#ffcc00');
      px(7, 3 + dy, 10, 1, '#ffcc00');
      return;
  }
}

function drawAccessory(
  _ctx: CanvasRenderingContext2D,
  styleIdx: number,
  _gearColor: string,
  dy: number,
  px: PxFn,
): void {
  const style = ACCESSORY_STYLES[styleIdx] ?? 'none';
  switch (style) {
    case 'none':
      return;
    case 'belt':
      px(7, 17 + dy, 10, 2, '#ffcc00');
      px(11, 17 + dy, 2, 2, '#aa3030');
      return;
    case 'wristbands':
      px(4, 18 + dy, 3, 1, '#ffffff');
      px(17, 18 + dy, 3, 1, '#ffffff');
      return;
    case 'cape':
      px(4, 12 + dy, 1, 10, '#a00000');
      px(18, 12 + dy, 1, 10, '#a00000');
      return;
  }
}

function shade(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  if (amount >= 0) {
    r = Math.min(255, r + amount * 255);
    g = Math.min(255, g + amount * 255);
    b = Math.min(255, b + amount * 255);
  } else {
    r = Math.max(0, r + amount * 255);
    g = Math.max(0, g + amount * 255);
    b = Math.max(0, b + amount * 255);
  }
  return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
}
