---
title: "1.259 Wavevector Representation of General Plane Waves"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 440", "Page 441", "Page 442", "Page 443", "Section 12.4: Plane Wave Propagation in General Directions", "Example 12.6", "Exercise D12.4"]
related: ["refractive-index-material-wave-parameters", "oblique-incidence-geometry-polarization", "phase-matching-reflection-law-snells-law", "frequency-dependent-refractive-index-angular-dispersion"]
---

# 1.259 Wavevector Representation of General Plane Waves

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 440, Page 441, Page 442, Page 443, Section 12.4: Plane Wave Propagation in General Directions, Example 12.6, Exercise D12.4

A plane wave propagating in an arbitrary direction is described by a wavevector $\mathbf{k}$ whose direction is the propagation direction and whose magnitude is the phase shift per unit distance along that direction. In an isotropic lossless medium, this direction also agrees with the Poynting-vector direction. The phase at position $\mathbf{r}$ is measured by the dot product $\mathbf{k}\cdot\mathbf{r}$, giving the phasor $\mathbf{E}_s=\mathbf{E}_0e^{-j\mathbf{k}\cdot\mathbf{r}}$. In two dimensions, with $\mathbf{k}=k_x\mathbf{a}_x+k_z\mathbf{a}_z$ and $\mathbf{r}=x\mathbf{a}_x+z\mathbf{a}_z$, the phase is $k_xx+k_zz$. The propagation angle from the $x$ axis is $\tan^{-1}(k_z/k_x)$. Wavelength and phase velocity along $\mathbf{k}$ use the vector magnitude $k=\sqrt{k_x^2+k_z^2}$, whereas apparent values measured along a coordinate axis use only the associated component. These axial phase velocities can exceed the medium's light speed without violating relativity because they describe moving intersections of phase fronts, not energy transport. Example 12.6 demonstrates construction of a field phasor from frequency, permittivity, direction, and polarization.

## Page-Grounded Details

#### Page 440

The fraction of the power transmitted into region 4 is, as before, $1-\mid\Gamma\mid^{2}$. The method of impedance transformation can be applied in this manner to any number of interfaces. The process, although tedious, is easily handled by a computer.

The motivation for using multiple layers to reduce reflection is that the resulting structure is less sensitive to deviations from the design wavelength if the impedances (or refractive indices) are arranged to progressively increase or decrease from layer to layer. For multiple layers to antireflection coat a camera lens, for example, the layer on the lens surface would be of impedance very close to that of the glass. Subsequent layers are given progressively higher impedances. With a large number of layers fabricated in this way, the situation begins to approach (but never reaches) the ideal case, in which the top layer impedance matches that of air, while the impedances of deeper layers continuously decrease until reaching the value of the glass surface. With this continuously varying impedance, there is no surface from which to reflect, and so light of any wavelength is totally transmitted. Multilayer coatings designed in this

[Truncated for analysis]

#### Page 441

Figure 12.6 Representation of a uniform plane wave with wavevector $\bm{k}$ at angle $\theta$ to the $x$ axis. The phase at point $(x, z)$ is given by $\bm{k} \cdot \bm{r}$. Planes of constant phase (shown as lines perpendicular to $\bm{k}$) are spaced by wavelength $\lambda$ but have wider spacing when measured along the $x$ or $z$ axis.

spatial location. For the waves we have considered that propagate along the $z$ axis, this was accomplished by the factor $e^{\pm jkz}$ in the phasor form. To specify the phase in our two-dimensional problem, we make use of the vector nature of $\bm{k}$ and consider the phase at a general location $(x, z)$ described through the position vector $\bm{r}$. The phase at that location, referenced to the origin, is given by the projection of $\bm{k}$ along $\bm{r}$ times the magnitude of $\bm{r}$, or just $\bm{k} \cdot \bm{r}$. If the electric field is of magnitude $E_0$, we can thus write down the phasor form of the wave in Figure 12.6 as
$$
\bm{E}_s = \bm{E}_0 e^{-j \bm{k} \cdot \bm{r}} \quad (49)
$$
The minus sign in the exponent indicates that the phase along $\bm{r}$ moves in time in the direction of increasing $\bm{r}$. Again, the wave power fl

[Truncated for analysis]

#### Page 442

