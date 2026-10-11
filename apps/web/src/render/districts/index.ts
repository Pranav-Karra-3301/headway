import { APARTMENTS } from './apartments';
import { CAMPUS } from './campus';
import { DOWNTOWN } from './downtown';
import { OUTSKIRTS } from './outskirts';
import { STADIUM } from './stadium';
import type { DistrictScenery } from './types';

export const DISTRICTS: DistrictScenery[] = [CAMPUS, DOWNTOWN, APARTMENTS, STADIUM, OUTSKIRTS];
export * from './types';
