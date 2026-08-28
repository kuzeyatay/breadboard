---
title: "1.110 Magnetic Field of an Infinite Current Sheet"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 206", "Page 207", "Section 7.2.4: Magnetic Field of a Surface Current", "Figure S1.P206.F2"]
related: ["current-source-representations", "ampere-circuital-law-enclosed-current", "magnetic-fields-solenoids-toroids"]
---

# 1.110 Magnetic Field of an Infinite Current Sheet

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 206, Page 207, Section 7.2.4: Magnetic Field of a Surface Current, Figure S1.P206.F2

For a uniform current sheet in the $z=0$ plane with $\mathbf{K}=K_y\mathbf{a}_y$, translational symmetry prevents variation with $x$ or $y$. A filament decomposition shows that no $H_y$ component is produced, while the $H_z$ contributions from symmetrically placed filaments cancel. Only $H_x$ remains. A rectangular Amperian loop crossing the sheet gives $H_{x1}-H_{x2}=K_y$. Additional loops show that the field is uniform throughout each half-space, and reflection symmetry makes the fields on opposite sides equal in magnitude and opposite in direction. Thus
$$
H_x=\frac{K_y}{2}\quad(z>0),\qquad H_x=-\frac{K_y}{2}\quad(z<0)
$$
Using an outward normal $\mathbf{a}_N$, the result is
$$
\mathbf{H}=\frac{1}{2}\mathbf{K}\times\mathbf{a}_N
$$
For two parallel sheets carrying opposite currents, the fields add between the sheets and cancel outside, producing $\mathbf{H}=\mathbf{K}\times\mathbf{a}_N$ internally and zero externally.

## Page-Grounded Details

#### Page 206

Figure 7.9 The magnetic field intensity as a function of radius in an infinitely long coaxial transmission line with the dimensions shown.

The external field is zero. This, we see, results from equal positive and negative currents enclosed by the path. Each produces an external field of magnitude $I/2\pi\rho$, but complete cancellation occurs. This is another example of "shielding"; such a coaxial cable carrying large currents would, in principle, not produce any noticeable effect in an adjacent circuit.

#### 7.2.4 Magnetic Field of a Surface Current

As a final example, consider a sheet of current flowing in the positive $y$ direction and located in the $z=0$ plane. We may think of the return current as equally divided between two distant sheets on either side of the sheet we are considering. A sheet of uniform surface current density $\mathbf{K}=K_{y}\mathbf{a}_{y}$ is shown in Figure 7.10. $\mathbf{H}$ cannot vary with $x$ or $y$. If the sheet is subdivided into a number of filaments, it is evident that no filament can produce an $H_{y}$ component. Moreover, the Biot-Savart law shows that the contributions to $H_{z}$ produced by a symmetrically located pair o

[Truncated for analysis]

#### Page 207

or
$$
H_{x1}-H_{x2}=K_{y}
$$
If the path 3-3'-2'-2-3 is now chosen, the same current is enclosed, and
$$
H_{x3}-H_{x2}=K_{y}
$$
and therefore
$$
H_{x3}=H_{x1}
$$
It follows that $H_{x}$ is the same for all positive $z$. Similarly, $H_{x}$ is the same for all nega-tive $z$. Because of the symmetry, then, the magnetic field intensity on one side of the current sheet is the negative of that on the other. Above the sheet,
$$
H_{x}=\frac{1}{2}K_{y}\quad(z>0)
$$
while below it
$$
H_{x}=-\frac{1}{2}K_{y}\quad(z<0)
$$
Letting $\mathbf{a}_{N}$ be a unit vector normal (outward) to the current sheet, the result may be written in a form correct for all $z$ as
$$
\mathbf{H}=\frac{1}{2}\mathbf{K}\times\mathbf{a}_{N}\quad{(11)}
$$
If a second sheet of current flowing in the opposite direction, $\mathbf{K}=-K_{y}\mathbf{a}_{y}$, is placed at $z=h$, (11) shows that the field in the region between the current sheets is
$$
\mathbf{H}=\mathbf{K}\times\mathbf{a}_{N}\quad(0<z<h)\quad{(12)}
$$
and is zero elsewhere,
$$
\mathbf{H}=0\quad(z<0,z>h)\quad{(13)}
$$
The most difficult part of the application of Ampère's circuital law is the deter-mination of the components of the

[Truncated for analysis]

## Core Ideas

- A uniform infinite current sheet produces a spatially uniform field on each side.
- Symmetric filament pairs cancel the normal field component.
- The field is perpendicular to both the sheet current and the sheet normal.
- Each side has field magnitude $K/2$.
- The compact direction formula is $\mathbf{H}=\tfrac{1}{2}\mathbf{K}\times\mathbf{a}_N$.
- Oppositely directed parallel sheets double the field between them.
- The same two sheets cancel the field outside.

## Source Anchors

- Figure S1.P206.F2 shows the current sheet and rectangular Amperian paths.
- Page 206 states that symmetric filament contributions cancel $H_z$ and leave only $H_x$.
- Pages 206-207 derive $H_{x1}-H_{x2}=K_y$.
- Page 207 gives $H_x=K_y/2$ above and $H_x=-K_y/2$ below the sheet.
- Page 207 gives $\mathbf{H}=\mathbf{K}\times\mathbf{a}_N/2$.
- Page 207 gives $\mathbf{H}=\mathbf{K}\times\mathbf{a}_N$ between two opposite-current sheets and zero outside.
- Page 207 emphasizes that identifying the field components is the hardest part of applying Ampere's law.

## Related Pages

- [[current-source-representations|Current Source Representations]]
- [[ampere-circuital-law-enclosed-current|Ampere's Circuital Law and Enclosed Current]]
- [[magnetic-fields-solenoids-toroids|Magnetic Fields of Solenoids and Toroids]]

## Concept Dependencies

- applies-to: [[ampere-circuital-law-enclosed-current|Ampere's Circuital Law and Enclosed Current]]
- depends-on: [[current-source-representations|Current Source Representations]]
