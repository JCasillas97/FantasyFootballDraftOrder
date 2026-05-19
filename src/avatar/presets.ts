import type { Avatar } from './avatar';

/**
 * 12 distinct preset avatars. Used as defaults when a roster is first created
 * so 12 fresh players look meaningfully different without forcing the user
 * through the avatar editor before their first match.
 */
export const DEFAULT_AVATARS: readonly Avatar[] = [
  { skinTone: 1, hairStyle: 1, hairColor: 1, facialHair: 0, headgear: 0, gearColor: 0, accessory: 0 },
  { skinTone: 3, hairStyle: 3, hairColor: 0, facialHair: 1, headgear: 0, gearColor: 1, accessory: 0 },
  { skinTone: 0, hairStyle: 4, hairColor: 4, facialHair: 0, headgear: 0, gearColor: 2, accessory: 1 },
  { skinTone: 4, hairStyle: 0, hairColor: 0, facialHair: 3, headgear: 1, gearColor: 3, accessory: 0 },
  { skinTone: 2, hairStyle: 5, hairColor: 2, facialHair: 0, headgear: 0, gearColor: 4, accessory: 2 },
  { skinTone: 5, hairStyle: 2, hairColor: 0, facialHair: 2, headgear: 0, gearColor: 5, accessory: 0 },
  { skinTone: 1, hairStyle: 7, hairColor: 5, facialHair: 0, headgear: 3, gearColor: 6, accessory: 0 },
  { skinTone: 3, hairStyle: 6, hairColor: 1, facialHair: 4, headgear: 0, gearColor: 7, accessory: 0 },
  { skinTone: 2, hairStyle: 1, hairColor: 9, facialHair: 0, headgear: 2, gearColor: 8, accessory: 1 },
  { skinTone: 0, hairStyle: 4, hairColor: 8, facialHair: 0, headgear: 0, gearColor: 9, accessory: 3 },
  { skinTone: 4, hairStyle: 3, hairColor: 10, facialHair: 0, headgear: 0, gearColor: 10, accessory: 0 },
  { skinTone: 6, hairStyle: 0, hairColor: 0, facialHair: 0, headgear: 4, gearColor: 11, accessory: 1 },
];

export function presetAvatar(playerIndex: number): Avatar {
  return { ...DEFAULT_AVATARS[playerIndex % DEFAULT_AVATARS.length] };
}
