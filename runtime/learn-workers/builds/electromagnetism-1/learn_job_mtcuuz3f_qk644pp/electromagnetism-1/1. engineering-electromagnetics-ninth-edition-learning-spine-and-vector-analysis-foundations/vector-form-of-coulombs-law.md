---
title: "1.32 Vector Form of Coulomb's Law"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 39", "Page 40", "Figure 2.1", "Equations (3) and (4)", "Example 2.1"]
related: ["coulombs-experimental-inverse-square-law", "mutual-force-linearity-and-superposition", "point-charge-electric-field-at-the-origin-and-general-locations", "geometric-procedures-using-dot-and-cross-products"]
---

# 1.32 Vector Form of Coulomb's Law

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 39, Page 40, Figure 2.1, Equations (3) and (4), Example 2.1

The vector form of Coulomb's law combines the force magnitude with a directed displacement between source and observation charges. If $\mathbf{r}_1$ locates $Q_1$ and $\mathbf{r}_2$ locates $Q_2$, then $\mathbf{R}_{12}=\mathbf{r}_2-\mathbf{r}_1$ points from $Q_1$ to $Q_2$, and
$$
\mathbf{a}_{12}=\frac{\mathbf{R}_{12}}{|\mathbf{R}_{12}|}
$$
 The force on $Q_2$ is
$$
\mathbf{F}_2=\frac{Q_1Q_2}{4\pi\epsilon_0R_{12}^2}\mathbf{a}_{12}
$$
 The charge product supplies the sign, so a negative product reverses the force relative to $\mathbf{a}_{12}$. Figure 2.1 shows the like-charge case, where the force on $Q_2$ points in the same direction as $\mathbf{R}_{12}$. The procedure is reusable: construct the directed displacement, compute its magnitude, normalize it, evaluate the scalar coefficient, and combine coefficient and direction.

## Page-Grounded Details

#### Page 39

space by a distance, which is large compared to their size, is proportional to the charge on each and inversely proportional to the square of the distance between them, or
$$
F=k\frac{Q_{1}Q_{2}}{R^{2}}
$$
where $Q_{1}$ and $Q_{2}$ are the positive or negative quantities of charge, R is the separation, and k is a proportionality constant. If the International System of Units^1 (SI) is used, Q is measured in coulombs (C), R is in meters (m), and the force should be newtons (N). This will be achieved if the constant of proportionality k is written as
$$
k=\frac{1}{4\pi\epsilon_{0}}
$$
The new constant $\epsilon_{0}$ is called the permittivity of free space and has magnitude, measured in farads per meter (F/m),
$$
\epsilon_{0}=8.854\times 10^{-12}=\frac{1}{36\pi}\,10^{-9}\,{\rm F/m}\qquad(1)
$$
The quantity $\epsilon_{0}$ is not dimensionless, for Coulomb's law shows that it has the label $C^{2}/N\cdot m^{2}$. We will later define the farad and show that it has the dimensions $C^{2}/N\cdot m$; we have anticipated this definition by using the unit F/m in Eq. (1).

Coulomb's law is now
$$
F=\frac{Q_{1}Q_{2}}{4\pi\epsilon_{0}R^{2}}\qquad(2)
$$
The coulomb is an extrem

[Truncated for analysis]

#### Page 40

Figure 2.1 If $Q_{1}$ and $Q_{2}$ have like signs, the vector force $F_{2}$ on $Q_{2}$ is in the same direction as the vector $R_{12}$.

vector $F_{2}$ is the force on $Q_{2}$ and is shown for the case where $Q_{1}$ and $Q_{2}$ have the same sign. The vector form of Coulomb's law is
$$
F_{2}=\frac{Q_{1}\,Q_{2}}{4\pi\epsilon_{0}R_{12}^{2}}\,a_{12}\quad{(3)}
$$
where $a_{12}$ = a unit vector in the direction of $R_{12}$, or
$$
a_{12}=\frac{R_{12}}{|R_{12}|}=\frac{R_{12}}{R_{12}}=\frac{r_{2}-r_{1}}{|r_{2}-r_{1}|}\quad{(4)}
$$
#### EXAMPLE 2.1

We illustrate the use of the vector form of Coulomb's law by locating a charge of $Q_{1}=3\times 10^{-4}$ C at M(1, 2, 3) and a charge of $Q_{2}=-10^{-4}$ C at N(2, 0, 5) in a vacuum. We want to find the force exerted on $Q_{2}$ by $Q_{1}$.

Solution. We use (3) and (4) to obtain the vector force. The vector $R_{12}$ is
$$
R_{12}=r_{2}-r_{1}=(2-1)\,a_{x}+(0-2)\,a_{y}+(5-3)\,a_{z}=a_{x}-2\,a_{y}+2\,a_{z}
$$
leading to $|R_{12}|=3$, and the unit vector, $a_{12}=\frac{1}{3}(a_{x}-2\,a_{y}+2\,a_{z})$. Thus,
$$ \begin{align*}F_{2}&=\frac{3\times 10^{-4}(-10^{-4})}{4\pi(1/36\pi)\,10^{-9}\times 3^{2}}(\frac{a_

[Truncated for analysis]

## Core Ideas

- Define $\mathbf{R}_{12}=\mathbf{r}_2-\mathbf{r}_1$.
- Define $\mathbf{a}_{12}=\mathbf{R}_{12}/R_{12}$.
- Use $\mathbf{F}_2=[Q_1Q_2/(4\pi\epsilon_0R_{12}^2)]\mathbf{a}_{12}$.
- The displacement must point from the source charge to the charge experiencing the force.
- A negative charge product reverses the unit-vector direction.
- The final vector can be reported as magnitude times unit direction or in rectangular components.

## Source Anchors

- Equation (3) gives the vector form of Coulomb's law.
- Equation (4) defines $\mathbf{a}_{12}$ from $\mathbf{r}_2-\mathbf{r}_1$.
- Figure 2.1 depicts the displacement and force directions for like charges.
- Example 2.1 constructs $\mathbf{R}_{12}=\mathbf{a}_x-2\mathbf{a}_y+2\mathbf{a}_z$.
- Example 2.1 finds $R_{12}=3$ and $\mathbf{a}_{12}=(\mathbf{a}_x-2\mathbf{a}_y+2\mathbf{a}_z)/3$.
- The resulting force is $\mathbf{F}_2=-10\mathbf{a}_x+20\mathbf{a}_y-20\mathbf{a}_z\ \mathrm{N}$ with magnitude $30\ \mathrm{N}$.

## Related Pages

- [[coulombs-experimental-inverse-square-law|Coulomb's Experimental Inverse-Square Law]]
- [[mutual-force-linearity-and-superposition|Mutual Force, Linearity, and Superposition]]
- [[point-charge-electric-field-at-the-origin-and-general-locations|Point-Charge Electric Field at the Origin and General Locations]]
- [[geometric-procedures-using-dot-and-cross-products|Geometric Procedures Using Dot and Cross Products]]

## Concept Dependencies

- depends-on: [[geometric-procedures-using-dot-and-cross-products|Geometric Procedures Using Dot and Cross Products]]
