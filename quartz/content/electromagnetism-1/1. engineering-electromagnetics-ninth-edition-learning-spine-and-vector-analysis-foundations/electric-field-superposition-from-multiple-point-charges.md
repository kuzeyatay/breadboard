---
title: "1.36 Electric Field Superposition from Multiple Point Charges"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 42", "Section: 2.2.2 Fields Associated with Charges at General Locations", "Page 43", "Figure 2.3"]
related: ["mutual-force-linearity-and-superposition", "electric-field-intensity-as-force-per-unit-charge", "point-charge-electric-field-at-the-origin-and-general-locations"]
---

# 1.36 Electric Field Superposition from Multiple Point Charges

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 42, Section: 2.2.2 Fields Associated with Charges at General Locations, Page 43, Figure 2.3

Because Coulomb's law is linear, the total electric field at an observation point is the vector sum of the fields produced by individual source charges. For charges $Q_1$ at $\mathbf{r}_1$ and $Q_2$ at $\mathbf{r}_2$, the source gives
$$
\mathbf{E}(\mathbf{r})=\frac{Q_1}{4\pi\epsilon_0|\mathbf{r}-\mathbf{r}_1|^2}\mathbf{a}_1+\frac{Q_2}{4\pi\epsilon_0|\mathbf{r}-\mathbf{r}_2|^2}\mathbf{a}_2
$$
 where $\mathbf{a}_1$ and $\mathbf{a}_2$ point from their respective source charges toward the common observation point. Each contribution must use its own displacement, distance, and unit direction before the vectors are added. Figure 2.3 is source-central because it shows the two source positions, the observation point, the two directed displacements, and the geometric vector addition that produces the total field.

## Page-Grounded Details

#### Page 42

The units of E would be in force per unit charge (newtons per coulomb). Again anticipating a new dimensional quantity, the volt (V), having the label of joules per coulomb (J/C), or newton-meters per coulomb (N*m/C), we measure electric field intensity in the practical units of volts per meter (V/m).

Most of the subscripts in (6) are now removed, reserving the right to use them again any time there is a possibility of misunderstanding. The electric field of a single point charge becomes:
$$
E = \frac{Q}{4\pi \epsilon_{0} R^{2}} a_{R} \quad{(8)}
$$
We remember that R is the magnitude of the vector R, the directed line segment from the point at which the point charge Q is located to the point at which E is desired, and $a_{R}$ is a unit vector in the R direction.^3

We arbitrarily locate $Q_{1}$ at the center of a spherical coordinate system. The unit vector $a_{R}$ then becomes the radial unit vector $a_{r}$, and R is r. Hence
$$
E = \frac{Q_{1}}{4\pi \epsilon_{0} r^{2}} a_{r} \quad{(9)}
$$
The field has a single radial component, and its inverse-square-law relationship is quite obvious.

#### 2.2.2 Fields Associated with Charges at General Locations

For a charge that

[Truncated for analysis]

#### Page 43

Figure 2.2 The vector $\mathbf{r}^\prime$ locates the point charge $Q$, the vector $\mathbf{r}$ identifies the general point in space $P(x, y, z)$, and the vector $\mathbf{R}$ from $Q$ to $P(x, y, z)$ is then $\mathbf{R} = \mathbf{r} - \mathbf{r}^\prime$.

Figure 2.3 The vector addition of the total electric field intensity at $P$ due to $Q_1$ and $Q_2$ is made possible by the linearity of Coulomb's law.

## Core Ideas

- Compute one electric-field vector for each source charge.
- Use the same observation point for all contributions.
- Each source has its own displacement $\mathbf{r}-\mathbf{r}_i$.
- Each field direction points from its source location toward the observation point before the charge sign is applied.
- Add electric-field contributions component by component.
- Superposition follows from the linearity of Coulomb's law.
- The construction generalizes from two charges to any finite collection and later to continuous distributions.

## Source Anchors

- Page 42 states that the field from two point charges is the sum of the fields caused by the charges acting alone.
- The two-charge expression contains separate distances $|\mathbf{r}-\mathbf{r}_1|$ and $|\mathbf{r}-\mathbf{r}_2|$.
- The unit vectors $\mathbf{a}_1$ and $\mathbf{a}_2$ are defined along $\mathbf{r}-\mathbf{r}_1$ and $\mathbf{r}-\mathbf{r}_2$.
- Figure 2.3 depicts the relevant position vectors, displacement vectors, and unit vectors.
- Figure 2.3 explicitly describes vector addition of the total field at P as a consequence of linearity.

## Related Pages

- [[mutual-force-linearity-and-superposition|Mutual Force, Linearity, and Superposition]]
- [[electric-field-intensity-as-force-per-unit-charge|Electric Field Intensity as Force per Unit Charge]]
- [[point-charge-electric-field-at-the-origin-and-general-locations|Point-Charge Electric Field at the Origin and General Locations]]

## Concept Dependencies

- depends-on: [[mutual-force-linearity-and-superposition|Mutual Force, Linearity, and Superposition]]
- depends-on: [[point-charge-electric-field-at-the-origin-and-general-locations|Point-Charge Electric Field at the Origin and General Locations]]
- part-of: [[electric-field-intensity-as-force-per-unit-charge|Electric Field Intensity as Force per Unit Charge]]
