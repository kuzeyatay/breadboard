---
title: "1.217 Vector Helmholtz Equation in Free Space"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 386", "Page 387"]
related: ["free-space-electromagnetic-wave-equation", "phasor-representation-of-uniform-plane-waves", "intrinsic-impedance-and-field-orientation", "lossy-dielectric-propagation-and-complex-wavenumber", "uniform-plane-waves-from-sourceless-maxwell-equations"]
---

# 1.217 Vector Helmholtz Equation in Free Space

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 386, Page 387

Sinusoidal Maxwell equations can be written entirely in phasor form because each time derivative becomes multiplication by $j\omega$. In sourceless free space the curl equations become $\nabla\times\mathbf{H}_s=j\omega\epsilon_0\mathbf{E}_s$ and $\nabla\times\mathbf{E}_s=-j\omega\mu_0\mathbf{H}_s$, while both field divergences vanish. Taking the curl of the electric-field equation and applying the vector identity for $\nabla\times\nabla\times\mathbf{E}_s$ eliminates the magnetic field. Since $\nabla\cdot\mathbf{E}_s=0$, the gradient-of-divergence term vanishes, producing the vector Helmholtz equation $\nabla^2\mathbf{E}_s=-k_0^2\mathbf{E}_s$. Each vector component satisfies a scalar second-order partial differential equation. For a uniform plane wave with no $x$ or $y$ variation, the equation reduces to an ordinary differential equation in $z$. Its two exponential solutions represent forward and backward propagation. This formulation is the frequency-domain counterpart of the time-domain wave equation.

## Page-Grounded Details

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
{\frac{dH_{ys}(z)}{dz}}=-j\omega\epsilon_{0}E_{xs}(z)\quad{(22)}
$$
 In obtaining this equation, we note first that the complex conjugate terms in(21)produce their own separate equation, redundant with(22); second, the $e^{j\omega t}$ factors,common to both sides, have divided out; third, the partial derivative with z becomes the total derivative, since the phasor, $H_{ys}$ , depends only on z.

We next apply this result to Maxwell's equations, to obtain them in phasor form.Substituting the field as expressed in(21) into Eqs

[Truncated for analysis]

#### Page 387

where again, $k_0 = \omega / c = \omega \sqrt{\mu_0 \epsilon_0}$. Equation (28) is known as the vector Helmholtz equation in free space.^1 It is fairly formidable when expanded, even in rectangular coordinates, for three scalar phasor equations result (one for each vector component), and each equation has four terms. The $x$ component of (28) becomes, still using the del-operator notation,
$$
\nabla^2 E_{xs} = -k_0^2 E_{xs} (29)
$$
and the expansion of the operator leads to the second-order partial differential equation
$$
\frac{\partial^2 E_{xs}}{\partial x^2} + \frac{\partial^2 E_{xs}}{\partial y^2} + \frac{\partial^2 E_{xs}}{\partial z^2} = -k_0^2 E_{xs}
$$
Again, assuming a uniform plane wave in which $E_{xs}$ does not vary with $x$ or $y$, the two corresponding derivatives are zero, and we obtain
$$
\frac{d^2 E_{xs}}{dz^2} = -k_0^2 E_{xs} (30)
$$
the solution of which we already know:
$$
E_{xs}(z) = E_{x0} e^{-jk_0 z} + E_{x0}^{\prime} e^{jk_0 z} (31)
$$
#### 11.1.4 Relation Between E and H: Intrinsic Impedance

We now return to Maxwell's equations, (23) through (26), and determine the form of the $H$ field. Given $E_s$, $H_s$ is most easily obtained from (24):
$$ \na

[Truncated for analysis]

## Core Ideas

- Time-harmonic Maxwell equations replace $\partial/\partial t$ with $j\omega$.
- The sourceless phasor fields satisfy zero-divergence conditions.
- The curl-of-curl identity introduces the vector Laplacian.
- The vector Helmholtz equation is $\nabla^2\mathbf{E}_s=-k_0^2\mathbf{E}_s$.
- Each Cartesian component obeys its own scalar Helmholtz equation.
- Uniformity in the transverse plane removes the $x$ and $y$ derivatives.
- The one-dimensional solutions are $e^{-jk_0z}$ and $e^{jk_0z}$.

## Source Anchors

- Equations (23) and (24) are $\nabla\times\mathbf{H}_s=j\omega\epsilon_0\mathbf{E}_s$ and $\nabla\times\mathbf{E}_s=-j\omega\mu_0\mathbf{H}_s$.
- Equations (25) and (26) state $\nabla\cdot\mathbf{E}_s=0$ and $\nabla\cdot\mathbf{H}_s=0$.
- Equation (27) applies $\nabla\times\nabla\times\mathbf{E}_s=\nabla(\nabla\cdot\mathbf{E}_s)-\nabla^2\mathbf{E}_s$.
- Equation (28) is $\nabla^2\mathbf{E}_s=-k_0^2\mathbf{E}_s$.
- Equation (30) reduces the uniform-wave problem to $d^2E_{xs}/dz^2=-k_0^2E_{xs}$.
- Equation (31) gives $E_{xs}=E_{x0}e^{-jk_0z}+E_{x0}'e^{jk_0z}$.

## Related Pages

- [[free-space-electromagnetic-wave-equation|Free-Space Electromagnetic Wave Equation]]
- [[phasor-representation-of-uniform-plane-waves|Phasor Representation of Uniform Plane Waves]]
- [[intrinsic-impedance-and-field-orientation|Intrinsic Impedance and Field Orientation]]
- [[lossy-dielectric-propagation-and-complex-wavenumber|Lossy Dielectric Propagation and Complex Wavenumber]]
- [[uniform-plane-waves-from-sourceless-maxwell-equations|Uniform Plane Waves from Sourceless Maxwell Equations]]

## Concept Dependencies

- depends-on: [[phasor-representation-of-uniform-plane-waves|Phasor Representation of Uniform Plane Waves]]
- derives-from: [[uniform-plane-waves-from-sourceless-maxwell-equations|Uniform Plane Waves from Sourceless Maxwell Equations]]
- enables: [[lossy-dielectric-propagation-and-complex-wavenumber|Lossy Dielectric Propagation and Complex Wavenumber]]
