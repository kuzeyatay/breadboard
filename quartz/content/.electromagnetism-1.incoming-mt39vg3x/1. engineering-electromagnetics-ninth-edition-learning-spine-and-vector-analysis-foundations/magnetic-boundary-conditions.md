---
title: "1.123 Magnetic Boundary Conditions"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 266", "Page 267", "Page 268", "Page 269", "Section 8.7", "Figure 8.10", "Example 8.6", "Problem D8.8"]
related: ["free-bound-and-total-magnetic-currents", "linear-magnetic-constitutive-relations", "magnetic-circuit-analogy-and-reluctance"]
---

# 1.123 Magnetic Boundary Conditions

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 266, Page 267, Page 268, Page 269, Section 8.7, Figure 8.10, Example 8.6, Problem D8.8

At an interface between two homogeneous linear isotropic magnetic media, the normal and tangential field components obey different continuity laws. Applying Gauss's law for magnetism to a thin pillbox gives $(\mathbf{B}_2-\mathbf{B}_1)\cdot\mathbf{a}_{N12}=0$, so the normal component of $\mathbf{B}$ is continuous. Since $\mathbf{B}=\mu\mathbf{H}$, the normal field intensity changes according to $H_{N2}=(\mu_1/\mu_2)H_{N1}$. Applying Ampère's law to a small loop crossing the interface gives $(\mathbf{H}_1-\mathbf{H}_2)\times\mathbf{a}_{N12}=\mathbf{K}$, where $\mathbf{K}$ is the free surface current density. Equivalently, $\mathbf{H}_{t1}-\mathbf{H}_{t2}=\mathbf{a}_{N12}\times\mathbf{K}$. The tangential flux densities satisfy $B_{t1}/\mu_1-B_{t2}/\mu_2=K$ in the scalar orientation used by the source. If no free surface current exists, tangential $\mathbf{H}$ is continuous. Example 8.6 demonstrates the vector procedure: split the known field into normal and tangential parts, preserve normal $\mathbf{B}$, apply the surface-current jump to tangential $\mathbf{H}$, and reconstruct the unknown $\mathbf{B}$.

## Page-Grounded Details

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

#### Page 267

components is determined by allowing the surface to cut a small cylindrical gaussian surface. Applying Gauss's law for the magnetic field from Section 7.5,
$$
\oint_{S} B \cdot d\mathbf{S}= 0
$$
we find that
$$
B_{N1}\Delta S-B_{N2}\Delta S=0
$$
or the normal component of $\mathbf{B}$ is continuous across the boundary $(B_{N2}=B_{N1})$. A more formal statement of this is
$$
(\mathbf{B}_{2}-\mathbf{B}_{1}) \cdot \mathbf{a}_{N12}= 0
$$
(32)

where $\mathbf{a}_{N12}$ is the unit normal at the boundary directed from region 1 to region 2.

The normal component of $\mathbf{B}$ is continuous, and therefore the normal component of $\mathbf{H}$ is discontinuous by the ratio $\mu_{1}/\mu_{2}$.
$$
H_{N2}=\frac{\mu_{1}}{\mu_{2}} H_{N1}
$$
(33)

The relationship between the normal components of $\mathbf{M}$, of course, is fixed once the relationship between the normal components of $\mathbf{H}$ is known. For linear magnetic materials, the result is written simply as
$$
M_{N2}=\chi_{m2}\frac{\mu_{1}}{\mu_{2}} H_{N1}=\frac{\chi_{m2}\mu_{1}}{\chi_{m1}\mu_{2}} M_{N1}
$$
(34)

Next, Ampère's circuital law
$$
\oint\mathbf{H} \cdot d\mathbf{L}= I
$$
is applied about a small closed path in

[Truncated for analysis]

#### Page 268

For tangential B, we have
$$
\frac{B_{t1}}{\mu_{1}}-\frac{B_{t2}}{\mu_{2}}=K\qquad(36)
$$
The boundary condition on the tangential component of the magnetization for linear materials is therefore
$$
M_{t2}=\frac{\chi_{m2}}{\chi_{m1}}M_{t1}-\chi_{m2}K\qquad(37)
$$
The last three boundary conditions on the tangential components are much simpler, of course, if the surface current density is zero. This is a free current density, and it must be zero if neither material is a conductor.

#### EXAMPLE 8.6

To illustrate these relationships with an example, let us assume that $\mu=\mu_{1}=4\,\mu H/m$ in region 1 where z> 0, whereas $\mu_{2}=7\,\mu H/m$ in region 2 wherever $z<0$ . Moreover,let K= 80a_x A/m on the surface z= 0. We establish a field, $B_{1}=2a_{x}-3a_{y}+a_{z}\,mT$ ,in region 1 and seek the value of $B_{2}$ .

