---
title: "1.47 Streamline Representation of Electric Fields"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 53", "Page 54", "Page 55", "Section: 2.6 Streamlines and Sketches of Fields"]
related: ["streamline-differential-equations", "derivation-and-distance-scaling-of-the-infinite-line-field", "faraday-displacement-flux"]
---

# 1.47 Streamline Representation of Electric Fields

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 53, Page 54, Page 55, Section: 2.6 Streamlines and Sketches of Fields

Vector equations can become difficult to visualize as charge configurations grow more complicated. The source compares several field-sketching conventions for an infinite line charge. Scattered arrows with lengths proportional to field magnitude fail to display symmetry clearly and overcrowd the strongest region. Varying arrow thickness or reversing the length convention also creates practical or interpretive problems. The preferred representation uses continuous streamlines that are tangent to the electric field at every point, with arrowheads indicating direction. A positive test charge released at a point initially accelerates in the streamline direction. In important special cases, closer streamline spacing represents greater field magnitude, although this interpretation requires care. Because fully three-dimensional fields are difficult to draw on a page, streamline sketches are commonly restricted to two-dimensional fields or cross sections.

## Page-Grounded Details

#### Page 53

on a square foot a few inches below the ceiling. If you desire greater illumination on this subject, it will do you no good to hold the book closer to such a light source.

#### 2.5.3 Capacitor Model

If a second infinite sheet of charge, having a negative charge density $-\rho_{S}$, is located in the plane $x = a$, the total field may be found by adding the contribution of each sheet. In the region $x > a$,
$$
E_{+}=\frac{\rho_{S}}{2\,\epsilon_{0}}a_{x} \quad E_{-}=-\frac{\rho_{S}}{2\,\epsilon_{0}}a_{x} \quad E=E_{+}+E_{-}=0
$$
and for $x < 0$,
$$
E_{+}=-\frac{\rho_{S}}{2\,\epsilon_{0}}a_{x} \quad E_{-}=\frac{\rho_{S}}{2\,\epsilon_{0}}a_{x} \quad E=E_{+}+E_{-}=0
$$
and when $0 < x < a$,
$$
E_{+}=\frac{\rho_{S}}{2\,\epsilon_{0}}a_{x} \quad E_{-}=\frac{\rho_{S}}{2\,\epsilon_{0}}a_{x}
$$
and
$$
E=E_{+}+E_{-}=\frac{\rho_{S}}{\epsilon_{0}}a_{x}
$$
This is an important practical answer, for it is the field between the parallel plates of an air capacitor, provided the linear dimensions of the plates are very much greater than their separation and provided also that we are considering a point well removed from the edges. The field outside the capacitor, while not zero, a

[Truncated for analysis]

#### Page 54

Figure 2.9$a$ shows a cross-sectional view of the line charge and presents what might be our first effort at picturing the field-short line segments drawn here and there having lengths proportional to the magnitude of $\mathbf{E}$ and pointing in the direction of $\mathbf{E}$. The figure fails to show the symmetry with respect to $\phi$, so we try again in Figure 2.9$b$ with a symmetrical location of the line segments. The real trouble now appears-the longest lines must be drawn in the most crowded region, and this also plagues us if we use line segments of equal length but of a thickness that is proportional to $\mathbf{E}$ (Figure 2.9$c$). Other schemes include drawing shorter lines to represent stronger fields (inherently misleading) and using intensity of color or different colors to represent stronger fields.

For the present, we will show only the _direction_ of $\mathbf{E}$ by drawing continuous lines, which are everywhere tangent to $\mathbf{E}$, from the charge. Figure 2.9$d$ shows this compromise. A symmetrical distribution of lines (one every 45 deg) indicates azimuthal symmetry, and arrowheads are used to show direction.

These lines are usually call

[Truncated for analysis]

#### Page 55

We will find out later that a bonus accompanies this streamline sketch, for the magnitude of the field can be shown to be inversely proportional to the spacing of the streamlines for some important special cases. The closer they are together, the stronger is the field. At that time we will also find an easier, more accurate method of making that type of streamline sketch.

If we tried to sketch the field of the point charge, the variation of the field into and away from the page would cause essentially insurmountable difficulties; for this reason sketching is usually limited to two-dimensional fields.

In the case of the two-dimensional field, we may arbitrarily set $E_{z}=0$. The streamlines are thus confined to planes for which $z$ is constant, and the sketch is the same for any such plane. Several streamlines are shown in Figure 2.10, and the $E_{x}$ and $E_{y}$ components are indicated at a general point. It is apparent from the geometry that
$$
\frac{E_{y}}{E_{x}}=\frac{dy}{dx}\quad{(19)}
$$
A knowledge of the functional form of $E_{x}$ and $E_{y}$ (and the ability to solve the resultant differential equation) will enable us to obtain the equations of the streaml

[Truncated for analysis]

## Core Ideas

- A streamline is tangent to $\mathbf{E}$ at every point.
- Arrowheads show the direction of the field.
- Symmetric streamline placement can reveal source symmetry.
- Closer spacing can indicate a stronger field in important special cases.
- A positive test charge initially accelerates along the local streamline.
- Two-dimensional fields are substantially easier to sketch than three-dimensional fields.

## Source Anchors

- The line-charge field used for illustration is $\mathbf{E}=\rho_L\mathbf{a}_\rho/(2\pi\epsilon_0\rho)$.
- Source figure S1.P54.F1, Figure 2.9, compares scattered vectors, thickness-coded vectors, and the standard streamline sketch.
- Figure 2.9d places radial streamlines every $45^\circ$ to show azimuthal symmetry.
- The source also names streamlines as flux lines or direction lines.
- The spacing of lines is described as inversely proportional to field strength for important special cases.
- Point-charge fields are cited as difficult to sketch because they vary into and out of the page.

## Related Pages

- [[streamline-differential-equations|Streamline Differential Equations]]
- [[derivation-and-distance-scaling-of-the-infinite-line-field|Derivation and Distance Scaling of the Infinite-Line Field]]
- [[faraday-displacement-flux|Faraday Displacement Flux]]

## Concept Dependencies

- enables: [[streamline-differential-equations|Streamline Differential Equations]]
