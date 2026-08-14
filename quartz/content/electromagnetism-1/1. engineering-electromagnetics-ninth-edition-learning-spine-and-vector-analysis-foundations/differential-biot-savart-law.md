---
title: "1.102 Differential Biot-Savart Law"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 195", "Section 7.1.1: Differential Form of the Biot-Savart Law", "Figure S1.P195.F1"]
related: ["integral-biot-savart-law-closed-steady-currents", "comparison-of-biot-savart-and-coulomb-laws", "magnetic-field-infinite-straight-current-filament"]
---

# 1.102 Differential Biot-Savart Law

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 195, Section 7.1.1: Differential Form of the Biot-Savart Law, Figure S1.P195.F1

The differential Biot-Savart law gives the magnetic field intensity produced at a field point by an infinitesimal element of filamentary current. A filamentary conductor is the limiting case of a cylindrical conductor whose radius approaches zero. For current $I$ flowing through the directed differential length $d\mathbf{L}$, the field contribution is
$$
d\mathbf{H}=\frac{I\,d\mathbf{L}\times\mathbf{a}_R}{4\pi R^2}=\frac{I\,d\mathbf{L}\times\mathbf{R}}{4\pi R^3}
$$
Here, $\mathbf{R}$ points from the source element to the field point, $R=|\mathbf{R}|$, and $\mathbf{a}_R=\mathbf{R}/R$. The magnitude is proportional to $I$, $|d\mathbf{L}|$, and the sine of the angle between $d\mathbf{L}$ and $\mathbf{R}$, while varying as $1/R^2$. Its direction is normal to the plane containing the current element and displacement vector, as determined by the right-hand rule. In rationalized mks units, the proportionality factor is $1/(4\pi)$, and $\mathbf{H}$ has units of amperes per meter.

## Page-Grounded Details

#### Page 195

Figure 7.1 The law of Biot-Savart expresses the magnetic field intensity $d\mathbf{H}_{2}$ produced by a differential current element $I_{1}d\mathbf{L}_{1}$. The direction of $d\mathbf{H}_{2}$ is into the page.

case of a cylindrical conductor of circular cross section as the radius approaches zero. We assume a current $I$ flowing in a differential vector length of the filament $d\mathbf{L}$. The law of Biot-Savart^1 then states that at any point $P$ the magnitude of the magnetic field intensity produced by the differential element is proportional to the product of the current, the magnitude of the differential length, and the sine of the angle lying between the filament and a line connecting the filament to the point $P$ at which the field is desired; also, the magnitude of the magnetic field intensity is inversely proportional to the square of the distance from the differential element to the point $P$. The direction of the magnetic field intensity is normal to the plane containing the differential filament and the line drawn from the filament to the point $P$. Of the two possible normals, that one to be chosen is the one which is in the direction of progress of

[Truncated for analysis]

## Core Ideas

- A differential source is represented by the vector current element $I\,d\mathbf{L}$.
- The field magnitude is linear in current and differential length.
- The angular dependence is supplied by the cross product.
- The distance dependence is inverse-square when written with $\mathbf{a}_R$.
- The right-hand rule determines the field direction.
- Magnetic field intensity $\mathbf{H}$ is measured in A/m.
- With source point 1 and field point 2, $d\mathbf{H}_2=I_1d\mathbf{L}_1\times\mathbf{a}_{R12}/(4\pi R_{12}^2)$.

## Source Anchors

- Page 195 defines a filamentary conductor as the limiting case of a cylindrical conductor as its radius approaches zero.
- Page 195 gives $d\mathbf{H}=I\,d\mathbf{L}\times\mathbf{a}_R/(4\pi R^2)$.
- Page 195 gives the equivalent form $d\mathbf{H}=I\,d\mathbf{L}\times\mathbf{R}/(4\pi R^3)$.
- Page 195 states that the selected normal follows the right-handed-screw direction from $d\mathbf{L}$ toward the source-to-field line.
- Figure S1.P195.F1 shows $d\mathbf{H}_2$ produced by $I_1d\mathbf{L}_1$, with the field directed into the page.
- Page 195 identifies the units of $\mathbf{H}$ as A/m.

## Related Pages

- [[integral-biot-savart-law-closed-steady-currents|Integral Biot-Savart Law and Closed Steady Currents]]
- [[magnetic-field-infinite-straight-current-filament|Magnetic Field of an Infinite Straight Current Filament]]

## Concept Dependencies

- part-of: [[integral-biot-savart-law-closed-steady-currents|Integral Biot-Savart Law and Closed Steady Currents]]