Solution. The normal component of $B_{1}$ is
$$
B_{N1}=(B_{1}\cdot a_{N12})a_{N12}=[(2a_{x}-3a_{y}+a_{z})\cdot(-a_{z})](-a_{z})=a_{z}\,mT
$$
Thus,
$$
B_{N2}=B_{N1}=a_{z}\,mT
$$
We next determine the tangential components:
$$
B_{t1}=B_{1}-B_{N1}=2a_{x}-3a_{y}\,mT
$$
and
$$ H_{t1}=\frac{B_{t1}}{\mu_{1}}=\frac{(2a_{x}-3a_{y})\,10^{-3}}{4\times 10^{-6

[Truncated for analysis]

#### Page 269

D8.8. Let the permittivity be 5 $\mu H/m$ in region A where $x<0$, and 20 $\mu H/m$ in region B where $x>0$. If there is a surface current density $\mathbf{K}=150\mathbf{a}_{y}-200\mathbf{a}_{z}$ A/m at $x=0$, and if $H_{A}=300\mathbf{a}_{x}-400\mathbf{a}_{y}+500\mathbf{a}_{z}$ A/m, find: (a) $|\mathbf{H}_{tA}|$; (b) $|\mathbf{H}_{NA}|$; (c) $|\mathbf{H}_{tB}|$; (d) $|\mathbf{H}_{NB}|$.

Answer: (a) 640 A/m; (b) 300 A/m; (c) 695 A/m; (d) 75 A/m

#### 8.8 THE MAGNETIC CIRCUIT

In this section, we digress briefly to discuss the fundamental techniques involved in solving a class of magnetic problems known as magnetic circuits. As we will see shortly, the name arises from the great similarity to the dc-resistive-circuit analysis with which it is assumed we are all familiar. The only important difference lies in the non-linear nature of the ferromagnetic portions of the magnetic circuit; the methods which must be adopted are similar to those required in nonlinear electric circuits which contain diodes, thermistors, incandescent filaments, and other nonlinear elements.

As a convenient starting point, we identify those field equations on which resistive circuit anal

[Truncated for analysis]

## Core Ideas

- The normal component of $\mathbf{B}$ is continuous across every magnetic interface.
- The normal component of $\mathbf{H}$ changes inversely with permeability.
- The normal condition is $(\mathbf{B}_2-\mathbf{B}_1)\cdot\mathbf{a}_{N12}=0$.
- A free surface current creates a jump in tangential $\mathbf{H}$.
- The vector jump condition is $(\mathbf{H}_1-\mathbf{H}_2)\times\mathbf{a}_{N12}=\mathbf{K}$.
- If $\mathbf{K}=0$, tangential $\mathbf{H}$ is continuous.
- Tangential $\mathbf{B}$ need not be continuous when permeabilities differ.
- Field reconstruction requires careful use of the interface-normal direction.

## Source Anchors

- Figure S13.P266.F8.10 shows the Gaussian pillbox and Ampèrian loop used to derive both interface conditions.
- Equation (32) gives $(\mathbf{B}_2-\mathbf{B}_1)\cdot\mathbf{a}_{N12}=0$.
- Equation (33) gives $H_{N2}=(\mu_1/\mu_2)H_{N1}$.
- Equation (35) gives $(\mathbf{H}_1-\mathbf{H}_2)\times\mathbf{a}_{N12}=\mathbf{K}$.
- Equations (34) and (37) give the corresponding normal and tangential magnetization relationships for linear materials.
- Example 8.6 obtains $\mathbf{B}_2=(3.5\mathbf{a}_x-4.69\mathbf{a}_y+\mathbf{a}_z)$ mT from $\mathbf{B}_1$, $\mu_1$, $\mu_2$, and $\mathbf{K}$.
- Problem D8.8 asks for normal and tangential field magnitudes on both sides of a current-carrying interface.

## Related Pages

- [[free-bound-and-total-magnetic-currents|Free, Bound, and Total Magnetic Currents]]
- [[linear-magnetic-constitutive-relations|Linear Magnetic Constitutive Relations]]
- [[magnetic-circuit-analogy-and-reluctance|Magnetic Circuit Analogy and Reluctance]]

## Concept Dependencies

- depends-on: [[linear-magnetic-constitutive-relations|Linear Magnetic Constitutive Relations]]
- depends-on: [[free-bound-and-total-magnetic-currents|Free, Bound, and Total Magnetic Currents]]
