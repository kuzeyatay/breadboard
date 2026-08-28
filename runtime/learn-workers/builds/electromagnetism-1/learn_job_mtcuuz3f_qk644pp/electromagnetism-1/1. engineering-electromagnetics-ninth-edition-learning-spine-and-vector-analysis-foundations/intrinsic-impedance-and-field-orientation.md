---
title: "1.218 Intrinsic Impedance and Field Orientation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 387", "Page 388", "Page 389"]
related: ["uniform-plane-waves-from-sourceless-maxwell-equations", "phasor-representation-of-uniform-plane-waves", "traveling-wave-direction-and-sinusoidal-solutions"]
---

# 1.218 Intrinsic Impedance and Field Orientation

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 387, Page 388, Page 389

Maxwell's curl equation fixes both the magnitude ratio and orientation relationship between the electric and magnetic fields of a plane wave. Substituting the forward- and backward-wave electric-field solution into $\nabla\times\mathbf{E}_s=-j\omega\mu_0\mathbf{H}_s$ produces corresponding magnetic waves. For forward propagation, $E_{x0}=\eta_0H_{y0}$; for backward propagation, $E_{x0}'=-\eta_0H_{y0}'$. The intrinsic impedance is $\eta_0=\sqrt{\mu_0/\epsilon_0}=377\,\Omega$, analogous to the characteristic impedance of a transmission line because it is the ratio of electric to magnetic field amplitudes in a traveling wave. The backward-wave minus sign reverses the magnetic-field direction so that $\mathbf{E}\times\mathbf{H}$ points along the actual direction of propagation. For a forward $+z$ wave with positive $x$-directed electric field, the magnetic field is positive $y$ directed and the two fields are in phase. The ideal uniform plane wave has infinite transverse extent and therefore infinite total energy, but distant antenna fields can approximate it locally.

## Page-Grounded Details

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
$$
\na

[Truncated for analysis]

#### Page 388

In general, we find from (32) that the electric and magnetic field amplitudes of the forward-propagating wave in free space are related through
$$
 E_{x0}=\sqrt{\frac{\mu_{0}}{\epsilon_{0}}}H_{y0}=\eta_{0}H_{y0}\quad{(34a)}
$$
We also find the backward-propagating wave amplitudes are related through
$$
 E_{x0}^{'}=-\sqrt{\frac{\mu_{0}}{\epsilon_{0}}}H_{y0}^{'}=-\eta_{0}H_{y0}^{'}\quad{(34b)}
$$
where the intrinsic impedance of free space is defined as
$$
 \eta_{0}=\sqrt{\frac{\mu_{0}}{\epsilon_{0}}}=377\doteq 120\pi\Omega\quad{(35)} $$
The dimension of $\eta_{0}$ in ohms is immediately evident from its definition as the ratio of E (in units of V/m) to H (in units of A/m). It is in direct analogy to the characteristic impedance, $Z_{0}$, of a transmission line, where we defined the latter as the ratio of voltage to current in a traveling wave. We note that the difference between (34a) and (34b) is a minus sign. This is consistent with the transmission line analogy that led to Eqs. (25a) and (25b) in Chapter 10. Those equations accounted for the definitions of positive and negative current associated with forward and backward voltage waves. In a similar way, Eq. (34a) specifie

[Truncated for analysis]

#### Page 389

Figure 11.1 (a) Arrows represent the instantaneous values of $E_{x0}\cos[\omega(t-z/c)]$ at $t=0$ along the z axis, along an arbitrary line in the x = 0 plane parallel to the z axis, and along an arbitrary line in the y = 0 plane parallel to the z axis. (b) Corresponding values of $H_{y}$ are indicated. Note that $E_{x}$ and $H_{y}$ are in phase at any point in time.

Although we have considered only a wave varying sinusoidally in time and space, a suitable combination of solutions to the wave equation may be made to achieve a wave of any desired form, but which satisfies (14). The summation of an infinite number of harmonics through the use of a Fourier series can produce a periodic wave of square or triangular shape in both space and time. Nonperiodic waves may be obtained from our basic solution by Fourier integral methods. These topics are among those considered in the more advanced books on electromagnetic theory.

D11.1. The electric field amplitude of a uniform plane wave propagating in the $\mathbf{a}_{z}$ direction is 250 V/m. If $\mathbf{E}=E_{x}\mathbf{a}_{x}$ and $\omega=1.00$ Mrad/s, find: (a) the frequency; (b) the wavelength; (c) the period; (d) the a

[Truncated for analysis]

## Core Ideas

- The forward-wave amplitude relation is $E_{x0}=\eta_0H_{y0}$.
- The backward-wave relation is $E_{x0}'=-\eta_0H_{y0}'$.
- The free-space intrinsic impedance is $\eta_0=\sqrt{\mu_0/\epsilon_0}=377\,\Omega\approx120\pi\,\Omega$.
- Intrinsic impedance has ohmic units because it is the ratio of V/m to A/m.
- The sign change for a backward wave reverses the magnetic-field direction.
- The Poynting direction is set by $\mathbf{S}=\mathbf{E}\times\mathbf{H}$.
- For a forward free-space wave, $E_x$ and $H_y$ are in phase.
- A physical far field approximates a plane wave only over a limited region.

## Source Anchors

- Equation (32) gives $H_{ys}=E_{x0}\sqrt{\epsilon_0/\mu_0}e^{-jk_0z}-E_{x0}'\sqrt{\epsilon_0/\mu_0}e^{jk_0z}$.
- Equations (34a) and (34b) give the forward and backward electric-to-magnetic amplitude relations.
- Equation (35) defines $\eta_0=377\,\Omega\approx120\pi\,\Omega$.
- The source states that $\mathbf{S}=\mathbf{E}\times\mathbf{H}$ has units of watts per square meter and points in the propagation direction.
- Figure 11.1 should be retained as S1.P389.F1; it shows the spatially uniform transverse distributions and confirms that $E_x$ and $H_y$ are in phase.
- Diagnostic D11.1 uses $E=250$ V/m and gives magnetic-field amplitude $0.663$ A/m, consistent with division by $377\,\Omega$.
- Diagnostic D11.2 provides a vector magnetic-field phasor and asks for frequency and instantaneous field values.

## Related Pages

- [[uniform-plane-waves-from-sourceless-maxwell-equations|Uniform Plane Waves from Sourceless Maxwell Equations]]
- [[phasor-representation-of-uniform-plane-waves|Phasor Representation of Uniform Plane Waves]]
- [[traveling-wave-direction-and-sinusoidal-solutions|Traveling-Wave Direction and Sinusoidal Solutions]]

## Concept Dependencies

- derives-from: [[uniform-plane-waves-from-sourceless-maxwell-equations|Uniform Plane Waves from Sourceless Maxwell Equations]]
- depends-on: [[phasor-representation-of-uniform-plane-waves|Phasor Representation of Uniform Plane Waves]]
- applies-to: [[traveling-wave-direction-and-sinusoidal-solutions|Traveling-Wave Direction and Sinusoidal Solutions]]
