---
title: "1.120 Free, Bound, and Total Magnetic Currents"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 263", "Page 264", "Page 266", "Section 8.6", "Problem D8.7"]
related: ["magnetization-and-bound-currents", "linear-magnetic-constitutive-relations", "magnetic-boundary-conditions"]
---

# 1.120 Free, Bound, and Total Magnetic Currents

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 263, Page 264, Page 266, Section 8.6, Problem D8.7

The magnetic flux density $\mathbf{B}$ responds to both free current and the microscopic bound currents represented by magnetization. Ampère's law written with $\mathbf{B}$ includes the total enclosed current, $I_T=I_B+I$, where $I_B$ is bound current and $I$ is free current. Thus $\oint(\mathbf{B}/\mu_0)\cdot d\mathbf{L}=I_T$. Subtracting the magnetization circulation $I_B=\oint\mathbf{M}\cdot d\mathbf{L}$ isolates the free current as $I=\oint(\mathbf{B}/\mu_0-\mathbf{M})\cdot d\mathbf{L}$. This motivates the definition $\mathbf{H}=\mathbf{B}/\mu_0-\mathbf{M}$, after which Ampère's circuital law becomes $I=\oint\mathbf{H}\cdot d\mathbf{L}$. In local form, the three current categories satisfy $\nabla\times(\mathbf{B}/\mu_0)=\mathbf{J}_T$, $\nabla\times\mathbf{M}=\mathbf{J}_B$, and $\nabla\times\mathbf{H}=\mathbf{J}$. The text emphasizes the last equation because Maxwell's equations use free current density without a subscript. This separation allows material magnetization to be absorbed into constitutive properties while externally supplied conduction currents remain explicit sources.

## Page-Grounded Details

#### Page 263

Equation (21) merely says that if we go around a closed path and find dipole moments going our way more often than not, there will be a corresponding current composed of, for example, orbiting electrons crossing the interior surface.

This last expression has some resemblance to Ampère's circuital law, and we may now generalize the relationship between B and H so that it applies to media other than free space. Our present discussion is based on the forces and torques on differential current loops in a B field, and we therefore take B as our fundamental quantity and seek an improved definition of H. We thus write Ampère's circuital law in terms of the total current, bound plus free,
$$
\oint\frac{\mathbf{B}}{\mu_{0}}\cdot d\mathbf{L}=I_{T}\quad{(22)}
$$
where
$$
I_{T}=I_{B}+I
$$
and I is the total free current enclosed by the closed path. Note that the free current appears without subscript since it is the most important type of current and will be the only current appearing in Maxwell's equations.

