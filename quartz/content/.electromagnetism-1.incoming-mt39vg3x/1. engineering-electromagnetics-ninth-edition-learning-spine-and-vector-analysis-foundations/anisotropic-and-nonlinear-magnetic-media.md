---
title: "1.122 Anisotropic and Nonlinear Magnetic Media"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 265", "Page 266", "Section 8.6"]
related: ["linear-magnetic-constitutive-relations", "ferromagnetic-magnetization-and-hysteresis", "nonlinear-gapped-magnetic-circuit-analysis"]
---

# 1.122 Anisotropic and Nonlinear Magnetic Media

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 265, Page 266, Section 8.6

The scalar permeability relation $\mathbf{B}=\mu\mathbf{H}$ is restricted to isotropic media. In an anisotropic magnetic material, permeability is a $3\times3$ matrix and each component of $\mathbf{B}$ can depend on all three components of $\mathbf{H}$. For example, $B_x=\mu_{xx}H_x+\mu_{xy}H_y+\mu_{xz}H_z$, with corresponding expressions for $B_y$ and $B_z$. The general identity $\mathbf{B}=\mu_0(\mathbf{H}+\mathbf{M})$ remains valid, but $\mathbf{B}$, $\mathbf{H}$, and $\mathbf{M}$ need not be parallel. Single ferromagnetic crystals and thin magnetic films are common anisotropic systems, while many practical ferromagnetic components are polycrystalline. Linearity is another independent assumption. Diamagnetic and paramagnetic materials are commonly close to linear, with relative permeability usually differing from unity by less than about one part in a thousand. Ferromagnetic materials can have effective relative-permeability ratios ranging approximately from 10 to 100,000, but their $B$ versus $H$ response is generally nonlinear and history-dependent. Consequently, a fixed scalar permeability cannot fully describe ferromagnetic operation over a wide field range.

## Page-Grounded Details

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

- Anisotropic permeability is represented by a $3\times3$ matrix.
- Off-diagonal permeability terms couple different field components.
- In anisotropic media, $\mathbf{B}$ and $\mathbf{H}$ are not generally parallel.
- The identity $\mathbf{B}=\mu_0(\mathbf{H}+\mathbf{M})$ remains valid for anisotropic materials.
- Single ferromagnetic crystals and thin magnetic films commonly exhibit anisotropy.
- Diamagnetic and paramagnetic materials usually have $\mu_r$ very close to one.
- Ferromagnetic materials can exhibit very large but nonlinear effective permeability.
- A constant susceptibility or permeability requires a linear operating regime.

## Source Anchors

- Page 265 gives the component equations for the $3\times3$ permeability matrix.
- The text states that $\mathbf{B}$, $\mathbf{H}$, and $\mathbf{M}$ are not generally parallel in anisotropic media.
- Representative diamagnetic susceptibilities include hydrogen at $-2\times10^{-5}$ and graphite at $-12\times10^{-5}$.
- Representative paramagnetic susceptibilities include oxygen at $2\times10^{-6}$ and ferric oxide at $1.4\times10^{-3}$.
- Page 266 reports typical effective ferromagnetic $\mu_r$ values from 10 to 100,000.
- Diamagnetic, paramagnetic, and antiferromagnetic materials are commonly described as nonmagnetic in engineering usage.

## Related Pages

- [[linear-magnetic-constitutive-relations|Linear Magnetic Constitutive Relations]]
- [[ferromagnetic-magnetization-and-hysteresis|Ferromagnetic Magnetization and Hysteresis]]
- [[nonlinear-gapped-magnetic-circuit-analysis|Nonlinear Gapped Magnetic Circuit Analysis]]

## Concept Dependencies

- contrasts-with: [[linear-magnetic-constitutive-relations|Linear Magnetic Constitutive Relations]]