The position vector, $\mathbf{r}$, can be similarly expressed:
$$
\mathbf{r}=x\mathbf{a}_{x}+z\mathbf{a}_{z}
$$
so that
$$
\mathbf{k}\cdot\mathbf{r}=k_{x}x+k_{z}z
$$
Equation (49) now becomes
$$
\mathbf{E}_{s}=\mathbf{E}_{0}e^{-j(k_{x}x+k_{z}z)}\quad{(50)}
$$
Whereas Eq. (49) provided the general form of the wave, Eq. (50) is the form that is specific to the situation. Given a wave expressed by (50), the angle of propagation from the $x$ axis is readily found through
$$
\theta=\tan^{-1}\left(\frac{k_{z}}{k_{x}}\right)
$$
The wavelength and phase velocity depend on the direction one is considering. In the direction of $\mathbf{k}$, these will be
$$
\lambda=\frac{2\pi}{k}=\frac{2\pi}{\left(k_{x}^{2}+k_{z}^{2}\right)^{1/2}}
$$
and
$$
v_{p}=\frac{\omega}{k}=\frac{\omega}{\left(k_{x}^{2}+k_{z}^{2}\right)^{1/2}}
$$
If, for example, we consider the $x$ direction, these quantities will be
$$
\lambda_{x}=\frac{2\pi}{k_{x}}
$$
and
$$
v_{px}=\frac{\omega}{k_{x}}
$$
Note that both $\lambda_{x}$ and $v_{px}$ are greater than their counterparts along the direction of $\mathbf{k}$. This result, at first surprising, can be understood through the geometry of Figure 12.

[Truncated for analysis]

#### Page 443

points between the phase fronts and the x axis. Again, from the geometry, we see that this velocity must be faster than the velocity along k and will, of course, exceed the speed of light in the medium. This does not constitute a violation of special relativity, however, since the energy in the wave flows in the direction of k and not along x or z. The wave frequency is f= w/2π and is invariant with direction. Note, for example, that in the directions we have considered,
$$
f=\frac{v_{p}}{\lambda}=\frac{v_{px}}{\lambda_{x}}=\frac{\omega}{2\pi}
$$
#### EXAMPLE 12.6

Consider a 50-MHz uniform plane wave having electric field amplitude 10 V/m. The medium is lossless, having $\mathrm{e}_{r}=\mathrm{e}_{r}^{\prime}=9.0$ and $\mathrm{\mu}_{r}=1.0$. The wave propagates in the x, y plane at a $30^{\circ}$ angle to the x axis and is linearly polarized along z. Write down the phasor expression for the electric field.

Solution. The propagation constant magnitude is
$$
k=\omega\sqrt{\mu\overline{\epsilon}}=\frac{\omega\sqrt{\overline{\epsilon}_{r}}}{c}=\frac{2\pi\times 50\times 10^{6}(3)}{3\times 10^{8}}=3.2\mathrm{m}^{-1}
$$
The vector k is now
$$
\mathbf{k}=3.2(\cos 30\mathbf{a}_

[Truncated for analysis]

## Core Ideas

- The general plane-wave phasor is $\mathbf{E}_s=\mathbf{E}_0e^{-j\mathbf{k}\cdot\mathbf{r}}$.
- The direction of $\mathbf{k}$ is the propagation and power-flow direction in the stated isotropic medium.
- In two dimensions, $\mathbf{k}\cdot\mathbf{r}=k_xx+k_zz$.
- The propagation angle is $\theta=\tan^{-1}(k_z/k_x)$.
- Along $\mathbf{k}$, $\lambda=2\pi/k$ and $v_p=\omega/k$.
- Along $x$, $\lambda_x=2\pi/k_x$ and $v_{px}=\omega/k_x$.
- Frequency remains invariant with direction: $f=v_p/\lambda=v_{px}/\lambda_x$.

## Source Anchors

- Figure S1.P441.F1, corresponding to Figure 12.6, shows $\mathbf{k}$, $\mathbf{r}$, constant-phase planes, $\lambda$, and the larger axial phase-front spacing.
- Equation (49) gives
$$
\mathbf{E}_s=\mathbf{E}_0e^{-j\mathbf{k}\cdot\mathbf{r}}.
$$
- Equation (50) gives
$$
\mathbf{E}_s=\mathbf{E}_0e^{-j(k_xx+k_zz)}.$$
- Pages 442 and 443 explain why axial phase velocity may exceed the medium light speed without carrying energy in that direction.
- Example 12.6 obtains $\mathbf{k}=2.8\mathbf{a}_x+1.6\mathbf{a}_y\ \mathrm{m}^{-1}$ for a 50 MHz wave in a medium with $\epsilon_r=9$.
- The example's field is $\mathbf{E}_s=10e^{-j(2.8x+1.6y)}\mathbf{a}_z$ V/m.
- Exercise D12.4 gives $\lambda_x=2.2$ m, $\lambda_y=3.9$ m, $v_{px}=1.1\times10^8$ m/s, and $v_{py}=2.0\times10^8$ m/s.

## Related Pages

- [[refractive-index-material-wave-parameters|Refractive Index and Material Wave Parameters]]
- [[oblique-incidence-geometry-polarization|Oblique-Incidence Geometry and Polarization]]
- [[phase-matching-reflection-law-snells-law|Phase Matching, Reflection Law, and Snell's Law]]
- [[frequency-dependent-refractive-index-angular-dispersion|Frequency-Dependent Refractive Index and Angular Dispersion]]

## Concept Dependencies

- depends-on: [[refractive-index-material-wave-parameters|Refractive Index and Material Wave Parameters]]