Combining these last three equations, we obtain an expression for the free cur-rent enclosed,
$$
I=I_{T}-I_{B}=\oint\left(\frac{\mathbf{B}}{\mu_{0}}-\mathbf{M}\right)\cdot d\mathbf{

[Truncated for analysis]

#### Page 264

With the help of Stokes' theorem, we may therefore transform (21), (26), and (22) into the equivalent curl relationships:
$$
 \begin{array}[]{l}\nabla\times M = J_{B}\\\nabla\times\frac{B}{\mu_{0}} = J_{T}\end{array}
$$
$$
 \nabla\times H = J \qquad(27)
$$
We will emphasize only (26) and (27), the two expressions involving the free charge, in the work that follows.

The relationship between B, H, and M expressed by (25) may be simplified for linear isotropic media where a magnetic susceptibility $\chi_{m}$ can be defined:
$$
 M = \chi_{m} H \qquad(28)
$$
Thus we have
$$
 \begin{array}[]{l}B = \mu_{0}(H + \chi_{m}H)\\\qquad=\mu_{0}\mu_{r}H\end{array}
$$
where
$$
 \mu_{r} = 1 + \chi_{m} \qquad(29)
$$
is defined as the relative permeability $\mu_{r}$. We next define the permeability $\mu$:
$$
 \mu = \mu_{0}\mu_{r} \qquad(30)
$$
and this enables us to write the simple relationship between B and H
$$
 B = \mu H \qquad(31)
$$
#### EXAMPLE 8.5

Given a ferrite material that we shall specify to be operating in a linear mode with $B=0.05$ T, let us assume $\mu_{r}=50$, and calculate values for $\chi_{m}$, M, and H.

Solution. Because $\mu_{r}=1+\chi_{m}$, we have
$$
 \c

[Truncated for analysis]

#### Page 266

values of $\mu_r$ would range from 10 to 100,000. Diamagnetic, paramagnetic, and anti-ferromagnetic materials are commonly said to be nonmagnetic.

D8.6. Find the magnetization in a magnetic material where: (a) $\mu = 1.8 \times 10^{-5}$ H/m and $H = 120$ A/m; (b) $\mu_r = 22$, there are $8.3 \times 10^{28}$ atoms/m^3, and each atom has a dipole moment of $4.5 \times 10^{-27}$ A $\cdot$ m^2; (c) $B = 300$ µT and $\chi_m = 15$.

Ans. (a) 1599 A/m; (b) 374 A/m; (c) 224 A/m

D8.7. The magnetization in a magnetic material for which $\chi_m = 8$ is given in a certain region as $150z^{2} \mathbf{a}_x$ A/m. At $z = 4$ cm, find the magnitude of: (a) $\mathbf{J}_T$; (b) $\mathbf{J}$; (c) $\mathbf{J}_B$.

Ans. (a) $13.5\ \text{A/m}^2$; (b) $1.5\ \text{A/m}^2$; (c) $12\ \text{A/m}^2$

#### 8.7 MAGNETIC BOUNDARY CONDITIONS

We should have no difficulty in arriving at the proper boundary conditions to apply to $\mathbf{B}$, $\mathbf{H}$, and $\mathbf{M}$ at the interface between two different magnetic materials, for we have solved similar problems for both conducting materials and dielectrics. We need no new techniques.

Figure 8.10 shows a boundary betwe

[Truncated for analysis]

## Core Ideas

- Total current is the sum $I_T=I_B+I$.
- The $\mathbf{B}$ circulation counts total current: $\oint(\mathbf{B}/\mu_0)\cdot d\mathbf{L}=I_T$.
- The $\mathbf{M}$ circulation counts bound current: $\oint\mathbf{M}\cdot d\mathbf{L}=I_B$.
- The field $\mathbf{H}$ is defined to isolate free current.
- Ampère's law in matter is $\oint\mathbf{H}\cdot d\mathbf{L}=I$.
- The differential free-current law is $\nabla\times\mathbf{H}=\mathbf{J}$.
- Bound, free, and total currents also have surface-integral representations through their respective current densities.

## Source Anchors

- Equation (22) states $\oint(\mathbf{B}/\mu_0)\cdot d\mathbf{L}=I_T$.
- Equation (23) isolates free current as $I=\oint(\mathbf{B}/\mu_0-\mathbf{M})\cdot d\mathbf{L}$.
- Equation (24) defines $\mathbf{H}=\mathbf{B}/\mu_0-\mathbf{M}$.
- Equation (26) gives $I=\oint\mathbf{H}\cdot d\mathbf{L}$.
- Equation (27) gives $\nabla\times\mathbf{H}=\mathbf{J}$.
- Problem D8.7 uses a specified magnetization field to distinguish $\mathbf{J}_T$, $\mathbf{J}$, and $\mathbf{J}_B$.

## Related Pages

- [[magnetization-and-bound-currents|Magnetization and Bound Currents]]
- [[linear-magnetic-constitutive-relations|Linear Magnetic Constitutive Relations]]
- [[magnetic-boundary-conditions|Magnetic Boundary Conditions]]

## Concept Dependencies

- related: [[linear-magnetic-constitutive-relations|Linear Magnetic Constitutive Relations]]
