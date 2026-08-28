---
title: "1.242 Plane-Wave Field and Power Analysis Procedures"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 415, Problems 11.1 through 11.3", "Page 416, Problems 11.4 through 11.9", "Page 417, Problems 11.10 through 11.16", "Page 418, Problems 11.17 through 11.24", "Page 419, Problems 11.25 through 11.29", "Page 420, Problem 11.33"]
related: ["loss-penetration-depth-and-conductor-power-dissipation", "circularly-polarized-wave-phasors", "incident-reflected-and-transmitted-plane-waves", "power-reflectivity-and-conservation"]
---

# 1.242 Plane-Wave Field and Power Analysis Procedures

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 415, Problems 11.1 through 11.3, Page 416, Problems 11.4 through 11.9, Page 417, Problems 11.10 through 11.16, Page 418, Problems 11.17 through 11.24, Page 419, Problems 11.25 through 11.29, Page 420, Problem 11.33

The Chapter 11 problem set consolidates a reusable workflow for uniform plane-wave analysis. Given frequency and medium parameters, the solver determines phase velocity, propagation constant, wavelength, intrinsic impedance, electric and magnetic phasors, and time-average Poynting vector. Propagation direction and electric-field orientation determine the magnetic-field direction through the right-handed relation among $\mathbf{E}$, $\mathbf{H}$, and the direction of power flow. In a lossy medium, attenuation $e^{-\alpha z}$ and phase variation $e^{-j\beta z}$ must both be retained, and a complex intrinsic impedance creates a phase difference between electric and magnetic fields. The tasks also apply power density to finite receiving areas, spherical surfaces, coaxial cross sections, and focused beams. Other problems reverse the process by using measured $k$ and $\eta$ to infer $\mu$, $\epsilon'$, and $\epsilon''$, or use Maxwell's equations to verify nonuniform and cylindrical field forms.

## Page-Grounded Details

#### Page 415

From Euler's identity, we find that $e^{j\delta/2}+e^{-j\delta/2}=2\cos\delta/2$, and $e^{j\delta/2}-e^{-j\delta/2}=2j\sin\delta/2$. Using these relations, we obtain
$$
E_{sT}=2E_{0}[\cos(\delta/2)a_{x}+\sin(\delta/2)a_{y}]e^{-j(\beta z-\delta/2)}\quad{(102)}
$$
We recognize (102) as the electric field of a linearly polarized wave, whose field vector is oriented at angle $\delta/2$ from the $x$ axis.

Example 11.7 shows that any linearly polarized wave can be expressed as the sum of two circularly polarized waves of opposite handedness, where the linear polarization direction is determined by the relative phase difference between the two waves. Such a representation is convenient (and necessary) when considering, for example, the propagation of linearly polarized light through media which contain organic molecules. These often exhibit spiral structures having left- or right-handed pitch, and they will thus interact differently with left- or right-hand circular polarization. As a result, the left circular component can propagate at a different speed than the right circular component, and so the two waves will accumulate a phase difference as they propagate. As a result, th

[Truncated for analysis]

#### Page 416

11.4

Small antennas have low efficiencies (as will be seen in Chapter 14), and the efficiency increases with size up to the point at which a critical dimension of the antenna is an appreciable fraction of a wavelength, say $\lambda/8$. (a) An antenna that is 12 cm long is operated in air at 1 MHz. What fraction of a wavelength long is it? (b) The same antenna is embedded in a ferrite material for which $\epsilon_{r}=20$ and $\mu_{r}=2000$. What fraction of a wavelength is it now?

11.5

Consider two x-polarized waves that counter-propagate along the z axis. The wave traveling in the forward z direction is of frequency $\omega_{2}$; the backward z propagating wave is at frequency $\omega_{1}$, where $\omega_{1}<\omega_{2}$. Both frequencies are very slightly detuned on either side of their mean frequency, $\omega_{0}$, such that $\omega_{0}-\omega_{1}=\omega_{2}-\omega_{0}<<\omega_{0}$. Using the complex field forms, construct the expression for the total electric field, and from this, find the power density distribution (proportional to $EE^{*}$). Your answer should be in the form of a "standing wave" that in fact moves slowly along the z axis. Find an expression

[Truncated for analysis]

#### Page 417

two components). (b) Find $\alpha$ as a function of $\beta$, $\omega$, $\epsilon_{0}$, and $\mu_{0}$, such that all of Maxwell's equations are satisfied by the electric and magnetic fields.

