---
title: "1.35 Point-Charge Electric Field at the Origin and General Locations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 42", "Equations (8), (9), and (10)", "Section: 2.2.2 Fields Associated with Charges at General Locations", "Page 43", "Figure 2.2"]
related: ["vector-form-of-coulombs-law", "electric-field-intensity-as-force-per-unit-charge", "electric-field-superposition-from-multiple-point-charges"]
---

# 1.35 Point-Charge Electric Field at the Origin and General Locations

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 42, Equations (8), (9), and (10), Section: 2.2.2 Fields Associated with Charges at General Locations, Page 43, Figure 2.2

Dividing the Coulomb force on a test charge by that test charge gives the electric field of a point source charge. At a displacement $\mathbf{R}$ from a charge $Q$,
$$
\mathbf{E}=\frac{Q}{4\pi\epsilon_0R^2}\mathbf{a}_R
$$
 If the charge is placed at the origin of a spherical coordinate system, then $R=r$ and $\mathbf{a}_R=\mathbf{a}_r$, so the field becomes
$$
\mathbf{E}=\frac{Q}{4\pi\epsilon_0r^2}\mathbf{a}_r
$$
 For a charge at a general source point $\mathbf{r}'$ and an observation point $\mathbf{r}$, use $\mathbf{R}=\mathbf{r}-\mathbf{r}'$. Combining the inverse-square magnitude with the normalized displacement produces
$$
\mathbf{E}(\mathbf{r})=\frac{Q(\mathbf{r}-\mathbf{r}')}{4\pi\epsilon_0|\mathbf{r}-\mathbf{r}'|^3}
$$
 This form clearly distinguishes source location from observation location.

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

- A point charge produces an inverse-square electric field.
- The field direction is along the source-to-observation displacement.
- At the origin, the field has only a spherical radial component.
- For a general source location, define $\mathbf{R}=\mathbf{r}-\mathbf{r}'$.
- The vector numerator contributes one power of distance, producing a cubic distance norm in the denominator.
- Positive charges produce outward fields and negative charges produce inward fields.
- The notation $\mathbf{E}(\mathbf{r})$ emphasizes that the field is a function of observation position.

## Source Anchors

- Equation (8) gives $\mathbf{E}=Q\mathbf{a}_R/(4\pi\epsilon_0R^2)$.
- Equation (9) gives the origin-centered spherical form $\mathbf{E}=Q\mathbf{a}_r/(4\pi\epsilon_0r^2)$.
- Section 2.2.2 defines the source point $\mathbf{r}'$ and observation point $\mathbf{r}$.
- Equation (10) gives $\mathbf{E}(\mathbf{r})=Q(\mathbf{r}-\mathbf{r}')/[4\pi\epsilon_0|\mathbf{r}-\mathbf{r}'|^3]$.
- Equation (10) expands the displacement and distance explicitly in rectangular coordinates.
- Figure 2.2 depicts $\mathbf{r}'$, $\mathbf{r}$, and $\mathbf{R}=\mathbf{r}-\mathbf{r}'$.

## Related Pages

- [[vector-form-of-coulombs-law|Vector Form of Coulomb's Law]]
- [[electric-field-intensity-as-force-per-unit-charge|Electric Field Intensity as Force per Unit Charge]]
- [[electric-field-superposition-from-multiple-point-charges|Electric Field Superposition from Multiple Point Charges]]

## Concept Dependencies

- depends-on: [[electric-field-intensity-as-force-per-unit-charge|Electric Field Intensity as Force per Unit Charge]]
- depends-on: [[vector-form-of-coulombs-law|Vector Form of Coulomb's Law]]
