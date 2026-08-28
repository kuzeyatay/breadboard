---
title: "1.143 Transformer EMF and the Differential Form of Faraday's Law"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 293", "Page 294", "Page 295"]
related: ["faraday-induction-flux-linkage-and-lenzs-law", "motional-emf-and-moving-conductors", "maxwell-equations-and-supporting-constitutive-relations"]
---

# 1.143 Transformer EMF and the Differential Form of Faraday's Law

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 293, Page 294, Page 295

For a stationary closed path, motion does not contribute to the induced voltage, so only the explicit time dependence of magnetic flux density remains. Faraday's law becomes
$$
\oint\mathbf{E}\cdot d\mathbf{L}=-\int_S\frac{\partial\mathbf{B}}{\partial t}\cdot d\mathbf{S}
$$
 Applying Stokes' theorem to the closed line integral converts this integral relationship into the point equation
$$
\nabla\times\mathbf{E}=-\frac{\partial\mathbf{B}}{\partial t}
$$
 This is one of Maxwell's equations and states locally that a time-changing magnetic flux density produces a circulating electric field. If $\mathbf{B}$ has no time dependence, the equations reduce to the electrostatic results $\oint\mathbf{E}\cdot d\mathbf{L}=0$ and $\nabla\times\mathbf{E}=0$. The cylindrical example uses $\mathbf{B}=B_0e^{kt}\mathbf{a}_z$ within $\rho<b$. Symmetry makes $E_\phi$ constant around a circular path, and the flux law gives
$$
\mathbf{E}=-\frac{1}{2}kB_0e^{kt}\rho\mathbf{a}_\phi
$$
 The same result follows from evaluating the cylindrical-coordinate curl equation, demonstrating agreement between integral and differential methods.

## Page-Grounded Details

#### Page 293

We need to define emf as used in (1) or (2). The emf is obviously a scalar, and (perhaps not so obviously) a dimensional check shows that it is measured in volts. We define the emf as
$$
emf=\oint\mathbf{E}\cdot d\mathbf{L}\qquad(3)
$$
and note that it is the voltage about a specific closed path. If any part of the path is changed, generally the emf changes. The departure from static results is clearly shown by (3), for an electric field intensity resulting from a static charge distribution must lead to zero potential difference about a closed path. In electrostatics, the line integral leads to a potential difference; with time-varying fields, the result is an emf or a voltage.

Replacing $\Phi$ in (1) with the surface integral of $\mathbf{B}$, we have
$$
emf=\oint\mathbf{E}\cdot d\mathbf{L}=-\frac{d}{dt}\int_{S}\mathbf{B}\cdot d\mathbf{S}\qquad(4)
$$
where the fingers of our right hand indicate the direction of the closed path, and our thumb indicates the direction of $d\mathbf{S}$. A flux density $\mathbf{B}$ in the direction of $d\mathbf{S}$ and increasing with time thus produces an average value of $\mathbf{E}$ which is opposite to the positive direction about t

[Truncated for analysis]

#### Page 294

This is one of Maxwell's four equations as written in differential, or point, form, the form in which they are most generally used. Equation (5) is the integral form of this equation and is equivalent to Faraday's law as applied to a fixed path. If B is not a function of time, (5) and (6) evidently reduce to the electrostatic equations
$$
\oint \mathbf{E} \cdot d\mathbf{L} = 0 \quad\text{(electrostatics)}
$$
and
$$
\nabla \times \mathbf{E} = 0 \quad\text{(electrostatics)}
$$
#### 9.1.2 EMF Arising from a Time-Varying Magnetic Field

As an example of the interpretation of (5) and (6), assume the existence of a simple magnetic field which increases exponentially with time within the cylindrical region $\rho < b$,
$$
\mathbf{B} = B_0 e^{kt} \mathbf{a}_z \quad{(7)}
$$
where $B_0 = \text{constant}$. Choosing the circular path $\rho = a$, $a < b$, in the $z = 0$ plane, along which $E_\phi$ must be constant by symmetry, we then have from (5)
$$
\text{emf} = 2\pi a E_\phi = -kB_0 e^{kt} \pi a^2
$$
The emf around this closed path is $-kB_0 e^{kt} \pi a^2$. It is proportional to $a^2$ because the magnetic flux density is uniform and the flux passing through the surfac

[Truncated for analysis]

#### Page 295

Figure 9.1 An example illustrating the application of Faraday's law to the case of a constant magnetic flux density $\mathbf{B}$ and a moving path. The shorting bar moves to the right with a velocity $\mathbf{v}$, and the circuit is completed through the two rails and an extremely small high-resistance voltmeter. The voltmeter reading is $V_{12} = -Bvd$.

occasionally cause surprise, however. This particular field is discussed further in Problem 9.19 at the end of the chapter.

#### 9.1.3 Motional EMF

Now consider the case of a time-constant flux and a moving closed path. Before we derive any special results from Faraday's law (1), we use the basic law to analyze the specific problem outlined in Figure 9.1. The closed circuit consists of two parallel conductors which are connected at one end by a high-resistance voltmeter of negligible dimensions and at the other end by a sliding bar moving at a velocity $\mathbf{v}$. The magnetic flux density $\mathbf{B}$ is constant (in space and time) and is normal to the plane containing the closed path.

Let the position of the shorting bar be given by $y$; the flux passing through the surface within the closed path at any time $

[Truncated for analysis]

## Core Ideas

- A stationary path isolates the transformer-emf contribution.
- Transformer emf is $-\int_S(\partial\mathbf{B}/\partial t)\cdot d\mathbf{S}$.
- Stokes' theorem converts the integral law into $\nabla\times\mathbf{E}=-\partial\mathbf{B}/\partial t$.
- A changing magnetic field produces a circulating, generally nonconservative electric field.
- The static limit restores zero closed-path electric-field circulation.
- Cylindrical symmetry reduces the induced field to an azimuthal component.
- Integral and point-form calculations must give the same induced field.

## Source Anchors

- Equation (5) gives $\oint\mathbf{E}\cdot d\mathbf{L}=-\int_S(\partial\mathbf{B}/\partial t)\cdot d\mathbf{S}$ for a stationary path.
- Equation (6) gives $\nabla\times\mathbf{E}=-\partial\mathbf{B}/\partial t$.
- Page 294 states the electrostatic limits $\oint\mathbf{E}\cdot d\mathbf{L}=0$ and $\nabla\times\mathbf{E}=0$.
- Equation (7) specifies $\mathbf{B}=B_0e^{kt}\mathbf{a}_z$ for $\rho<b$.
- Equation (8) gives $\mathbf{E}=-(1/2)kB_0e^{kt}\rho\mathbf{a}_\phi$.
- The induced negative-$\mathbf{a}_\phi$ current would produce negative-$\mathbf{a}_z$ flux opposing the applied flux increase.

## Related Pages

- [[faraday-induction-flux-linkage-and-lenzs-law|Faraday Induction, Flux Linkage, and Lenz's Law]]
- [[motional-emf-and-moving-conductors|Motional EMF and Moving Conductors]]
- [[maxwell-equations-and-supporting-constitutive-relations|Maxwell Equations and Supporting Constitutive Relations]]

## Concept Dependencies

- part-of: [[maxwell-equations-and-supporting-constitutive-relations|Maxwell Equations and Supporting Constitutive Relations]]
