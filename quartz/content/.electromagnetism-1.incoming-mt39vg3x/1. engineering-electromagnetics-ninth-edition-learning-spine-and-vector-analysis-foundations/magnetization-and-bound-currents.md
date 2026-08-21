---
title: "1.119 Magnetization and Bound Currents"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 262", "Page 263", "Page 264", "Section 8.6", "Figure 8.9"]
related: ["classification-of-magnetic-materials", "free-bound-and-total-magnetic-currents", "linear-magnetic-constitutive-relations"]
---

# 1.119 Magnetization and Bound Currents

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 262, Page 263, Page 264, Section 8.6, Figure 8.9

Magnetization $\mathbf{M}$ gives a macroscopic description of microscopic magnetic dipoles. A bound current $I_b$ circulating around a differential vector area $d\mathbf{S}$ produces the dipole moment $\mathbf{m}=I_b d\mathbf{S}$. For $n$ dipoles per unit volume, the total moment in a small volume is the vector sum of the individual moments. Magnetization is defined as the limiting dipole moment per unit volume, so $\mathbf{M}=\lim_{\Delta v\to0}(1/\Delta v)\sum_i\mathbf{m}_i$. Only when all dipoles are identical and identically oriented does this reduce to $\mathbf{M}=n\mathbf{m}$. Its units are amperes per meter, the same as those of $\mathbf{H}$. Partial alignment of the dipoles causes microscopic bound-current loops to reinforce one another along a chosen contour. For a differential path segment, the resulting bound-current increment is $dI_B=\mathbf{M}\cdot d\mathbf{L}$. Integration around a closed contour gives $I_B=\oint\mathbf{M}\cdot d\mathbf{L}$. Stokes' theorem then converts this integral relationship to the local current-density equation $\nabla\times\mathbf{M}=\mathbf{J}_B$.

## Page-Grounded Details

#### Page 262

which has the dimensions of $\mathbf{H}$, will be called the magnetization $\mathbf{M}$. The current produced by the bound charges is called a bound current or Amperian current.

We begin by defining the magnetization $\mathbf{M}$ in terms of the magnetic dipole moment $\mathbf{m}$. The bound current $I_{b}$ circulates about a path enclosing a differential area $d\mathbf{S}$, establishing a dipole moment $(\mathbf{A} \cdot \mathbf{m}^{2})$,
$$
\mathbf{m} = I_{b} d\mathbf{S}
$$
If there are $n$ magnetic dipoles per unit volume and we consider a volume $\Delta v$, then the total magnetic dipole moment is found by the vector sum
$$
\mathbf{m}_{\mathrm{total}} = \sum_{i=1}^{n\Delta v} \mathbf{m}_{i}
$$
Each of the $\mathbf{m}_{i}$ may be different. Next, we define the magnetization $\mathbf{M}$ as the magnetic dipole moment per unit volume,
$$
\mathbf{M} = \lim_{\Delta v \to 0} \frac{1}{\Delta v} \sum_{i=1}^{n\Delta v} \mathbf{m}_{i} = \mathbf{n}\mathbf{m} \quad{(identical dipoles)}
$$
(19)

and see that its units must be the same as for $\mathbf{H}$, amperes per meter. The second equality (not the first) in Eq. (19) applies to the special case in which al

[Truncated for analysis]

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

## Core Ideas

- A microscopic current loop has dipole moment $\mathbf{m}=I_b d\mathbf{S}$.
- The total dipole moment is the vector sum $\mathbf{m}_{total}=\sum_i\mathbf{m}_i$.
- Magnetization is magnetic dipole moment per unit volume.
- The simplification $\mathbf{M}=n\mathbf{m}$ applies only to identical dipoles.
- Magnetization has units of A/m.
- Dipole alignment produces a net bound current through the surface enclosed by a contour.
- The contour relation is $I_B=\oint\mathbf{M}\cdot d\mathbf{L}$.
- The corresponding local relation is $\mathbf{J}_B=\nabla\times\mathbf{M}$.

## Source Anchors

- Equation (19) defines $\mathbf{M}=\lim_{\Delta v\to0}(1/\Delta v)\sum_i\mathbf{m}_i$ and gives $\mathbf{M}=n\mathbf{m}$ for identical dipoles.
- Equation (20) derives $dI_B=nI_b d\mathbf{S}\cdot d\mathbf{L}=\mathbf{M}\cdot d\mathbf{L}$.
- Equation (21) states $I_B=\oint\mathbf{M}\cdot d\mathbf{L}$.
- Figure S13.P262.F8.9 shows partially aligned dipoles along a closed-path segment and interprets the increase $nI_b d\mathbf{S}\cdot d\mathbf{L}$ in bound current.
- Page 264 gives the differential relationship $\nabla\times\mathbf{M}=\mathbf{J}_B$.

## Related Pages

- [[classification-of-magnetic-materials|Classification of Magnetic Materials]]
- [[free-bound-and-total-magnetic-currents|Free, Bound, and Total Magnetic Currents]]
- [[linear-magnetic-constitutive-relations|Linear Magnetic Constitutive Relations]]

## Concept Dependencies

- part-of: [[free-bound-and-total-magnetic-currents|Free, Bound, and Total Magnetic Currents]]
