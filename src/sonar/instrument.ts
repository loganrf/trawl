// Common interface for survey instruments. The side-scan is the first one; a multibeam,
// sub-bottom profiler or magnetometer can plug in through the same shape.

import type { Boat } from '../vessel/boat';
import type { Towfish } from '../vessel/towfish';
import type { Terrain } from '../world/terrain';
import type { Plume } from '../world/features';

export interface SonarContext {
  time: number;
  boat: Boat;
  fish: Towfish;
  terrain: Terrain;
  plumes: Plume[];
}

export interface Instrument {
  readonly id: string;
  readonly name: string;
  enabled: boolean;
  update(dt: number, ctx: SonarContext): void;
}
