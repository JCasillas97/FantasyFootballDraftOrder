/**
 * Avatar config: the per-player visual identity. The compose step turns this
 * into a baked sprite sheet. The editor in Phase 4 will mutate fields here.
 *
 * Values are indices into the catalogs below, never raw colors — that way the
 * editor UI can present a finite set of named choices, and roster JSON exports
 * stay compact and stable across versions.
 */
export interface Avatar {
  skinTone: number; // index into SKIN_PALETTE
  hairStyle: number; // index into HAIR_STYLES
  hairColor: number; // index into HAIR_PALETTE
  facialHair: number; // index into FACIAL_STYLES (0 = none)
  headgear: number; // index into HEADGEAR_STYLES (0 = none)
  gearColor: number; // index into GEAR_PALETTE (trunks/singlet)
  accessory: number; // index into ACCESSORY_STYLES (0 = none)
  height: number; // index into HEIGHT_OPTIONS (0=short, 1=medium, 2=tall)
  build: number; // index into BUILD_OPTIONS (0=skinny, 1=medium, 2=fat)
}

export const HEIGHT_OPTIONS = ['short', 'medium', 'tall'] as const;
export const BUILD_OPTIONS = ['skinny', 'medium', 'fat'] as const;

export const SKIN_PALETTE: readonly string[] = [
  '#f8d8b8', // very light
  '#e8b88c', // light
  '#cc9264', // medium-light
  '#a87044', // medium
  '#80502c', // medium-dark
  '#583820', // dark
  '#3c2818', // very dark
];

export const HAIR_PALETTE: readonly string[] = [
  '#000000', // black
  '#3a2418', // dark brown
  '#7a4818', // brown
  '#c08040', // light brown
  '#e8c878', // blonde
  '#d83838', // red
  '#583028', // auburn
  '#888888', // gray
  '#ffffff', // white
  '#4a2868', // purple (fun)
  '#1860c8', // blue (fun)
  '#48a848', // green (fun)
];

export const GEAR_PALETTE: readonly string[] = [
  '#cc2020', // red
  '#1c5cd4', // blue
  '#e6c016', // yellow
  '#28a850', // green
  '#a020c8', // purple
  '#e87020', // orange
  '#20a8c0', // cyan
  '#a0a0a0', // silver
  '#202020', // black
  '#e8e8e8', // white
  '#d04098', // pink
  '#604020', // brown
];

export type HairStyle =
  | 'bald'
  | 'short'
  | 'crew'
  | 'mohawk'
  | 'long'
  | 'mullet'
  | 'curly'
  | 'spiky';
export const HAIR_STYLES: readonly HairStyle[] = [
  'bald',
  'short',
  'crew',
  'mohawk',
  'long',
  'mullet',
  'curly',
  'spiky',
];

export type FacialStyle = 'none' | 'mustache' | 'goatee' | 'beard' | 'sideburns';
export const FACIAL_STYLES: readonly FacialStyle[] = [
  'none',
  'mustache',
  'goatee',
  'beard',
  'sideburns',
];

export type HeadgearStyle = 'none' | 'headband' | 'mask' | 'cap' | 'crown';
export const HEADGEAR_STYLES: readonly HeadgearStyle[] = ['none', 'headband', 'mask', 'cap', 'crown'];

export type AccessoryStyle = 'none' | 'belt' | 'wristbands' | 'cape';
export const ACCESSORY_STYLES: readonly AccessoryStyle[] = [
  'none',
  'belt',
  'wristbands',
  'cape',
];

export function defaultAvatar(): Avatar {
  return {
    skinTone: 1,
    hairStyle: 1,
    hairColor: 1,
    facialHair: 0,
    headgear: 0,
    gearColor: 0,
    accessory: 0,
    height: 1,
    build: 1,
  };
}
