---
title: "1.87 Capacitance Estimation from a Flux Plot"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 171", "Page 172", "Page 173"]
related: ["curvilinear-square-field-map-construction", "practical-field-map-refinement-procedure", "potential-to-charge-capacitance-workflow"]
---

# 1.87 Capacitance Estimation from a Flux Plot

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 171, Page 172, Page 173

A curvilinear-square field map converts capacitance estimation into counting flux tubes and potential increments. Starting from $C=Q/V_0$, the total charge is represented as $Q=N_Q\Delta Q=N_Q\Delta\Psi$, where $N_Q$ is the number of flux tubes joining the conductors. The total voltage is represented as $V_0=N_V\Delta V$, where $N_V$ is the number of equal potential increments between conductors. Combining these expressions with the local field-map relation gives
$$
C=\frac{N_Q}{N_V}\epsilon\frac{\Delta L_t}{\Delta L_N}
$$
 For a curvilinear-square map, $\Delta L_t/\Delta L_N=1$, so the result reduces to
$$
C=\epsilon\frac{N_Q}{N_V}
$$
 Thus, capacitance per unit length can be estimated by counting divisions around a conductor and between conductors. In the square-inner, circular-outer conductor example, the map has $N_V=4$ and $N_Q=8\times3.25=26$. With free-space permittivity, the estimate is $57.6\ \mathrm{pF/m}$.

## Page-Grounded Details

#### Page 171

Figure 6.7 The remaining streamlines have been added to Fig. 6.6$b$ by beginning each new line normally to the conductor and maintaining curvilinear squares throughout the sketch.

The simplest ratio we can use is unity, and the streamline from $B$ to $B^{\prime}$ shown in Figure 6.6$b$ was started at a point for which $\Delta L_{t}=\Delta L_{N}$. Because the ratio of these distances is kept at unity, the streamlines and equipotentials divide the field-containing region into curvilinear squares, a term implying a planar geometric figure that differs from a true square in having slightly curved and slightly unequal sides but which approaches a square as its dimensions decrease. Those incremental surface elements in our three coordinate systems which are planar may also be drawn as curvilinear squares.

We may now sketch in the remainder of the streamlines by keeping each small box as square as possible. One streamline is begun, an equipotential line is roughed in, another streamline is added, forming a curvilinear square, and the map is gradually extended throughout the desired region. The complete sketch is shown in Figure 6.7.

The construction of a useful field map is a

[Truncated for analysis]

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

- Total charge is represented by $Q=N_Q\Delta Q$.
- Total voltage is represented by $V_0=N_V\Delta V$.
- The general map relation is $C=(N_Q/N_V)\epsilon(\Delta L_t/\Delta L_N)$.
- Curvilinear squares reduce the relation to $C=\epsilon N_Q/N_V$.
- $N_Q$ counts flux tubes around a conductor.
- $N_V$ counts potential increments between conductors.
- The Figure 6.8 map gives $N_Q=26$, $N_V=4$, and $C=57.6\ \mathrm{pF/m}$.

## Source Anchors

- S1.P172.F1, Figure 6.8 maps a square inner conductor surrounded by a circular conductor.
- The square side is two-thirds the radius of the outer circle.
- The source states $N_V=4$ and $N_Q=8\times3.25=26$.
- Equation (20) gives $C=\epsilon N_Q/N_V$ when $\Delta L_t/\Delta L_N=1$.
- The numerical calculation is
$$
C=\epsilon_0\frac{8\times3.25}{4}=57.6\ \mathrm{pF/m}
$$
- Problem D6.4 reports a field-map estimate of $69\ \mathrm{pF/m}$ for two circular cylinders.

## Related Pages

- [[curvilinear-square-field-map-construction|Curvilinear-Square Field Map Construction]]
- [[practical-field-map-refinement-procedure|Practical Field-Map Refinement Procedure]]
- [[potential-to-charge-capacitance-workflow|Potential-to-Charge Capacitance Workflow]]

## Concept Dependencies

- contrasts-with: [[potential-to-charge-capacitance-workflow|Potential-to-Charge Capacitance Workflow]]
