---
title: "1.228 Time-Average Power Density of Sinusoidal Waves"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 400", "Page 401"]
related: ["poynting-vector-and-electromagnetic-energy-conservation", "microwave-absorption-and-penetration-in-water", "good-conductor-intrinsic-impedance-and-power-density", "linear-polarization-and-orthogonal-field-decomposition", "lossless-dielectric-plane-wave-propagation"]
---

# 1.228 Time-Average Power Density of Sinusoidal Waves

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 400, Page 401

For a plane wave propagating in the positive $z$ direction, an $x$-directed electric field and $y$-directed magnetic field produce $\mathbf{E}\times\mathbf{H}$ in the positive $z$ direction. In a perfect dielectric, the fields are in phase, so the instantaneous power density is $S_z=(E_{x0}^2/\eta)\cos^2(\omega t-\beta z)$. In a lossy dielectric, both fields decay as $e^{-\alpha z}$ and differ in phase because $\eta=|\eta|\angle\theta_\eta$. Their product contains both a time-varying second-harmonic term and a constant term. Averaging over one period eliminates the second-harmonic contribution and gives $\langle S_z\rangle=(1/2)(E_{x0}^2/|\eta|)e^{-2\alpha z}\cos\theta_\eta$. Power density therefore decays twice as rapidly in the exponent as either field amplitude. The same result follows compactly from phasors through $\langle\mathbf{S}\rangle=(1/2)\operatorname{Re}(\mathbf{E}_s\times\mathbf{H}_s^*)$. This expression applies to any sinusoidal electromagnetic wave and provides both the magnitude and direction of its time-average power density.

## Page-Grounded Details

#### Page 400

instantaneous power flow at a point, and many of us think of the Poynting vector as a "pointing" vector. This homonym, while accidental, is correct.$^{4}$

Because S is given by the cross product of E and H, the direction of power flow at any point is normal to both the E and H vectors. This certainly agrees with our experience with the uniform plane wave, for propagation in the +z direction was associated with an $E_{x}$ and $H_{y}$ component,
$$
E_{x} a_{x} \times H_{y} a_{y}=S_{z} a_{z}
$$
In a perfect dielectric, the E and H field amplitudes are given by
$$
\begin{align*}E_{x}&=E_{x0} \cos(\omega t-\beta z)\\H_{y}&=\frac{E_{x0}}{\eta} \cos(\omega t-\beta z)\end{align*}
$$
where $\eta$ is real. The power density amplitude is therefore
$$
S_{z}=\frac{E_{x0}^{2}}{\eta} \cos^{2}(\omega t-\beta z)
$$
In the case of a lossy dielectric, $E_{x}$ and $H_{y}$ are not in time phase. We have
$$
E_{x}=E_{x0} e^{-\alpha z} \cos(\omega t-\beta z)
$$
If we let
$$
\eta=|\eta| \angle\theta_{\eta}
$$
then we may write the magnetic field intensity as
$$
H_{y}=\frac{E_{x0}}{|\eta|} e^{-\alpha z} \cos(\omega t-\beta z-\theta_{\eta})
$$
Thus,
$$
S_{z}=E_{x} H_{y}=\frac{E_{x0}^

[Truncated for analysis]

#### Page 401

The second-harmonic component of the integrand in (75) integrates to zero, leaving only the contribution from the dc component. The result is
$$
 \langle S_{z}\rangle=\frac{1}{2}\frac{E_{x0}^{2}}{|\eta|}e^{-2\alpha z}\cos\theta_{\eta}\quad{(76)}
$$
Note that the power density attenuates as $e^{-2\alpha z}$, whereas $E_{x}$ and $H_{y}$ fall off as $e^{-\alpha z}$.

We may finally observe that the preceding expression can be obtained very easily by using the phasor forms of the electric and magnetic fields. In vector form, this is
$$
 \langle S\rangle=\frac{1}{2}\mathcal{R}e(\mathbf{E}_{s}\times\mathbf{H}_{s}^{*})\quad\mathrm{W/m}^{2}\quad{(77)}
$$
In the present case
$$
 \mathbf{E}_{s}=E_{x0}\,e^{-j\beta z}\mathbf{a}_{x}
$$
and
$$
 \mathbf{H}_{s}^{*}=\frac{E_{x0}}{\eta^{*}}\,e^{+j\beta z}\mathbf{a}_{y}=\frac{E_{x0}}{|\eta|}e^{j\theta}e^{+j\beta z}\mathbf{a}_{y} $$
where $E_{x0}$ has been assumed real. Eq. (77) applies to any sinusoidal electromagnetic wave and gives both the magnitude and direction of the time-average power density.

D11.6. At frequencies of 1, 100, and 3000 MHz, the dielectric constant of ice made from pure water has values of 4.15, 3.45, and 3.20, re

[Truncated for analysis]

## Core Ideas

- Instantaneous power density is the Poynting vector $\mathbf{E}\times\mathbf{H}$.
- In a lossless dielectric, $S_z=(E_{x0}^2/\eta)\cos^2(\omega t-\beta z)$.
- A complex intrinsic impedance introduces an electric-to-magnetic phase difference.
- Averaging over one period removes the second-harmonic term.
- The lossy-wave average is $\langle S_z\rangle=(E_{x0}^2/(2|\eta|))e^{-2\alpha z}\cos\theta_\eta$.
- Field amplitudes decay as $e^{-\alpha z}$, while power density decays as $e^{-2\alpha z}$.
- The general phasor formula is $\langle\mathbf{S}\rangle=(1/2)\operatorname{Re}(\mathbf{E}_s\times\mathbf{H}_s^*)$.

## Source Anchors

- Page 400 demonstrates $E_x\mathbf{a}_x\times H_y\mathbf{a}_y=S_z\mathbf{a}_z$.
- The lossy fields are written with amplitude factor $e^{-\alpha z}$ and impedance angle $\theta_\eta$.
- The product-to-sum identity is used to average the instantaneous power over one cycle.
- Equation (76) gives $\langle S_z\rangle=(1/2)(E_{x0}^2/|\eta|)e^{-2\alpha z}\cos\theta_\eta$.
- Equation (77) gives the general phasor expression for time-average power density.
- Exercise D11.6 asks for average power in ice at three frequencies and two propagation depths.

## Related Pages

- [[poynting-vector-and-electromagnetic-energy-conservation|Poynting Vector and Electromagnetic Energy Conservation]]
- [[microwave-absorption-and-penetration-in-water|Microwave Absorption and Penetration in Water]]
- [[good-conductor-intrinsic-impedance-and-power-density|Good-Conductor Intrinsic Impedance and Power Density]]
- [[linear-polarization-and-orthogonal-field-decomposition|Linear Polarization and Orthogonal Field Decomposition]]
- [[lossless-dielectric-plane-wave-propagation|Lossless Dielectric Plane-Wave Propagation]]

## Concept Dependencies

- applies-to: [[lossless-dielectric-plane-wave-propagation|Lossless Dielectric Plane-Wave Propagation]]
- applies-to: [[microwave-absorption-and-penetration-in-water|Microwave Absorption and Penetration in Water]]
