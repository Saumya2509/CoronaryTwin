# 3D assets: sources and licenses

CoronaryTwin ships **no third-party 3D models**. All geometry is generated in code at runtime, so there are
no asset licenses to track, the repository has no large binary files, and the download is 0 MB of meshes.

| Structure | Source | Notes |
|---|---|---|
| Heart surface | Procedural: `web/src/scene/heartShape.ts` | One analytic radial function: ventricles with an apex angled forward and left, left/right atria and both atrial appendages, a flattened base, and the coronary sulcus plus anterior/posterior interventricular grooves fitted to the artery paths. Schematic, not patient-specific. About 55k triangles. |
| Tissue look | Procedural: `web/src/scene/tissue.ts` | Per-vertex myocardium colors (fractal noise mottling, darker atria) with epicardial fat collecting in the grooves and at the base; a seamless 640×320 bump texture (muscle-fiber streaks, lobulated fat) generated from noise at load; wet clearcoat sheen with reflections from three's procedural `RoomEnvironment` (no HDR download). |
| LAD, LCX, RCA | Procedural: `web/src/anatomy.json` + `Vessel.tsx` | Direction paths projected exactly onto the heart surface, split into proximal, mid and distal segments with a tapered radius, and a thin dark rim so pale low-risk colors stay visible against fat. |
| Left main | Procedural (decoration) | Drawn in neutral grey and not modeled: the dataset has no left-main label. |
| Great vessels | Procedural (decoration): `Heart.tsx` | Aorta with arch and its three branches, pulmonary trunk and both pulmonary arteries, superior and inferior vena cava, four pulmonary veins. Cut ends show the lumen. For orientation only. |

In Lite mode the clearcoat, sheen and environment reflections are switched off; colors, shape and bump detail stay.

## Measured frame rate (integrated graphics)

Measured with `?fps=1` (renders every frame and shows the rate) on a laptop with **Intel HD Graphics 620** (integrated,
no dedicated GPU), Chrome, 1440×1000 window, a patient loaded, pulse and overlays on:

| Mode | Frames per second |
|---|---|
| Full effects (clearcoat, sheen, reflections, heartbeat, idle drift) | 36–44 |
| Lite mode | 60 (display limit) |

In normal use the scene renders on demand (about 30 fps while something animates, 0 when still), so both are
comfortable. Lite mode also switches on automatically if the frame rate stays below 14 fps.

## Why procedural

- **Arteries never float.** Free heart meshes rarely have separable coronary arteries, and hand-placed curves drift
  off the surface from some angles (a pitfall in the brief). Here, the same function that defines the surface
  places the arteries, and `scene.test.ts` checks that every artery sample lies just above the surface.
- **Licenses.** There are no attributions to manage and no risk of a non-commercial or no-derivatives license.
- **Performance.** About 110k triangles in total (heart ≈ 55k, great vessels ≈ 40k, arteries and rims ≈ 15k), one generated
  bump texture and no image files. It renders on demand, Lite mode drops the costly material effects, and there is a
  2D SVG fallback without WebGL.

## Swapping in a mesh later

`Heart.tsx` is a single component. To use a licensed `.glb` (for example from the NIH 3D Print Exchange or
BodyParts3D), replace its body with `useGLTF`. Keep `heartShape.ts` as the projection surface, or re-tune
`anatomy.json` against the new mesh, and record the source, license and edits in this file.

## Screenshots

Captured with headless Chrome against the trained models (sample patient `csv/04_typical_angina_smoker.csv`):

- `figures/3d_high_anterior.png`: anterior view with artery callouts, overlays and the drivers card.
- `figures/3d_mixed_lcx_uncertain.png`: LCX selected (*Uncertain*): camera flown in, detail panel open.
- `figures/3d_discordant_posterior_ghost.png`: posterior view in ghost mode; the arteries' full course is visible.
- `figures/present_mode.png`, `figures/cohort_heart.png`, `figures/dashboard_*.png`, `figures/landing.png`: the other views.
