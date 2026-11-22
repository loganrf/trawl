// Named places around Puget Sound (approximate positions) for HUD and survey hints.

import type { BaseMap } from './bathymetry';

export interface Place {
  name: string;
  lat: number;
  lon: number;
  x: number;
  z: number;
}

const RAW: [string, number, number][] = [
  ['Port Townsend', 48.11, -122.76],
  ['Admiralty Inlet', 48.03, -122.64],
  ['Marrowstone Island', 48.05, -122.69],
  ['Port Ludlow', 47.92, -122.68],
  ['Hood Canal Bridge', 47.86, -122.63],
  ['Dabob Bay', 47.75, -122.85],
  ['Hood Canal', 47.65, -122.95],
  ['Hoodsport', 47.41, -123.13],
  ['Great Bend', 47.38, -123.03],
  ['Lynch Cove', 47.42, -122.88],
  ['Point No Point', 47.912, -122.527],
  ['Possession Sound', 47.97, -122.33],
  ['Saratoga Passage', 48.1, -122.47],
  ['Holmes Harbor', 48.05, -122.53],
  ['Port Susan', 48.14, -122.39],
  ['Everett', 47.98, -122.24],
  ['Mukilteo', 47.95, -122.31],
  ['Edmonds', 47.81, -122.4],
  ['Kingston', 47.79, -122.5],
  ['Port Madison', 47.7, -122.53],
  ['Agate Pass', 47.712, -122.57],
  ['Shilshole Bay', 47.68, -122.41],
  ['West Point', 47.662, -122.435],
  ['Elliott Bay', 47.605, -122.36],
  ['Alki Point', 47.576, -122.42],
  ['Bainbridge Island', 47.63, -122.52],
  ['Rich Passage', 47.59, -122.545],
  ['Sinclair Inlet', 47.545, -122.65],
  ['Dyes Inlet', 47.62, -122.7],
  ['Blake Island', 47.54, -122.49],
  ['Vashon Island', 47.44, -122.46],
  ['East Passage', 47.43, -122.38],
  ['Colvos Passage', 47.43, -122.53],
  ['Quartermaster Harbor', 47.38, -122.46],
  ['Point Robinson', 47.388, -122.374],
  ['Commencement Bay', 47.285, -122.44],
  ['Tacoma Narrows', 47.27, -122.55],
  ['Gig Harbor', 47.33, -122.59],
  ['Fox Island', 47.25, -122.62],
  ['Carr Inlet', 47.3, -122.7],
  ['McNeil Island', 47.21, -122.68],
  ['Anderson Island', 47.16, -122.7],
  ['Nisqually Reach', 47.13, -122.73],
  ['Case Inlet', 47.3, -122.83],
  ['Pickering Passage', 47.28, -122.89],
  ['Dana Passage', 47.16, -122.87],
  ['Budd Inlet', 47.09, -122.91],
  ['Eld Inlet', 47.1, -122.96],
  ['Totten Inlet', 47.12, -123.0],
  ['Hammersley Inlet', 47.2, -123.03],
];

export class Places {
  readonly list: Place[];

  constructor(map: BaseMap) {
    this.list = RAW.map(([name, lat, lon]) => {
      const p = map.fromGeo(lat, lon);
      return { name, lat, lon, x: p.x, z: p.z };
    });
  }

  nearest(x: number, z: number): { place: Place; dist: number } {
    let best = this.list[0];
    let bd = Infinity;
    for (const p of this.list) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return { place: best, dist: Math.sqrt(bd) };
  }

  byName(name: string): Place | undefined {
    return this.list.find((p) => p.name === name);
  }

  /** Text such as "1.2 km NW of Alki Point". Distances are real-world (×10). */
  describe(x: number, z: number, hScale: number): string {
    const { place, dist } = this.nearest(x, z);
    const realKm = (dist * hScale) / 1000;
    if (realKm < 0.8) return `off ${place.name}`;
    const ang = Math.atan2(x - place.x, -(z - place.z));
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const dir = dirs[(Math.round(ang / (Math.PI / 4)) + 8) % 8];
    return `${realKm.toFixed(1)} km ${dir} of ${place.name}`;
  }
}
