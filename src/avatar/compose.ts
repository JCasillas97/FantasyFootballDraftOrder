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
export const SPRITE_ROWS = 7;
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
    // One leg planted, one horizontal kick extending right.
    const k = pose.kickExtended; // 0..1 extension factor
    // Standing leg (left)
    px(9, 23, 3, 5, skin);
    px(9, 28, 4, 4, '#1a1a1a'); // boot
    // Kicking leg: horizontal segment from the hip out
    const kickReach = Math.round(8 * k); // extra pixels of leg
    const baseEndX = 13;
    const kickEndX = baseEndX + kickReach;
    px(baseEndX, 25, kickReach + 1, 3, skin); // horizontal upper-leg
    px(kickEndX, 25, 4, 3, '#1a1a1a'); // boot at end
    px(kickEndX, 25, 4, 1, '#3a3a3a'); // boot shine
  } else {
    const bootY = 28;
    const leftBootX = 8 + pose.legShift;
    const rightBootX = 13 - pose.legShift;
    px(leftBootX, bootY, 4, 4, '#1a1a1a');
    px(rightBootX, bootY, 4, 4, '#1a1a1a');
    px(leftBootX, bootY, 4, 1, '#3a3a3a');
    px(rightBootX, bootY, 4, 1, '#3a3a3a');
    px(leftBootX, 23, 3, 5, skin);
    px(rightBootX + 1, 23, 3, 5, skin);
    px(leftBootX, 27, 3, 1, skinShade);
    px(rightBootX + 1, 27, 3, 1, skinShade);
  }

  // ---- Trunks ----
  px(7, 18, 10, 5, gear);
  px(7, 22, 10, 1, gearShade);
  // Crotch gap
  px(11, 22, 2, 1, outline);

  // ---- Torso (gear color top, like a singlet) ----
  px(7, 12, 10, 7, gear);
  px(7, 18, 10, 1, gearShade);
  // Subtle highlight strap
  px(9, 12, 1, 6, shade(gear, 0.2));

  // ---- Arms ----
  if (pose.diving) {
    // Superman dive: both arms thrust forward together to the right.
    px(17, 12, 5, 2, skin);
    px(21, 12, 2, 2, skin); // fist
    px(17, 14, 5, 2, skin);
    px(21, 14, 2, 2, skin);
    px(17, 13, 5, 1, skinShade);
  } else if (pose.armExtended) {
    // Punching arm extends out to the right.
    px(17, 14, 5, 3, skin);
    px(21, 14, 2, 3, skin); // fist
    px(17, 16, 5, 1, skinShade);
    // Other arm tucked
    px(5, 14, 2, 5, skin);
    px(5, 18, 2, 1, skinShade);
  } else if (pose.kickExtended > 0) {
    // Both arms back for balance during a kick.
    px(4, 14, 2, 5, skin);
    px(4, 18, 2, 1, skinShade);
    px(7, 13, 2, 6, skin);
  } else if (pose.raiseArms) {
    px(5, 10, 2, 5, skin);
    px(17, 10, 2, 5, skin);
  } else {
    px(5, 13, 2, 6, skin);
    px(17, 13, 2, 6, skin);
    px(5, 18, 2, 1, skinShade);
    px(17, 18, 2, 1, skinShade);
  }

  // ---- Head/face ----
  px(8, 4, 8, 8, skin);
  px(8, 11, 8, 1, skinShade); // chin shadow
  px(15, 4, 1, 8, skinShade); // right cheek shade
  // Eyes
  px(10, 7, 1, 1, outline);
  px(13, 7, 1, 1, outline);
  // Mouth
  px(11, 9, 2, 1, outline);

  // ---- Hair / headgear ----
  drawHair(ctx, avatar.hairStyle, hairColor, px);
  drawFacial(ctx, avatar.facialHair, hairColor, px);
  drawHeadgear(ctx, avatar.headgear, gear, px);

  // ---- Accessory (drawn over torso) ----
  drawAccessory(ctx, avatar.accessory, gear, px);

  // ---- Outline pass (lightweight) ----
  // Draw a 1px outline around head + body silhouette to crisp things up.
  if (!pose.flatten) {
    px(7, 4, 1, 8, outline);
    px(16, 4, 1, 8, outline);
    px(8, 3, 8, 1, outline);
  }

  ctx.restore();
}

