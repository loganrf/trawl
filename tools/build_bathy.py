#!/usr/bin/env python3
"""Build the Puget Sound base map for Trawl.

Source: SalishSeaCast NEMO bathymetry (UBC EOAS, Apache-2.0),
https://github.com/SalishSeaCast/grid  (bathymetry_202411.nc)

The source grid is curvilinear (about 450 m x 500 m). This script resamples it
to a regular equirectangular grid (CELL_M metres) over Puget Sound and writes:

  src/data/puget_sound.bin   Int16 little-endian, row-major, north row first.
                                Value = signed field * 10 (0.1 m units):
                                  > 0 : water depth in metres (real)
                                  < 0 : land, -(distance to water in m) * LAND_K
  src/data/puget_sound.json  Grid metadata (size, bounds, projection).

Usage:
  pip install netCDF4 scipy numpy
  python3 tools/build_bathy.py [path/to/bathymetry_202411.nc]
"""
import json
import os
import sys
import urllib.request

import numpy as np
import netCDF4
from scipy import ndimage
from scipy.interpolate import griddata

SRC_URL = "https://raw.githubusercontent.com/SalishSeaCast/grid/main/bathymetry_202411.nc"
LAT_MIN, LAT_MAX = 47.02, 48.24
LON_MIN, LON_MAX = -123.18, -122.18
LAT0 = 0.5 * (LAT_MIN + LAT_MAX)
M_PER_DEG_LAT = 111_132.0
M_PER_DEG_LON = 111_320.0 * np.cos(np.radians(LAT0))
CELL_M = 250.0
LAND_K = 0.02  # land: signed = -dist_m * LAND_K

here = os.path.dirname(os.path.abspath(__file__))
out_dir = os.path.join(here, "..", "src", "data")

src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "bathymetry_202411.nc")
if not os.path.exists(src):
    print("downloading", SRC_URL)
    urllib.request.urlretrieve(SRC_URL, src)

ds = netCDF4.Dataset(src)
lon = np.asarray(ds["nav_lon"][:], dtype=np.float64)
lat = np.asarray(ds["nav_lat"][:], dtype=np.float64)
depth = np.ma.filled(ds["Bathymetry"][:], 0.0).astype(np.float64)

# Land cells carry a small negative value so the coastline (zero contour) falls
# between land and water cell centres after interpolation.
signed = np.where(depth > 0, depth, -6.0)

# Project source points to local metres (x east, y north).
x = (lon - LON_MIN) * M_PER_DEG_LON
y = (lat - LAT_MIN) * M_PER_DEG_LAT
pad = 0.08
sel = (lat > LAT_MIN - pad) & (lat < LAT_MAX + pad) & (lon > LON_MIN - pad) & (lon < LON_MAX + pad)

width_m = (LON_MAX - LON_MIN) * M_PER_DEG_LON
height_m = (LAT_MAX - LAT_MIN) * M_PER_DEG_LAT
nx = int(round(width_m / CELL_M)) + 1
ny = int(round(height_m / CELL_M)) + 1
gx = np.arange(nx) * CELL_M
gy = height_m - np.arange(ny) * CELL_M  # row 0 = north edge
GX, GY = np.meshgrid(gx, gy)

grid = griddata((x[sel], y[sel]), signed[sel], (GX, GY), method="linear")
grid = np.where(np.isnan(grid), -6.0, grid)
# Soften the 450-500 m stair steps of the model grid.
grid = ndimage.gaussian_filter(grid, sigma=1.0)
# Land: replace with distance to the nearest water cell on the target grid.
water = grid > 0
dist = ndimage.distance_transform_edt(~water, sampling=CELL_M)
land = -np.maximum(dist - 0.5 * CELL_M, 0.0) * LAND_K
grid = np.where(water, grid, np.minimum(land, -0.1))

q = np.clip(np.round(grid * 10.0), -32768, 32767).astype("<i2")
os.makedirs(out_dir, exist_ok=True)
q.tofile(os.path.join(out_dir, "puget_sound.bin"))
meta = {
    "source": "SalishSeaCast bathymetry_202411.nc (UBC EOAS, Apache-2.0)",
    "nx": nx, "ny": ny, "cellM": CELL_M,
    "latMin": LAT_MIN, "latMax": LAT_MAX, "lonMin": LON_MIN, "lonMax": LON_MAX,
    "mPerDegLat": M_PER_DEG_LAT, "mPerDegLon": M_PER_DEG_LON,
    "valueScale": 0.1, "landK": LAND_K,
    "rowOrder": "north-first",
}
with open(os.path.join(out_dir, "puget_sound.json"), "w") as f:
    json.dump(meta, f, indent=2)
w = grid > 0
print(f"grid {nx}x{ny}, water cells {w.sum()}, max depth {grid.max():.1f} m")
