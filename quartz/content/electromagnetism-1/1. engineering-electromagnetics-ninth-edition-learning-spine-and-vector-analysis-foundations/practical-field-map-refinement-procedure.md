---
title: "1.88 Practical Field-Map Refinement Procedure"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 172", "Page 173"]
related: ["curvilinear-square-field-map-construction", "capacitance-estimation-from-a-flux-plot", "electrostatic-field-mapping-problem-family"]
---

# 1.88 Practical Field-Map Refinement Procedure

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 172, Page 173

The source gives a six-stage procedure for improving a hand-drawn field map. Several rough sketches should be made before preparing a careful plot, and the known voltage difference should initially be divided into four or eight equal increments. Equipotentials are first guessed in a region where the field is best understood, such as an approximately uniform-field region, and then extended across the geometry. Near conductor boundaries, equipotentials tend to crowd around acute angles and spread near obtuse angles. The orthogonal field-line family is then added. Although curvilinear squares are desired, orthogonality takes priority when the conditions conflict. Poor side ratios indicate that the original equipotential guesses need correction. Low-field regions can contain large cells with five or six sides, so these cells should be subdivided to test the plot. Subdivision must begin away from the questionable region, and halving a flux tube requires the local potential intervals to be divided by the same factor.

## Page-Grounded Details

#### Page 172

Figure 6.8 An example of a curvilinear-square field map. The side of the square is two-thirds the radius of the circle. $N_{V}=4$ and $N_{Q}=8\times3.25=26$, and therefore $C=\varepsilon_{0}\,N_{Q}/N_{V}=57.6$ pF/m.

since $\Delta L_{t}/\Delta L_{N}=1$. The determination of the capacitance from a flux plot merely consists of counting squares in two directions, between conductors and around either conductor. From Figure 6.8 we obtain
$$
C=\epsilon_{0}\frac{8\times3.25}{4}=57.6\mathrm{pF/m}
$$
Ramo, Whinnery, and Van Duzer have an excellent discussion with examples of the construction of field maps by curvilinear squares. They offer the following suggestions:^1

1. Plan on making a number of rough sketches, taking only a minute or so apiece, before starting any plot to be made with care. The use of transparent paper over the basic boundary will speed up this preliminary sketching.

2. Divide the known potential difference between electrodes into an equal number of divisions, say four or eight to begin with.

3. Begin the sketch of equipotentials in the region where the field is known best, for example, in some region where it approaches a uniform field. Extend the equipoten

[Truncated for analysis]

#### Page 173

4. Draw in the orthogonal set of field lines. As these are started, they should form curvilinear squares, but as they are extended the condition of orthogonality should be kept paramount, even though this will result in some rectangles with ratios other than unity.

5. Look at the regions with poor side ratios and try to see what was wrong with the first guess of equipotentials. Correct them and repeat the procedure until reasonable curvilinear squares exist throughout the plot.

6. In regions of low field intensity, there will be large figures, often of five or six sides. To judge the correctness of the plot in this region, these large units should be subdivided. The subdivisions should be started back away from the region needing subdivision, and each time a flux tube is divided in half, the potential divisions in this region must be divided by the same factor.

D6.4. Figure 6.9 shows the cross section of two circular cylinders at potentials of 0 and 60 V. The axes are parallel and the region between the cylinders is air-filled. Equipotentials at 20 V and 40 V are also shown. Prepare a curvilinear-square map on the figure and use it to establish suitable values for: $(a)$ the cap

[Truncated for analysis]

## Core Ideas

- Prepare several fast preliminary sketches before the final plot.
- Divide the electrode voltage difference into equal increments.
- Begin where the field behavior is best known.
- Equipotentials crowd near acute conductor angles.
- Equipotentials spread near obtuse conductor angles.
- Preserve orthogonality even if some cells become rectangular.
- Correct poor side ratios by revising the equipotential guesses.
- When a flux tube is halved, halve the associated potential intervals.

## Source Anchors

- The source recommends four or eight initial potential divisions.
- Transparent paper over the boundary geometry is suggested for rapid preliminary sketches.
- Orthogonality is described as paramount during field-line extension.
- Large low-field cells may have five or six sides.
- Subdivisions should begin back from the region that needs checking.
- S1.P173.F1, Figure 6.9 supplies equipotentials at 0, 20, 40, and 60 V for a mapping exercise.

## Related Pages

- [[curvilinear-square-field-map-construction|Curvilinear-Square Field Map Construction]]
- [[capacitance-estimation-from-a-flux-plot|Capacitance Estimation from a Flux Plot]]
- [[electrostatic-field-mapping-problem-family|Electrostatic Field-Mapping Problem Family]]

## Concept Dependencies

- applies-to: [[curvilinear-square-field-map-construction|Curvilinear-Square Field Map Construction]]
