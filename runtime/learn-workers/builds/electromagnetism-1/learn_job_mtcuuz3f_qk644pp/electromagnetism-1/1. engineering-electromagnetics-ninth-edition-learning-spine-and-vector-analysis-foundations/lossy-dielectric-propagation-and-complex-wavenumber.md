---
title: "1.219 Lossy Dielectric Propagation and Complex Wavenumber"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 389", "Page 390"]
related: ["vector-helmholtz-equation-in-free-space", "complex-permittivity-and-dielectric-loss", "traveling-wave-direction-and-sinusoidal-solutions", "phase-velocity-and-wavelength-in-lossy-media"]
---

# 1.219 Lossy Dielectric Propagation and Complex Wavenumber

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 389, Page 390

The plane-wave analysis extends from free space to a homogeneous, isotropic dielectric with spatially constant permittivity $\epsilon$ and permeability $\mu$. Its Helmholtz equation retains the form $\nabla^2\mathbf{E}_s=-k^2\mathbf{E}_s$, but the material wavenumber is $k=\omega\sqrt{\mu\epsilon}=k_0\sqrt{\mu_r\epsilon_r}$. When loss or gain is present, $k$ may be complex. Writing $jk=\alpha+j\beta$ separates amplitude change from phase change. A forward electric-field phasor then becomes $E_{xs}=E_{x0}e^{-\alpha z}e^{-j\beta z}$, and the corresponding instantaneous field is $E_x=E_{x0}e^{-\alpha z}\cos(\omega t-\beta z)$. Positive $\alpha$ describes passive attenuation, while negative $\alpha$ describes gain, such as in a laser amplifier. The attenuation coefficient is measured in nepers per meter. Over a distance $1/\alpha$, a passive wave's amplitude falls by $e^{-1}$ to approximately 0.368 of its initial value.

## Page-Grounded Details

#### Page 389

Figure 11.1 (a) Arrows represent the instantaneous values of $E_{x0}\cos[\omega(t-z/c)]$ at $t=0$ along the z axis, along an arbitrary line in the x = 0 plane parallel to the z axis, and along an arbitrary line in the y = 0 plane parallel to the z axis. (b) Corresponding values of $H_{y}$ are indicated. Note that $E_{x}$ and $H_{y}$ are in phase at any point in time.

Although we have considered only a wave varying sinusoidally in time and space, a suitable combination of solutions to the wave equation may be made to achieve a wave of any desired form, but which satisfies (14). The summation of an infinite number of harmonics through the use of a Fourier series can produce a periodic wave of square or triangular shape in both space and time. Nonperiodic waves may be obtained from our basic solution by Fourier integral methods. These topics are among those considered in the more advanced books on electromagnetic theory.

D11.1. The electric field amplitude of a uniform plane wave propagating in the $\mathbf{a}_{z}$ direction is 250 V/m. If $\mathbf{E}=E_{x}\mathbf{a}_{x}$ and $\omega=1.00$ Mrad/s, find: (a) the frequency; (b) the wavelength; (c) the period; (d) the a

[Truncated for analysis]

#### Page 390

#### 11.2.1 Propagation in Lossy Media

The Helmholtz equation in a homogeneous and isotropic medium is
$$
\nabla^{2}E_{s}=-k^{2}E_{s}\qquad(36)
$$
where the wavenumber is a function of the material properties, as described by $\mu$ and $\epsilon$:
$$
k=\omega\sqrt{\mu\epsilon}=k_{0}\sqrt{\mu_{r}\epsilon_{r}}\qquad(37)
$$
For $E_{xs}$ we have
$$
\frac{d^{2}E_{xs}}{dz^{2}}=-k^{2}E_{xs}\qquad(38)
$$
An important feature of wave propagation in a dielectric is that k can be complex-valued, and as such it is referred to as the complex propagation constant. k becomes complex when loss or gain mechanisms are present in the medium, as will be explained. A general solution of (38), in fact, allows the possibility of a complex k, and it is customary to write it in terms of its real and imaginary parts in the following way:
$$
jk=\alpha+j\beta\qquad(39)
$$
A solution to (38) will be:
$$
E_{xs}=E_{x0}e^{-jkz}=E_{x0}e^{-\alpha z}e^{-j\beta z}\qquad(40)
$$
Multiplying (40) by $e^{j\omega t}$ and taking the real part yields a form of the field that can be more easily visualized:
$$
E_{x}=E_{x0}e^{-\alpha z}\cos(\omega t-\beta z)\qquad(41)
$$
We recognize this as a uniform plan

[Truncated for analysis]

## Core Ideas

- The dielectric Helmholtz equation is $\nabla^2\mathbf{E}_s=-k^2\mathbf{E}_s$.
- The material wavenumber is $k=\omega\sqrt{\mu\epsilon}$.
- Relative material parameters give $k=k_0\sqrt{\mu_r\epsilon_r}$.
- The decomposition $jk=\alpha+j\beta$ separates attenuation and phase.
- The forward phasor is $E_{x0}e^{-\alpha z}e^{-j\beta z}$.
- Positive $\alpha$ represents loss; negative $\alpha$ represents gain.
- Attenuation coefficient has units of Np/m.
- At distance $1/\alpha$, amplitude is reduced to $e^{-1}$.

## Source Anchors

- The dielectric is assumed homogeneous and isotropic on Page 389.
- Equations (36) and (37) give $\nabla^2\mathbf{E}_s=-k^2\mathbf{E}_s$ and $k=\omega\sqrt{\mu\epsilon}=k_0\sqrt{\mu_r\epsilon_r}$.
- Equation (39) defines $jk=\alpha+j\beta$.
- Equations (40) and (41) give $E_{xs}=E_{x0}e^{-\alpha z}e^{-j\beta z}$ and $E_x=E_{x0}e^{-\alpha z}\cos(\omega t-\beta z)$.
- The source states that if $\alpha=0.01$ Np/m, the amplitude at $z=50$ m is 0.607 of the value at $z=0$.
- The source identifies negative $\alpha$ with gain and gives laser amplifiers as an example.

## Related Pages

- [[vector-helmholtz-equation-in-free-space|Vector Helmholtz Equation in Free Space]]
- [[complex-permittivity-and-dielectric-loss|Complex Permittivity and Dielectric Loss]]
- [[traveling-wave-direction-and-sinusoidal-solutions|Traveling-Wave Direction and Sinusoidal Solutions]]
- [[phase-velocity-and-wavelength-in-lossy-media|Phase Velocity and Wavelength in Lossy Media]]

## Concept Dependencies

- derives-from: [[vector-helmholtz-equation-in-free-space|Vector Helmholtz Equation in Free Space]]
- depends-on: [[complex-permittivity-and-dielectric-loss|Complex Permittivity and Dielectric Loss]]
- enables: [[phase-velocity-and-wavelength-in-lossy-media|Phase Velocity and Wavelength in Lossy Media]]
