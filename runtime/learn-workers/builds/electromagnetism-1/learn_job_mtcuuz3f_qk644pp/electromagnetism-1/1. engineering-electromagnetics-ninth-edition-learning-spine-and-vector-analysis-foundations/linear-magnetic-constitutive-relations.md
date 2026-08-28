---
title: "1.121 Linear Magnetic Constitutive Relations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 263", "Page 264", "Page 265", "Page 266", "Section 8.6", "Example 8.5", "Problem D8.6"]
related: ["magnetization-and-bound-currents", "anisotropic-and-nonlinear-magnetic-media", "magnetic-boundary-conditions", "magnetic-circuit-analogy-and-reluctance"]
---

# 1.121 Linear Magnetic Constitutive Relations

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 263, Page 264, Page 265, Page 266, Section 8.6, Example 8.5, Problem D8.6

The general relationship among magnetic flux density, magnetic field intensity, and magnetization is $\mathbf{B}=\mu_0(\mathbf{H}+\mathbf{M})$. In a linear isotropic material, magnetization is proportional to field intensity, $\mathbf{M}=\chi_m\mathbf{H}$, where $\chi_m$ is magnetic susceptibility. Substitution gives $\mathbf{B}=\mu_0(1+\chi_m)\mathbf{H}$. Relative permeability is therefore defined by $\mu_r=1+\chi_m$, and absolute permeability is $\mu=\mu_0\mu_r$. These definitions reduce the constitutive relationship to $\mathbf{B}=\mu\mathbf{H}$. Example 8.5 applies the chain of relations to a linear ferrite with $B=0.05$ T and $\mu_r=50$. It obtains $\chi_m=49$, $H=796$ A/m, and $M=39{,}000$ A/m. The example also shows two equivalent interpretations: one can explicitly add the free-current and magnetization contributions through $\mu_0(H+M)$, or absorb the bound-charge response into the relative permeability through $\mu_r\mu_0H$. The latter interpretation is adopted for subsequent engineering calculations.

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

#### Page 265

The magnetization is $M = \chi_{m}H$, or 39,000 A/m. The alternate ways of relating B and H are, first,
$$
B = \mu_{0}(H + M)
$$
or
$$
0.05 = 4\pi \times 10^{-7}(796 + 39,000)
$$
showing that Amperian currents produce 49 times the magnetic field intensity that the free charges do; and second,
$$
B = \mu_{r}\mu_{0}H
$$
or
$$
0.05 = 50 \times 4\pi \times 10^{-7} \times 796
$$
where we use a relative permeability of 50 and let this quantity account completely for the motion of the bound charges. We shall emphasize the latter interpretation in the chapters that follow.

The first two laws that we investigated for magnetic fields were the Biot-Savart law and Ampère's circuital law. Both were restricted to free space in their applica-tion. We may now extend their use to any homogeneous, linear, isotropic magnetic material that may be described in terms of a relative permeability $\mu_{r}$.

Just as we found for anisotropic dielectric materials, the permeability of an anisotropic magnetic material must be given as a $3 \times 3$ matrix, and B and H are both $3 \times 1$ matrices. We have
$$ \begin{align*}B_x &= \mu_{xx}H_x + \mu_{xy}H_y + \mu_{xz}H_z\\B_y &= \mu_{yx}H_x +

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

- The general material relation is $\mathbf{B}=\mu_0(\mathbf{H}+\mathbf{M})$.
- Linear isotropic media satisfy $\mathbf{M}=\chi_m\mathbf{H}$.
- Relative permeability is $\mu_r=1+\chi_m$.
- Absolute permeability is $\mu=\mu_0\mu_r$.
- The simplified constitutive law is $\mathbf{B}=\mu\mathbf{H}$.
- In free space, $\mathbf{M}=0$ and $\mathbf{B}=\mu_0\mathbf{H}$.
- Susceptibility is dimensionless, while $H$ and $M$ are measured in A/m.
- Material response may be represented explicitly through $M$ or implicitly through $\mu_r$.

## Source Anchors

- Equation (25) gives $\mathbf{B}=\mu_0(\mathbf{H}+\mathbf{M})$.
- Equations (28) through (31) define $\mathbf{M}=\chi_m\mathbf{H}$, $\mu_r=1+\chi_m$, $\mu=\mu_0\mu_r$, and $\mathbf{B}=\mu\mathbf{H}$.
- Example 8.5 uses $B=0.05$ T and $\mu_r=50$ to calculate $\chi_m=49$, $H=796$ A/m, and $M=39{,}000$ A/m.
- The example states that the Amperian-current contribution is 49 times the free-charge field-intensity contribution.
- Problem D8.6 asks for magnetization from combinations of $\mu$, $\mu_r$, atomic dipole density, $B$, and $\chi_m$.

## Related Pages

- [[magnetization-and-bound-currents|Magnetization and Bound Currents]]
- [[anisotropic-and-nonlinear-magnetic-media|Anisotropic and Nonlinear Magnetic Media]]
- [[magnetic-boundary-conditions|Magnetic Boundary Conditions]]
- [[magnetic-circuit-analogy-and-reluctance|Magnetic Circuit Analogy and Reluctance]]

## Concept Dependencies

- depends-on: [[magnetization-and-bound-currents|Magnetization and Bound Currents]]
