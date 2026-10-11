// Owner: A1. Downtown palette roles: [Wooden Toy, Miniature Railway, State College Autumn].
// Every role is dt-prefixed so it never shadows a base role (the composer resolves base roles from the shared
// palettes and these from registry.roles). Array lengths match across palettes so an index means the same slot.
// Shared base roles the family also uses: `window` (idx 1 = lit at dusk), `lamp` (glows), `car`, `leaf`.
import type { RoleColors } from '../../types';

export const ROLES: RoleColors = {
  /** Red-brick facades, warm to deep. */
  dtBrick: [
    ['#C8644E', '#D47A5E', '#B85A48', '#DC9270'],
    ['#A9503A', '#93452F', '#B8664A', '#C27C5C'],
    ['#A8483A', '#8F3C30', '#B45A44', '#9A4A3A'],
  ],
  /** Painted facades: cream, butter, mint, peach, powder blue. */
  dtPaint: [
    ['#F6EEDC', '#F3D27E', '#9ED3C0', '#F2B7A0', '#AFCBEA'],
    ['#E3CBA8', '#D9C9A3', '#A9BFA8', '#D8B4A0', '#B8C4CC'],
    ['#EADFC9', '#E9D7A8', '#B9CBB5', '#E3BBA8', '#C8D3DD'],
  ],
  /** Limestone: lintels, sills, cornices, the bank; idx 1 is the shaded band tone. */
  dtStone: [['#F2E8D2', '#E2D3B6'], ['#E6DCC6', '#D6C9AE'], ['#EFE8D8', '#DDD3BF']],
  /** Window frames, columns, piping. */
  dtTrim: ['#FFF9EE', '#F5EFE3', '#FFFFFF'],
  /** Painted storefront frames: teal, navy, oxblood, green, charcoal. */
  dtFront: [
    ['#2F8C80', '#35558A', '#A9483D', '#3F7F5B', '#2B3348'],
    ['#2F7F7A', '#22407A', '#8C2F39', '#4F6F4F', '#2B2A28'],
    ['#0B2A5B', '#1E3A6E', '#7A2E2A', '#2E5B45', '#25272B'],
  ],
  /** Awning canvas: coral, teal, mustard, blue, blush. */
  dtAwning: [
    ['#E9785A', '#3FA796', '#F2C14E', '#5A8BD6', '#E8A2A8'],
    ['#8F3F2C', '#2F7F7A', '#D9A441', '#22407A', '#B87D7D'],
    ['#0B2A5B', '#A8483A', '#E9B03B', '#2E8B57', '#E07A2E'],
  ],
  /** Awning stripes and valance piping. */
  dtCanvas: ['#FFF8EC', '#F5EFE3', '#FFFFFF'],
  /** Sign boards: ink, teal, oxblood, gold, blue. */
  dtSign: [
    ['#2B3348', '#2F8C80', '#A9483D', '#F2C14E', '#35558A'],
    ['#2B2A28', '#2F7F7A', '#8C2F39', '#D9A441', '#22407A'],
    ['#0B2A5B', '#25272B', '#7A2E2A', '#E9B03B', '#2E5B45'],
  ],
  /** Lettering shapes on signs: cream, gold, white, dark (for gold boards). */
  dtInk: [
    ['#FFF3C4', '#F2C14E', '#FFFFFF', '#2B3348'],
    ['#F5EFE3', '#D9A441', '#FFFFFF', '#2B2A28'],
    ['#FFFFFF', '#E9B03B', '#F5F2EA', '#0B2A5B'],
  ],
  /** Flat roof membrane. */
  dtRoof: [['#D9CFC1', '#CEC3B3'], ['#8E9196', '#7E8186'], ['#5B6573', '#4E5866']],
  /** Recesses, fan grilles, interiors. */
  dtDark: ['#39404F', '#2E2F33', '#25272B'],
  /** Rooftop units (idx 0) and railings / fire escapes (idx 1). */
  dtMetal: [['#C3C9D1', '#596070'], ['#B9B4AA', '#4A4F55'], ['#BFC5CD', '#3E4B5C']],
  /** Door leaves: wood, teal, navy, oxblood, green. */
  dtDoor: [
    ['#9B6B43', '#2F8C80', '#35558A', '#A9483D', '#3F7F5B'],
    ['#5A3A2A', '#2F7F7A', '#22407A', '#8C2F39', '#4F6F4F'],
    ['#6B4A35', '#0B2A5B', '#7A2E2A', '#2E5B45', '#1E3A6E'],
  ],
  /** Wood: water tanks, café chairs, planters. */
  dtWood: [['#C69466', '#9B6B43'], ['#8C6B4E', '#7A5A40'], ['#7B5B43', '#6B4A35']],
  /** Parking-garage concrete. */
  dtConcrete: [['#E9E2D6', '#D6CEC1'], ['#DCD3C2', '#C9BFAD'], ['#E2DDD3', '#CFC9BD']],
  /** Verdigris copper: bank roof, turret cap, theatre crest. */
  dtCopper: ['#6CBFA6', '#6E8F7A', '#5E7F8A'],
  /** Tiny flowers in window boxes and planters. */
  dtFlower: [
    ['#F28CA8', '#F6C945', '#FFFFFF', '#E9785A', '#B58CF2'],
    ['#C46A7A', '#D9A441', '#F5EFE3', '#8F3F2C', '#8E7AA8'],
    ['#E07A2E', '#E9B03B', '#FFFFFF', '#C9452E', '#8DA35A'],
  ],
};
