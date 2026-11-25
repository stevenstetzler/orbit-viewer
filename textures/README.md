# Surface textures

Equirectangular images (longitude 0 at the image centre) draped on the
body spheres in the `/<body>/` and `/<body>/trajectory/` views -- see
`SURFACE_TEXTURES` in `examples/shared/surfaceTextures.js`. Orientation comes from the
IAU pole/prime-meridian constants in `kernels/pck00011.tpc`
(`examples/shared/bodyOrientation.js`). All images are east-positive, longitude 0 at the centre column.

| File | Source |
| --- | --- |
| `earth.jpg` | NASA Earth Observatory, Blue Marble Next Generation, September 2004 (5400x2700): https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/september/world.200409.3x5400x2700.jpg |
| `moon.jpg` | NASA Scientific Visualization Studio #4720, LROC color mosaic (2048x1024): https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg |

NASA imagery is generally not copyrighted; see
https://www.nasa.gov/nasa-brand-center/images-and-media/ for usage guidelines.

## USGS Astropedia global maps

Everything except `earth.jpg` and `moon.jpg` comes from the USGS Astrogeology
Science Center's Astropedia catalog (https://astrogeology.usgs.gov/search).
Each map was a full-resolution GeoTIFF (up to ~800 MB), downsampled to at most
4096x2048 and re-encoded as a progressive JPEG (quality 82-86, none over 2.5 MB)
so a body's page stays a few MB. Where a source file's central meridian was
not 0 (or its extent did not start at -180), the image was rolled so east
longitude 0 is the centre column. USGS/NASA planetary data is generally public
domain; see each product page's citation and use constraints.

| File | Source product | Source resolution | Credit |
| --- | --- | --- | --- |
| `mercury.jpg` | [Mercury MESSENGER MDIS Basemap MD3 Color Global Mosaic 665m](https://astrogeology.usgs.gov/search/map/mercury_messenger_mdis_basemap_md3_color_global_mosaic_665m) | 665.24 m/px, 23040x11520 | Applied Coherent Technology Corporation |
| `venus.jpg` | [Venus Magellan Global C3-MDIR Synthetic Color Mosaic 4641m](https://astrogeology.usgs.gov/search/map/venus_magellan_global_c3_mdir_synthetic_color_mosaic_4641m) | 4641 m/px, 8192x4096 | USGS Astrogeology Science Center |
| `mars.jpg` | [Mars Viking Global Color Mosaic 925m](https://astrogeology.usgs.gov/search/map/mars_viking_global_color_mosaic_925m) | 925.40 m/px, 23059x11530 | USGS Astrogeology Science Center |
| `ceres.jpg` | [Ceres Dawn FC Global Mosaic 400m](https://astrogeology.usgs.gov/search/map/ceres_dawn_fc_global_mosaic_400m) | 400 m/px, 7383x3691 | NASA/JPL-Caltech/UCLA/MPS/DLR/IDA |
| `io.jpg` | [Io Galileo SSI / Voyager Color Merged Global Mosaic 1km](https://astrogeology.usgs.gov/search/map/io_galileo_ssi_voyager_color_merged_global_mosaic_1km) | 1000 m/px, 11445x5723 | USGS Astrogeology Science Center |
| `europa.jpg` | [Europa Voyager - Galileo SSI Global Mosaic 500m](https://astrogeology.usgs.gov/search/map/europa_voyager_galileo_ssi_global_mosaic_500m) | 500 m/px, 19631x9816 | Tammy Becker |
| `ganymede.jpg` | [Ganymede Voyager - Galileo SSI Color Global Mosaic 1.4km](https://astrogeology.usgs.gov/search/map/ganymede_voyager_galileo_ssi_color_global_mosaic_1_4km) | 1435.7 m/px, 11520x5760 | USGS Astrogeology Science Center |
| `callisto.jpg` | [Callisto Galileo/Voyager Global Mosaic 1km](https://astrogeology.usgs.gov/search/map/callisto_galileo_voyager_global_mosaic_1km) | 1000.0 m/px, 15138x7569 | see product page |
| `enceladus.jpg` | [Enceladus Cassini Global Mosaic 110m](https://astrogeology.usgs.gov/search/map/enceladus_cassini_global_mosaic_110m) | 109.95 m/px, 14401x7201 | see product page |
| `tethys.jpg` | [Tethys Cassini Global Mosaic 293m](https://astrogeology.usgs.gov/search/map/tethys_cassini_global_mosaic_293m) | 292.50 m/px, 11520x5760 | Roatsch |
| `dione.jpg` | [Dione Cassini - Voyager Global Mosaic 154m](https://astrogeology.usgs.gov/search/map/dione_cassini_voyager_global_mosaic_154m) | 153.53 m/px, 23040x11520 | see product page |
| `rhea.jpg` | [Rhea Cassini - Voyager Global Mosaic 417m](https://astrogeology.usgs.gov/search/map/rhea_cassini_voyager_global_mosaic_417m) | 416.75 m/px, 11520x5760 | T. Roatsch |
| `titan.jpg` | [Titan Cassini ISS Global Mosaic 4005m](https://astrogeology.usgs.gov/search/map/titan_cassini_iss_global_mosaic_4005m) | 4004.7 m/px, 4040x2020 | Cassini ISS Team |
| `iapetus.jpg` | [Iapetus Cassini - Voyager Global Mosaic 803m](https://astrogeology.usgs.gov/search/map/iapetus_cassini_voyager_global_mosaic_803m) | 802.85 m/px, 5760x2880 | see product page |
| `triton.jpg` | [Triton Voyager 2 Global Color Mosaic 600m](https://astrogeology.usgs.gov/search/map/triton_voyager_2_global_color_mosaic_600m) | 600 m/px, 14138x7069 | Lunar and Planetary Institute |
| `pluto.jpg` | [Pluto New Horizons LORRI - MVIC Global Mosaic 300m](https://astrogeology.usgs.gov/search/map/pluto_new_horizons_lorri_mvic_global_mosaic_300m) | 300 m/px, 24888x12444 | New Horizons Team |
| `charon.jpg` | [Charon New Horizons LORRI MVIC Global Mosaic 300m](https://astrogeology.usgs.gov/search/map/charon_new_horizons_lorri_mvic_global_mosaic_300m) | 300 m/px, 12693x6347 | New Horizons Team |

Orientation was checked by overlaying known surface features (east longitude,
planetocentric latitude) on each converted image: Caloris and Hun Kal
(Mercury), Maxwell Montes (Venus), Syrtis Major and Hellas (Mars), Occator,
Ahuna Mons and Kerwan (Ceres), Pele and Loki (Io), Pwyll (Europa), Valhalla
(Callisto), Odysseus (Tethys), Iapetus's dark leading hemisphere, Xanadu
(Titan) and Sputnik Planitia (Pluto) all land where expected. Ganymede,
Enceladus, Dione, Rhea, Triton and Charon were not checked against specific
features; they rely on their GeoTIFF georeferencing, as do the rest.

Not included: Vesta (the Dawn map uses the post-2012 prime meridian, which does
not match `pck00011.tpc`'s older IAU Vesta orientation), and Mimas, Eros,
Bennu and Ryugu (no suitable georeferenced global map in Astropedia).
