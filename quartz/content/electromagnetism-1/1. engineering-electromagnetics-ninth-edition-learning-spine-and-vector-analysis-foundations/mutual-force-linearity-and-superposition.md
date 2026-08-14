---
title: "1.33 Mutual Force, Linearity, and Superposition"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 40", "Equation (5)", "Page 41", "Problem D2.1"]
related: ["coulombs-experimental-inverse-square-law", "vector-form-of-coulombs-law", "electric-field-superposition-from-multiple-point-charges"]
---

# 1.33 Mutual Force, Linearity, and Superposition

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 40, Equation (5), Page 41, Problem D2.1

Electrostatic force between two point charges is mutual: the forces have equal magnitudes and opposite directions. In the source notation, $\mathbf{a}_{21}=-\mathbf{a}_{12}$ and therefore
$$
\mathbf{F}_1=-\mathbf{F}_2
$$
 Coulomb's law is also linear in each charge. Multiplying one source charge by a factor $n$ multiplies the resulting force by the same factor. This linearity permits superposition: when several charges are present, the force on a selected charge is the vector sum of the forces produced by each other charge acting alone. Superposition preserves direction, so individual force vectors must be computed before they are added. This principle becomes the direct basis for electric-field superposition, where the field contributions of multiple source charges are added at a common observation point. Problem D2.1 reinforces the directed-displacement and force calculation using two charges at arbitrary rectangular-coordinate locations.

## Page-Grounded Details

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

#### Page 41

Coulomb's law is linear, for if we multiply $Q_{1}$ by a factor $n$, the force on $Q_{2}$ is also multiplied by the same factor $n$. It is also true that the force on a charge in the presence of several other charges is the sum of the forces on that charge arising from each of the other charges acting alone.

D2.1. A charge $Q_{A}=-20\mu C$ is located at $A(-6,4,7)$, and a charge $Q_{B}=50\mu C$ is at $B(5,8,-2)$ in free space. If distances are given in meters, find: (a) $R_{AB}$; (b) $R_{AB}$. Determine the vector force exerted on $Q_{A}$ by $Q_{B}$ if $\epsilon_{0}=(c)10^{-9}/(36\pi)F/m$; (d) $8.854\times10^{-12}F/m$.

Ans. (a) $11a_{x}+4a_{y}-9a_{z}m$; (b) 14.76 m; (c) $30.76a_{x}+11.184a_{y}-25.16a_{z}mN$; (d) $30.72a_{x}+11.169a_{y}-25.13a_{z}mN$

#### 2.2 ELECTRIC FIELD INTENSITY

Here, we introduce the first of several field quantities that we will use throughout our study. The electric field intensity gives the magnitude and direction of electrostatic force that would be applied to a point charge of unit magnitude that resides in the field, and as a function of its location. Emphasized here is the notion of the force acting at a point, and

[Truncated for analysis]

## Core Ideas

- The force on $Q_1$ is equal and opposite to the force on $Q_2$.
- $\mathbf{a}_{21}=-\mathbf{a}_{12}$.
- Scaling a charge scales the force by the same factor.
- For multiple charges, compute each pairwise contribution independently.
- Add force contributions as vectors, not as unsigned magnitudes.
- Do not include the selected charge's force on itself.
- Force superposition leads directly to electric-field superposition.

## Source Anchors

- Equation (5) states $\mathbf{F}_1=-\mathbf{F}_2$.
- The text calls Coulomb's force a mutual force.
- The text states that multiplying $Q_1$ by $n$ multiplies the force on $Q_2$ by $n$.
- The force in the presence of several charges is described as the sum of forces from the charges acting alone.
- D2.1 specifies charges at A and B and asks for the displacement, separation, and force using two values of $\epsilon_0$.
- D2.1 reports closely matching force components for the exact and approximate permittivity values.

## Related Pages

- [[coulombs-experimental-inverse-square-law|Coulomb's Experimental Inverse-Square Law]]
- [[vector-form-of-coulombs-law|Vector Form of Coulomb's Law]]
- [[electric-field-superposition-from-multiple-point-charges|Electric Field Superposition from Multiple Point Charges]]

## Concept Dependencies

- depends-on: [[vector-form-of-coulombs-law|Vector Form of Coulomb's Law]]
