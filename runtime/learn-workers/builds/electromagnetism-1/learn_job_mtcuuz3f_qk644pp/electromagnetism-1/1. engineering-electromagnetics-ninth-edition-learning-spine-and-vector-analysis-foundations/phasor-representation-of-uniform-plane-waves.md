---
title: "1.216 Phasor Representation of Uniform Plane Waves"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 385", "Page 386"]
related: ["traveling-wave-direction-and-sinusoidal-solutions", "vector-helmholtz-equation-in-free-space", "intrinsic-impedance-and-field-orientation"]
---

# 1.216 Phasor Representation of Uniform Plane Waves

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 385, Page 386

Phasors suppress the common sinusoidal time factor while retaining spatial phase and complex amplitude. A forward field with real instantaneous form $\mathcal{E}_x(z,t)=\Re[E_{xs}(z)e^{j\omega t}]$ has phasor $E_{xs}=E_{x0}e^{-jk_0z}$, where the complex amplitude $E_{x0}$ includes the initial phase. Recovering the time-domain field requires multiplying the phasor by $e^{j\omega t}$ and taking the real part. Example 11.1 applies this directly to a scalar $y$-directed field, preserving the spatial factor and phase while removing the explicit time dependence. Example 11.2 demonstrates the vector case: each Cartesian component can have a different complex amplitude and phase, but all components share the propagation factor for a wave traveling in one direction. The example computes $k_0$ from the frequency and converts the vector phasor into two real cosine components. This procedure is reusable for moving between measured fields, complex amplitudes, and frequency-domain Maxwell equations.

## Page-Grounded Details

#### Page 385

$(\omega t+k_{0}z)$ describes a wave that moves in the negative $z$ direction, since as time in-creases, $z$ must now decrease to keep the argument constant. For simplicity, we will restrict our attention in this chapter to only the positive $z$ traveling wave.

As was done for transmission line waves, we express the real instantaneous fields of Eq. (15) in terms of their phasor forms. Using the forward-propagating field in (15), we write:
$$
\mathcal{E}_{x}(z,t)=\frac{1}{2}\underbrace{\left[E_{x0}\right]}_{E_{x0}}e^{j\phi_{1}}e^{-jk_{0}z}e^{j\omega t}+c.c.=\frac{1}{2}E_{xs}e^{j\omega t}+c.c.=\mathcal{R}e[E_{xs}e^{j\omega t}]\quad{(19)}
$$
where $c.c$ denotes the complex conjugate, and where we identify the phasor electric field as $E_{xs}=E_{x0}e^{-jk_{0}z}$. As indicated in (19), $E_{x0}$ is the complex amplitude (which includes the phase, $\phi_{1}$).

#### Example 11.1

Let us express $\mathcal{E}_{y}(z,t)=100\cos(10^{8}t-0.5z+30^{\circ})$ V/m as a phasor.

Solution. We first go to exponential notation,
$$
\mathcal{E}_{y}(z,t)=\mathcal{R}e[100e^{j(10^{8}t-0.5z+30^{\circ})}]
$$
and then drop Re and suppress $e^{j10^{8}t}$, obtaining the phasor
$$
E_{ys}

[Truncated for analysis]

#### Page 386

#### 11.1.3 Vector Helmholtz Equation in Free Space

It is evident that taking the partial derivative of any field quantity with respect to time is equivalent to multiplying the corresponding phasor by $j\omega$. As an example, we can express Eq. (8) (using sinusoidal fields) as
$$
\frac{\partial\mathscr{H}_{y}}{\partial z}=-\epsilon_{0}\frac{\partial\mathscr{E}_{x}}{\partial t}\quad{(20)}
$$
where, in a manner consistent with(19):
$$
\mathscr{E}_{x}(z,t)=\frac{1}{2}E_{xs}(z)e^{j\omega t}+c.c.\qquad and\qquad\mathscr{H}_{y}(z,t)=\frac{1}{2}H_{ys}(z)e^{j\omega t}+c.c.\quad{(21)}
$$
On substituting the fields in(21) into(20), the latter equation simplifies to
$$
{\frac{dH_{ys}(z)}{dz}}=-j\omega\epsilon_{0}E_{xs}(z)\quad{(22)}$$
 In obtaining this equation, we note first that the complex conjugate terms in(21)produce their own separate equation, redundant with(22); second, the $e^{j\omega t}$ factors,common to both sides, have divided out; third, the partial derivative with z becomes the total derivative, since the phasor, $H_{ys}$ , depends only on z.

We next apply this result to Maxwell's equations, to obtain them in phasor form.Substituting the field as expressed in(21) into Eqs

[Truncated for analysis]

## Core Ideas

- A real sinusoidal field is recovered as $\Re[\mathbf{E}_s e^{j\omega t}]$.
- For forward free-space propagation, the spatial phasor factor is $e^{-jk_0z}$.
- The complex amplitude stores both magnitude and initial phase.
- Converting to a phasor removes $\Re$ and suppresses the common factor $e^{j\omega t}$.
- Vector components may have different amplitudes and phases while sharing one propagation factor.
- Mixed angular notation may use radians for spatial phase and degrees for a fixed phase offset.
- Time differentiation of a sinusoidal field corresponds to multiplication of its phasor by $j\omega$.

## Source Anchors

- Equation (19) identifies $E_{xs}=E_{x0}e^{-jk_0z}$ and $\mathcal{E}_x=\Re[E_{xs}e^{j\omega t}]$.
- Example 11.1 converts $\mathcal{E}_y=100\cos(10^8t-0.5z+30^\circ)$ V/m to $E_{ys}=100e^{-j0.5z+j30^\circ}$.
- Example 11.2 starts from $\mathbf{E}_0=100\mathbf{a}_x+20\angle30^\circ\mathbf{a}_y$ V/m at 10 MHz.
- Example 11.2 calculates $k_0=0.21$ rad/m.
- The resulting field is $100\cos(2\pi\times10^7t-0.21z)\mathbf{a}_x+20\cos(2\pi\times10^7t-0.21z+30^\circ)\mathbf{a}_y$ V/m.
- Equation (22) demonstrates that time differentiation becomes multiplication by $j\omega$ in phasor form.

## Related Pages

- [[traveling-wave-direction-and-sinusoidal-solutions|Traveling-Wave Direction and Sinusoidal Solutions]]
- [[vector-helmholtz-equation-in-free-space|Vector Helmholtz Equation in Free Space]]
- [[intrinsic-impedance-and-field-orientation|Intrinsic Impedance and Field Orientation]]

## Concept Dependencies

- derives-from: [[traveling-wave-direction-and-sinusoidal-solutions|Traveling-Wave Direction and Sinusoidal Solutions]]
- enables: [[vector-helmholtz-equation-in-free-space|Vector Helmholtz Equation in Free Space]]
- enables: [[intrinsic-impedance-and-field-orientation|Intrinsic Impedance and Field Orientation]]
