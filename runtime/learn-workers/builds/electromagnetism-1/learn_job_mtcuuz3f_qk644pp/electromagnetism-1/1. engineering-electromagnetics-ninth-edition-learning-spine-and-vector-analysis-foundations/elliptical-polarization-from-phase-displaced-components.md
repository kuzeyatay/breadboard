---
title: "1.235 Elliptical Polarization from Phase-Displaced Components"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 410", "Page 411, Figure 11.5"]
related: ["linear-polarization-and-orthogonal-field-decomposition", "circular-polarization-and-handedness"]
---

# 1.235 Elliptical Polarization from Phase-Displaced Components

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 410, Page 411, Figure 11.5

Elliptical polarization arises when perpendicular electric-field components have a nonzero relative phase and arbitrary amplitudes. In a lossless medium, the phasor field is $\mathbf{E}_s=(E_{x0}\mathbf{a}_x+E_{y0}e^{j\phi}\mathbf{a}_y)e^{-j\beta z}$. Its instantaneous form is $\mathbf{E}(z,t)=E_{x0}\cos(\omega t-\beta z)\mathbf{a}_x+E_{y0}\cos(\omega t-\beta z+\phi)\mathbf{a}_y$. At fixed time, a positive phase $\phi$ displaces the $y$-component crest by $\phi/\beta$ farther along $z$, so $E_y$ lags $E_x$ spatially. At a fixed location, the traveling $y$ crest arrives first, so $E_y$ leads $E_x$ in time. Figure 11.5 plots these component magnitudes and makes the distinction between spatial lag and temporal lead explicit. As time advances at a fixed point, the net electric vector rotates while changing magnitude, and its tip traces an ellipse over one period. The same orientation and magnitude recur after one wavelength in space or one period $2\pi/\omega$ in time. Elliptical polarization is the general case, while linear polarization is its zero-phase-difference special case.

## Page-Grounded Details

#### Page 410

positive $y$ direction would require a component of $\mathbf{H}$ in the negative $x$ direction-thus the minus sign. Using (91) and (92), the power density in the wave is found using (77):
$$
\begin{align*}\langle\mathbf{S}_{z}\rangle&=\frac{1}{2}=\mathcal{R}e\{\mathbf{E}_{s}\times\mathbf{H}_{s}^{*}\}=\frac{1}{2}\mathcal{R}e\{E_{x0}H_{y0}^{*}(\mathbf{a}_{x}\times\mathbf{a}_{y})+E_{y0}H_{x0}^{*}(\mathbf{a}_{y}\times\mathbf{a}_{x})\}e^{-2\alpha z}\\ &=\frac{1}{2}\mathcal{R}e\left\{\frac{E_{x0}E_{x0}^{*}}{\eta^{*}}+\frac{E_{y0}E_{y0}^{*}}{\eta^{*}}\right\}e^{-2\alpha z}\mathbf{a}_{z}\\ &=\frac{1}{2}\mathcal{R}e\left\{\frac{1}{\eta^{*}}\right\}(|E_{x0}|^{2}+|E_{y0}|^{2})e^{-2\alpha z}\mathbf{a}_{z}~{}\text{W/m}^{2}\end{align*}
$$
This result demonstrates the idea that our linearly polarized plane wave can be considered as two distinct plane waves having $x$ and $y$ polarizations, whose electric fields are combining in phase to produce the total $\mathbf{E}$. The same is true for the magnetic field components. This is a critical point in understanding wave polarization, in that any polarization state can be described in terms of mutually perpendicular components of the elec

[Truncated for analysis]

#### Page 411

Figure 11.5 Plots of the electric field component magnitudes in Eq. (95) as functions of z. Note that the y component lags behind the x component in z. As time increases from zero, both waves travel to the right, as per Eq. (94). Thus, to an observer at a fixed location, the y component leads in time.

its magnitude changes. Considering a starting point in z and t, at which the field has a given orientation and magnitude, the wave will return to the same orientation and magnitude at a distance of one wavelength in z (for fixed t) or at a time $t=2\pi/\omega$ later (at a fixed z).

For illustration purposes, if we take the length of the field vector as a measure of its magnitude, we find that at a fixed position, the tip of the vector traces out the shape of an ellipse over time $t=2\pi/\omega$. The wave is said to be elliptically polarized. Elliptical polarization is in fact the most general polarization state of a wave, since it encompasses any magnitude and phase difference between $E_{x}$ and $E_{y}$. Linear polarization is a special case of elliptical polarization in which the phase difference is zero.

#### 11.5.3 Circular Polarization

Another special case of elliptic

[Truncated for analysis]

## Core Ideas

- Elliptical polarization permits arbitrary perpendicular-component amplitudes and phase difference.
- The relative phase is represented by the factor $e^{j\phi}$.
- At fixed time, positive $\phi$ makes $E_y$ lag $E_x$ in space.
- The spatial crest separation is $\phi/\beta$.
- At a fixed position, the same $E_y$ component leads $E_x$ in time.
- The electric-vector tip traces an ellipse over one period.
- The field repeats after one wavelength in space or one period in time.
- Linear polarization is the special case $\phi=0$.

## Source Anchors

- Equation (93) gives the phase-displaced electric-field phasor.
- Equation (94) gives the instantaneous field components.
- Equation (95) freezes the field at $t=0$ for spatial interpretation.
- Figure 11.5 shows the $y$ component lagging the $x$ component in $z$ while leading it in time at a fixed point.
- The source identifies the crest separation as $\phi/\beta$.
- Page 411 states that the vector tip traces an ellipse and that elliptical polarization is the most general polarization state.

## Related Pages

- [[linear-polarization-and-orthogonal-field-decomposition|Linear Polarization and Orthogonal Field Decomposition]]
- [[circular-polarization-and-handedness|Circular Polarization and Handedness]]

## Concept Dependencies

- derives-from: [[linear-polarization-and-orthogonal-field-decomposition|Linear Polarization and Orthogonal Field Decomposition]]
- related: [[circular-polarization-and-handedness|Circular Polarization and Handedness]]