11.10 In a medium characterized by intrinsic impedance $\eta=\left|\eta\right|e^{j\phi}$, a linearly polarized plane wave propagates, with magnetic field given as $H_{s}=(H_{0y}a_{y}+H_{0z}a_{z})e^{-\alpha x}e^{-j\beta x}$. Find (a) $E_{s}$; (b) $\mathcal{E}(x,t)$; (c) $\mathcal{H}(x,t)$; (d) $\langle S\rangle$.

11.11 A uniform plane wave at frequency $f=100$ MHz propagates in a material having conductivity $\sigma=3.0$ S/m and dielectric constant $\epsilon_{r}^{\prime}=8.00$. The wave carries electric field amplitude $E_{0}=100$ V/m. (a) Calculate the loss tangent and determine whether the medium would qualify as a good dielectric or a good conductor. (b) Calculate $\alpha$, $\beta$, and $\eta$. (c) Write the electric field in phasor form, assuming $x$ polarization and forward $z$ travel. (d) Write the magnetic field in phasor form. (e) Write the time-average Poynting vector, $\mathbf{S}$. (f) Find the 6-dB material thickness at which the wave power d

[Truncated for analysis]

#### Page 418

intensity, E, in terms of $V_{0}$ and L. (b) Using Ampere's circuital law, find H inside the wire. (c) Find the Poynting vector, S. (d) Evaluate the left side of Poynting's theorem by integrating the S over the wire surface. (e) Evaluate the right side of Poynting's theorem (specialized for this non-time-varying case) and thus verify that the theorem is satisfied for this situation.

11.18 Given a 100-MHz uniform plane wave in a medium known to be a good dielectric, the phasor electric field is $\mathscr{E}_{s}=4e^{-0.5z}e^{-j20z}a_{x}$ V/m. Determine (a) $\epsilon^{\prime}$ ; (b) $\epsilon^{\prime\prime}$ ; (c) $\eta$ ; (d) $H_{s}$ ; (e) $\langle S\rangle$ ; (f) the power in watts that is incident on a rectangular surface measuring $20m\times30m$ at $z=10m$.

11.19 Perfectly conducting cylinders with radii of 8 mm and 20 mm are coaxial. The region between the cylinders is filled with a perfect dielectric for which $\epsilon=10^{-9}/4\pi F/m$ and $\mu_{r}=1$. If $\epsilon$ in this region is $(500/\rho)\cos(\omega t-4z)a_{p}$ V/m, find (a) $\omega$, with the help of Maxwell's equations in cylindrical coordinates; (b) $H(\rho,z,t)$ ; (c) $ \langle S(\rho

[Truncated for analysis]

## Core Ideas

- Compute $v_p$, $\beta$, and $\lambda$ from frequency and material properties.
- Use propagation direction and polarization to construct $\mathbf{E}_s$ and $\mathbf{H}_s$.
- Retain both attenuation and phase factors in lossy media.
- Use $\langle\mathbf{S}\rangle=(1/2)\operatorname{Re}\{\mathbf{E}_s\times\mathbf{H}_s^*\}$ for average power density.
- Integrate or multiply power density over the specified receiving surface when appropriate.
- Use Maxwell's equations to test whether proposed field distributions are self-consistent.
- Infer material parameters from propagation constant and intrinsic impedance when those wave quantities are given.

## Source Anchors

- Problem 11.2 asks for $v_p$, $\beta$, $\lambda$, $\mathbf{E}_s$, $\mathbf{H}_s$, and $\langle S\rangle$ for a 20 GHz wave.
- Problems 11.6, 11.10, 11.11, and 11.18 require phasor fields, instantaneous fields, and average power in lossy media.
- Problem 11.8 uses outward power through a spherical shell to determine the radial dependence required for an isotropic radiator.
- Problem 11.9 uses Maxwell's equations to find the magnetic field and the required relation between $\alpha$ and $\beta$ for an evanescent wave.
- Problem 11.13 asks for $\mu$, $\epsilon'$, and $\epsilon''$ from given $jk$ and $\eta$.
- Problem 11.20 estimates focused lightwave power from the air-breakdown field strength.

## Related Pages

- [[loss-penetration-depth-and-conductor-power-dissipation|Loss, Penetration Depth, and Conductor Power Dissipation]]
- [[circularly-polarized-wave-phasors|Circularly Polarized Wave Phasors]]
- [[incident-reflected-and-transmitted-plane-waves|Incident, Reflected, and Transmitted Plane Waves]]
- [[power-reflectivity-and-conservation|Power Reflectivity and Conservation]]

## Concept Dependencies

- applies-to: [[loss-penetration-depth-and-conductor-power-dissipation|Loss, Penetration Depth, and Conductor Power Dissipation]]
