---
title: "1.234 Linear Polarization and Orthogonal Field Decomposition"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 408", "Page 409", "Page 409, Figure 11.4", "Page 410"]
related: ["lossless-dielectric-plane-wave-propagation", "time-average-power-density-of-sinusoidal-waves", "elliptical-polarization-from-phase-displaced-components", "circular-polarization-and-handedness"]
---

# 1.234 Linear Polarization and Orthogonal Field Decomposition

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 408, Page 409, Page 409, Figure 11.4, Page 410

Wave polarization is defined as the time-dependent orientation of the electric-field vector at a fixed point in space. For a uniform plane wave, $\mathbf{E}$, $\mathbf{H}$, and the propagation direction remain mutually orthogonal, but the transverse field orientation may depend on time, position, generation mechanism, or medium. A linearly polarized wave has an electric field confined to a fixed straight direction. For positive $z$ propagation, a general linearly polarized field can be written as $\mathbf{E}_s=(E_{x0}\mathbf{a}_x+E_{y0}\mathbf{a}_y)e^{-\alpha z}e^{-j\beta z}$. Its magnetic field is $\mathbf{H}_s=[-(E_{y0}/\eta)\mathbf{a}_x+(E_{x0}/\eta)\mathbf{a}_y]e^{-\alpha z}e^{-j\beta z}$. The minus sign ensures that each electric and magnetic component pair produces positive $z$ power flow. Figure 11.4 depicts this geometry. The average power density depends on $|E_{x0}|^2+|E_{y0}|^2$ and $\operatorname{Re}(1/\eta^*)$. This shows that a linearly polarized wave can be treated as two mutually perpendicular, in-phase plane waves. More generally, any polarization state can be constructed from perpendicular electric-field components and their relative phase.

## Page-Grounded Details

#### Page 408

The time-average power loss is easily obtained, since the average value of the cosine-squared factor is one-half,
$$
P_{L}=\frac{1}{4\sigma}J_{x0}^{2}bL\delta
$$
(89)

Comparing (88) and (89), we see that they are identical. Thus the average power loss in a conductor with skin effect present may be calculated by assuming that the total current is distributed uniformly in one skin depth. In terms of resistance, we may say that the resistance of a width b and length L of an infinitely thick slab with skin effect is the same as the resistance of a rectangular slab of width b, length L, and thickness $\delta$ without skin effect, or with uniform current distribution.

We may apply this to a conductor of circular cross section with little error, provided that the radius a is much greater than the skin depth. The resistance at a high frequency where there is a well-developed skin effect is therefore found by considering a slab of width equal to the circumference $2\pi a$ and thickness $\delta$. Hence
$$
R=\frac{L}{\sigma S}=\frac{L}{2\pi a\sigma\delta}
$$
(90)

A round copper wire of 1 mm radius and 1 km length has a resistance at direct current of
$$
R_{dc}=\frac{10^{3}}{\pi

[Truncated for analysis]

#### Page 409

what type of medium it is propagating through. Thus a complete description of an electro-magnetic wave would not only include parameters such as its wavelength, phase velocity, and power, but also a statement of the instantaneous orientation of its field vectors. We define the wave polarization as the time-dependent electric field vector orientation at a fixed point in space. A more complete characterization of a wave's polarization would in fact include specifying the field orientation at all points because some waves demonstrate spatial variations in their polarization. Specifying only the electric field direction is sufficient, since magnetic field is readily found from E using Maxwell's equations.

#### 11.5.1 Linear Polarization

In the waves we have previously studied, E was in a fixed straight orientation for all times and positions. Such a wave is said to be linearly polarized. We have taken E to lie along the x axis, but the field could be oriented in any fixed direction in the xy plane and be linearly polarized. For positive z propagation, the wave would in general have its electric field phasor expressed as
$$
 E_{s}=(E_{x0}a_{x}+E_{y0}a_{y})e^{-\alpha z}e^{-j\beta z}\qu

[Truncated for analysis]

#### Page 410

positive $y$ direction would require a component of $\mathbf{H}$ in the negative $x$ direction-thus the minus sign. Using (91) and (92), the power density in the wave is found using (77):
$$
\begin{align*}\langle\mathbf{S}_{z}\rangle&=\frac{1}{2}=\mathcal{R}e\{\mathbf{E}_{s}\times\mathbf{H}_{s}^{*}\}=\frac{1}{2}\mathcal{R}e\{E_{x0}H_{y0}^{*}(\mathbf{a}_{x}\times\mathbf{a}_{y})+E_{y0}H_{x0}^{*}(\mathbf{a}_{y}\times\mathbf{a}_{x})\}e^{-2\alpha z}\\ &=\frac{1}{2}\mathcal{R}e\left\{\frac{E_{x0}E_{x0}^{*}}{\eta^{*}}+\frac{E_{y0}E_{y0}^{*}}{\eta^{*}}\right\}e^{-2\alpha z}\mathbf{a}_{z}\\ &=\frac{1}{2}\mathcal{R}e\left\{\frac{1}{\eta^{*}}\right\}(|E_{x0}|^{2}+|E_{y0}|^{2})e^{-2\alpha z}\mathbf{a}_{z}~{}\text{W/m}^{2}\end{align*}
$$
This result demonstrates the idea that our linearly polarized plane wave can be considered as two distinct plane waves having $x$ and $y$ polarizations, whose electric fields are combining in phase to produce the total $\mathbf{E}$. The same is true for the magnetic field components. This is a critical point in understanding wave polarization, in that any polarization state can be described in terms of mutually perpendicular components of the elec

[Truncated for analysis]

## Core Ideas

- Polarization describes electric-field orientation at a fixed spatial point.
- A linearly polarized field maintains a fixed transverse direction.
- A general transverse electric field has both $x$ and $y$ components.
- The corresponding magnetic components are $H_x=-E_y/\eta$ and $H_y=E_x/\eta$.
- The signs ensure that $\mathbf{E}\times\mathbf{H}$ points along positive $z$.
- Average power depends on the sum $|E_{x0}|^2+|E_{y0}|^2$.
- Any polarization state can be represented using perpendicular components and their relative phase.

## Source Anchors

- Page 409 defines wave polarization as the time-dependent electric-field orientation at a fixed point.
- Equation (91) gives the general linearly polarized electric-field phasor.
- Equation (92) gives the associated magnetic-field phasor.
- Figure 11.4 shows the electric and magnetic configuration for positive $z$ propagation.
- Page 410 derives average power proportional to $(|E_{x0}|^2+|E_{y0}|^2)e^{-2\alpha z}$.
- The source identifies perpendicular components and their relative phasing as the basis for describing every polarization state.

## Related Pages

- [[lossless-dielectric-plane-wave-propagation|Lossless Dielectric Plane-Wave Propagation]]
- [[time-average-power-density-of-sinusoidal-waves|Time-Average Power Density of Sinusoidal Waves]]
- [[elliptical-polarization-from-phase-displaced-components|Elliptical Polarization from Phase-Displaced Components]]
- [[circular-polarization-and-handedness|Circular Polarization and Handedness]]

## Concept Dependencies

- depends-on: [[lossless-dielectric-plane-wave-propagation|Lossless Dielectric Plane-Wave Propagation]]
- applies-to: [[time-average-power-density-of-sinusoidal-waves|Time-Average Power Density of Sinusoidal Waves]]
- part-of: [[elliptical-polarization-from-phase-displaced-components|Elliptical Polarization from Phase-Displaced Components]]
