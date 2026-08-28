---
title: "1.43 Derivation and Distance Scaling of the Infinite-Line Field"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 49", "Page 50", "Section: 2.4.1 Setting Up the Problem: The Importance of Symmetry"]
related: ["symmetry-of-an-infinite-uniform-line-charge", "off-axis-infinite-line-charge", "multipoles-finite-charge-distributions-and-far-field-limits", "streamline-representation-of-electric-fields", "field-of-an-infinite-uniform-sheet"]
---

# 1.43 Derivation and Distance Scaling of the Infinite-Line Field

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 49, Page 50, Section: 2.4.1 Setting Up the Problem: The Importance of Symmetry

For an infinite line charge on the $z$ axis, an element $dQ=\rho_Ldz'$ at source coordinate $z'$ contributes a Coulomb field at a point a radial distance $\rho$ away. The source-to-field displacement is $\rho\mathbf{a}_\rho-z'\mathbf{a}_z$, and its magnitude is $\sqrt{\rho^2+z'^2}$. Integrating from $-\infty$ to $\infty$ sums the complete line. The axial part is an odd function of $z'$ and integrates to zero, while the radial part is even and survives. Evaluation gives a purely radial field whose magnitude decreases as $1/\rho$. This decay is slower than the $1/r^2$ field of a point charge because an infinite source continues to contribute charge as the observation radius grows. A tenfold increase in distance therefore reduces a line-charge field to one tenth, but reduces a point-charge field to one hundredth.

## Page-Grounded Details

#### Page 49

If we maintain $\phi$ and $z$ constant and vary $\rho$, the problem changes, and Coulomb's law leads us to expect the field to become weaker as $\rho$ increases. Hence, by a process of elimination we are led to the fact that the field varies only with $\rho$.

Now, which components are present? Each incremental length of line charge acts as a point charge and produces an incremental contribution to the electric field intensity that is directed away from the bit of charge (assuming a positive line charge). No element of charge produces a $\phi$ component of electric intensity; $E_{\phi}$ is zero. However, each element does produce an $E_{\rho}$ and an $E_{z}$ component, but the contribution to $E_{z}$ by elements of charge that are equal distances above and below the point at which we are determining the field will cancel. Therefore only an $E\rho$ component is expected, and this will vary only with $\rho$. Now to find this component.

We choose a point $P(0,y,0)$ on the $y$ axis at which to determine the field. This is a perfectly general point in view of the lack of variation of the field with $\phi$ and $z$. Applying (10) to find the incremental fi

[Truncated for analysis]

#### Page 50

or finally,
$$
\mathbf{E}=\frac{\rho_{\mathrm{L}}}{2\pi\epsilon_{0}\rho}\mathbf{a}_{\rho}\quad{(16)}
$$
We note that the field falls off inversely with the distance to the charged line, as compared with the point charge, where the field decreased with the square of the distance. Moving 10 times as far from a point charge leads to a field only 1 percent the previous strength, but moving 10 times as far from a line charge only reduces the field to 10 percent of its former value. An analogy can be drawn with a source of illumination, for the light intensity from a point source of light also falls off inversely as the square of the distance to the source. The field of an infinitely long fluorescent tube thus decays inversely as the first power of the radial distance to the tube, and we should expect the light intensity about a finite-length tube to obey this law near the tube. As our point recedes farther and farther from a finite-length tube, however, it eventually looks like a point source, and the field obeys the inverse-square relationship.

#### 2.4.2 Field of an Off-Axis Line Charge

Before leaving this introductory look at the field of the infinite line charge, it should be re

[Truncated for analysis]

## Core Ideas

- The differential source charge is $dQ=\rho_Ldz'$.
- The displacement is $\rho\mathbf{a}_\rho-z'\mathbf{a}_z$.
- The denominator is $(\rho^2+z'^2)^{3/2}$.
- The axial integrand has odd parity and integrates to zero.
- The radial field is proportional to $1/\rho$.
- The infinite-line field decays more slowly than a point-charge field.

## Source Anchors

- The differential field is
$$
d\mathbf{E}=\frac{\rho_Ldz'(\rho\mathbf{a}_\rho-z'\mathbf{a}_z)}{4\pi\epsilon_0(\rho^2+z'^2)^{3/2}}
$$
- The integration extends over $-\infty<z'<\infty$.
- The substitution $z'=\rho\cot\theta$ is suggested for evaluating the surviving integral.
- Equation (16):
$$
\mathbf{E}=\frac{\rho_L}{2\pi\epsilon_0\rho}\mathbf{a}_\rho
$$
- The text compares the line field with an infinitely long fluorescent tube and the point field with a point light source.
- A finite line behaves approximately like an infinite line nearby and like a point source sufficiently far away.

## Related Pages

- [[symmetry-of-an-infinite-uniform-line-charge|Symmetry of an Infinite Uniform Line Charge]]
- [[off-axis-infinite-line-charge|Off-Axis Infinite Line Charge]]
- [[multipoles-finite-charge-distributions-and-far-field-limits|Multipoles, Finite Charge Distributions, and Far-Field Limits]]
- [[streamline-representation-of-electric-fields|Streamline Representation of Electric Fields]]
- [[field-of-an-infinite-uniform-sheet|Field of an Infinite Uniform Sheet]]

## Concept Dependencies

- enables: [[off-axis-infinite-line-charge|Off-Axis Infinite Line Charge]]
- part-of: [[field-of-an-infinite-uniform-sheet|Field of an Infinite Uniform Sheet]]
- example-of: [[streamline-representation-of-electric-fields|Streamline Representation of Electric Fields]]