type PxFn = (x: number, y: number, w: number, h: number, color: string) => void;

function drawHair(
  _ctx: CanvasRenderingContext2D,
  styleIdx: number,
  color: string,
  px: PxFn,
): void {
  const style = HAIR_STYLES[styleIdx] ?? 'bald';
  switch (style) {
    case 'bald':
      return;
    case 'short':
      px(8, 2, 8, 2, color);
      px(7, 3, 10, 1, color);
      return;
    case 'crew':
      px(8, 3, 8, 1, color);
      return;
    case 'mohawk':
      px(11, 0, 2, 4, color);
      px(10, 1, 4, 2, color);
      return;
    case 'long':
      px(7, 2, 10, 3, color);
      px(7, 4, 1, 8, color); // hair down left side
      px(16, 4, 1, 8, color); // hair down right side
      return;
    case 'mullet':
      px(8, 3, 8, 1, color);
      px(7, 11, 10, 3, color);
      return;
    case 'curly':
      px(7, 1, 2, 2, color);
      px(10, 1, 2, 2, color);
      px(13, 1, 2, 2, color);
      px(16, 1, 1, 2, color);
      px(7, 3, 10, 1, color);
      return;
    case 'spiky':
      px(8, 1, 1, 3, color);
      px(10, 0, 1, 4, color);
      px(12, 1, 1, 3, color);
      px(14, 0, 1, 4, color);
      px(7, 3, 10, 1, color);
      return;
  }
}

function drawFacial(
  _ctx: CanvasRenderingContext2D,
  styleIdx: number,
  color: string,
  px: PxFn,
): void {
  const style = FACIAL_STYLES[styleIdx] ?? 'none';
  switch (style) {
    case 'none':
      return;
    case 'mustache':
      px(10, 8, 4, 1, color);
      return;
    case 'goatee':
      px(11, 10, 2, 2, color);
      return;
    case 'beard':
      px(8, 10, 8, 2, color);
      px(10, 8, 4, 1, color);
      return;
    case 'sideburns':
      px(8, 7, 1, 4, color);
      px(15, 7, 1, 4, color);
      return;
  }
}

function drawHeadgear(
  _ctx: CanvasRenderingContext2D,
  styleIdx: number,
  gearColor: string,
  px: PxFn,
): void {
  const style = HEADGEAR_STYLES[styleIdx] ?? 'none';
  switch (style) {
    case 'none':
      return;
    case 'headband':
      px(7, 5, 10, 1, '#e6c016');
      px(8, 6, 1, 1, '#e6c016');
      return;
    case 'mask':
      // Lucha-style mask over upper face
      px(7, 4, 10, 4, gearColor);
      px(10, 7, 1, 1, '#ffffff'); // eye holes
      px(13, 7, 1, 1, '#ffffff');
      return;
    case 'cap':
      px(7, 2, 10, 2, '#2a2a2a');
      px(7, 4, 10, 1, '#2a2a2a');
      px(13, 4, 4, 1, '#2a2a2a'); // brim
      return;
    case 'crown':
      px(8, 1, 1, 2, '#ffcc00');
      px(11, 0, 1, 3, '#ffcc00');
      px(14, 1, 1, 2, '#ffcc00');
      px(7, 3, 10, 1, '#ffcc00');
      return;
  }
}

function drawAccessory(
  _ctx: CanvasRenderingContext2D,
  styleIdx: number,
  _gearColor: string,
  px: PxFn,
): void {
  const style = ACCESSORY_STYLES[styleIdx] ?? 'none';
  switch (style) {
    case 'none':
      return;
    case 'belt':
      px(7, 17, 10, 2, '#ffcc00');
      px(11, 17, 2, 2, '#aa3030');
      return;
    case 'wristbands':
      px(4, 18, 3, 1, '#ffffff');
      px(17, 18, 3, 1, '#ffffff');
      return;
    case 'cape':
      px(4, 12, 1, 10, '#a00000');
      px(18, 12, 1, 10, '#a00000');
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
