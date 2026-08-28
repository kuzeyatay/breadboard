---
title: "1.85 Field-Sketching Rules for Two-Dimensional Capacitance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 168", "Page 169", "Page 170", "Section 6.5: Using Field Sketches to Estimate Capacitance in Two-Dimensional Problems", "Figure 6.6"]
related: ["two-wire-line-field-and-surface-charge", "capacitance-as-a-charge-to-potential-ratio", "parallel-plate-capacitance"]
---

# 1.85 Field-Sketching Rules for Two-Dimensional Capacitance

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 168, Page 169, Page 170, Section 6.5: Using Field Sketches to Estimate Capacitance in Two-Dimensional Problems, Figure 6.6

For two-dimensional conductor geometries that do not fit a convenient coordinate system, capacitance can be estimated by sketching equipotential surfaces and electric-flux streamlines. The method assumes no field variation normal to the sketch plane and a homogeneous dielectric. Conductors are equipotential boundaries, electric field and flux density are perpendicular to equipotentials, and both fields meet conductor surfaces normally. Flux lines begin and terminate on charge, so in a charge-free dielectric they connect conductor boundaries. Adjacent flux lines form a flux tube through which no flux crosses the sides. The sketch is organized so adjacent equipotentials differ by a constant $\Delta V$ and adjacent streamlines carry a constant flux $\Delta\Psi$. Local field estimates from voltage spacing and flux-tube width are equated:
$$
\frac{1}{\epsilon}\frac{\Delta\Psi}{\Delta L_t}=\frac{\Delta V}{\Delta L_N}
$$
 Therefore,
$$
\frac{\Delta L_t}{\Delta L_N}=\frac{1}{\epsilon}\frac{\Delta\Psi}{\Delta V}=\text{constant}
$$
 The individual spacings shrink in stronger-field regions, but their ratio remains constant. Figures 6.6a and 6.6b illustrate the equipotentials and orthogonal streamlines.

## Page-Grounded Details

#### Page 168

If we evaluate $D_{x}$ at $x=h-b,y=0$, we may obtain $\rho_{S,\max}$
$$
\rho_{S,\max}=-D_{x,x=h-b,y=0}=\frac{\rho_{L}}{2\pi}\left[\frac{h-b+a}{(h-b+a)^{2}}-\frac{h-b-a}{(h-b-a)^{2}}\right]
$$
For our example,
$$
\rho_{S,\max}=\frac{3.46\times 10^{-9}}{2\pi}\left[\frac{13-5+12}{(13-5+12)^{2}}-\frac{13-5-12}{(13-5-12)^{2}}\right]=0.165\,nC/m^{2}
$$
Similarly, $\rho_{S,\min}=D_{x,x=h+b,y=0}$, and
$$
\rho_{S,\min}=\frac{3.46\times 10^{-9}}{2\pi}\left[\frac{13+5+12}{30^{2}}-\frac{13+5-12}{6^{2}}\right]=0.073\,nC/m^{2}
$$
Thus,
$$
\rho_{S,\max}=2.25\rho_{S,\min}
$$
If we apply Eq. (16) to the case of a conductor for which $b\ll h$, then
$$
\ln\left[(h+\sqrt{h^{2}-b^{2}})/b\right]\doteq\ln\left[(h+h)/b\right]\doteq\ln(2h/b)
$$
and
$$
C=\frac{2\pi\epsilon L}{\ln(2h/b)}\qquad(b\ll h)\qquad(17)
$$
The capacitance between two circular conductors separated by a distance 2h is one-half the capacitance given by Eqs. (16) or (17). This last answer is of interest because it gives us an expression for the capacitance of a section of two-wire transmission line, one of the types of transmission lines studied later in Chapter 13.

D6.3. A conducting cylinder with a radius of 1 cm

[Truncated for analysis]

#### Page 169

of more elegant methods, allows fairly quick estimates of capacitance while providing a useful visualization of the field configuration.

The method, requiring only pencil and paper, is capable of yielding good accuracy if used skillfully and patiently. Fair accuracy (5 to 10 percent on a capacitance determination) may be obtained by a beginner who does no more than follow the few rules and hints of the art. The method to be described is applicable only to fields in which no variation exists in the direction normal to the plane of the sketch. The procedure is based on several facts that we have already demonstrated:

1. A conductor boundary is an equipotential surface.

2. The electric field intensity and electric flux density are both perpendicular to the equipotential surfaces.

3. E and D are therefore perpendicular to the conductor boundaries and possess zero tangential values.

4. The lines of electric flux, or streamlines, begin and terminate on charge and hence, in a charge-free, homogeneous dielectric, begin and terminate only on the conductor boundaries.

We consider the implications of these statements by drawing the streamlines on a sketch that already shows the equipote

[Truncated for analysis]

#### Page 170

definition, is everywhere tangent to the electric field intensity or to the electric flux density. Because the streamline is tangent to the electric flux density, the flux density is tangent to the streamline, and no electric flux may cross any streamline. In other words, if there is a charge of $5 \mu C$ on the surface between $A$ and $B$ (and extending 1 m into the paper), then $5 \mu C$ of flux begins in this region, and all must terminate between $A^{\prime}$ and $B^{\prime}$. Such a pair of lines is sometimes called a flux tube because it physically seems to carry flux from one conductor to another without losing any.

We next construct a third streamline, and both the mathematical and visual interpretations we may make from the sketch will be greatly simplified if we draw this line starting from some point $C$ chosen so that the same amount of flux is carried in the tube $BC$ as is contained in $AB$. How do we choose the position of $C$?

The electric field intensity at the midpoint of the line joining $A$ to $B$ may be found approximately by assuming a value for the flux in the tube $AB$, say $\Delta\Psi$, which allows us to express the electric f

[Truncated for analysis]

## Core Ideas

- The method applies to fields with no variation normal to the sketch plane.
- Conductor boundaries are equipotentials.
- Flux lines and electric field lines cross equipotentials at right angles.
- No electric flux crosses the sides of a flux tube.
- Equipotential increments and flux per tube are held constant.
- The ratio $\Delta L_t/\Delta L_N$ must remain constant throughout the net.

## Source Anchors

- The source states that a beginner may obtain about 5 to 10 percent capacitance accuracy.
- Four initial rules identify conductor equipotentials, orthogonal fields, zero tangential conductor fields, and flux-line termination.
- Figure 6.6a shows equal-increment equipotential surfaces between two conductors.
- Figure 6.6b adds streamlines from $A$ to $A'$ and $B$ to $B'$.
- Equation (18) equates the flux-based and voltage-based field estimates.
- Equation (19) requires a constant ratio $\Delta L_t/\Delta L_N$.
- Visual opportunity S1.P169.F1: recreate Figure 6.6 as an editable orthogonal flux net with cell-ratio feedback.

## Related Pages

- [[two-wire-line-field-and-surface-charge|Two-Wire Line Field and Surface Charge]]
- [[capacitance-as-a-charge-to-potential-ratio|Capacitance as a Charge-to-Potential Ratio]]
- [[parallel-plate-capacitance|Parallel-Plate Capacitance]]

## Concept Dependencies

- applies-to: [[capacitance-as-a-charge-to-potential-ratio|Capacitance as a Charge-to-Potential Ratio]]
- related: [[two-wire-line-field-and-surface-charge|Two-Wire Line Field and Surface Charge]]
- related: [[parallel-plate-capacitance|Parallel-Plate Capacitance]]
