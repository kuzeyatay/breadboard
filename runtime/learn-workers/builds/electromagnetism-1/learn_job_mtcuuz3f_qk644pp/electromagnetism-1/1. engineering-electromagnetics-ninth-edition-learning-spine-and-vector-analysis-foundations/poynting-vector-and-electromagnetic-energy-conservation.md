---
title: "1.227 Poynting Vector and Electromagnetic Energy Conservation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 398", "Page 399", "Page 400"]
related: ["time-average-power-density-of-sinusoidal-waves", "lossless-dielectric-plane-wave-propagation", "good-conductor-intrinsic-impedance-and-power-density", "skin-effect-resistance"]
---

# 1.227 Poynting Vector and Electromagnetic Energy Conservation

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 398, Page 399, Page 400

Poynting's theorem is derived as an electromagnetic power-conservation law. The derivation begins with the conductive-medium Maxwell equation $\nabla\times\mathbf{H}=\mathbf{J}+\partial\mathbf{D}/\partial t$ and takes its scalar product with $\mathbf{E}$. The vector identity $\nabla\cdot(\mathbf{E}\times\mathbf{H})=-\mathbf{E}\cdot(\nabla\times\mathbf{H})+\mathbf{H}\cdot(\nabla\times\mathbf{E})$ introduces a divergence term. Substitution of Faraday's law, $\nabla\times\mathbf{E}=-\partial\mathbf{B}/\partial t$, produces a local balance between outward field power, ohmic dissipation, and changing electric and magnetic energy. The electric and magnetic terms are rewritten as time derivatives of the energy densities $\mathbf{D}\cdot\mathbf{E}/2$ and $\mathbf{B}\cdot\mathbf{H}/2$. Integration over a volume and application of the divergence theorem yield the integral Poynting theorem. The surface integral of $\mathbf{E}\times\mathbf{H}$ is the total outward power, while the volume terms represent dissipated power and rates of increase of stored energy. The Poynting vector $\mathbf{S}=\mathbf{E}\times\mathbf{H}$ has units of $\mathrm{W/m^2}$ and points in the instantaneous power-flow direction.

## Page-Grounded Details

#### Page 398

D11.4. Given a nonmagnetic material having $\epsilon_{r}^{\prime}=3.2$ and $\sigma=1.5\times 10^{-4}$ S/m, find numerical values at 3 MHz for the (a) loss tangent; (b) attenuation constant; (c) phase constant; (d) intrinsic impedance.

Ans. (a) 0.28; (b) 0.016 Np/m; (c) 0.11 rad/m; (d) 207 $\angle 7.8^{\circ}$ $\Omega$

D11.5. Consider a material for which $\mu_{r}=1$, $\epsilon_{r}^{\prime}=2.5$, and the loss tangent is 0.12. If these three values are constant with frequency in the range $0.5$ MHz $\leq f\leq 100$ MHz, calculate: (a) $\sigma$ at 1 and 75 MHz; (b) $\lambda$ at 1 and 75 MHz; (c) $v_{p}$ at 1 and 75 MHz.

Ans. (a) $1.67\times 10^{-5}$ and $1.25\times 10^{-3}$ S/m; (b) 190 and 2.53 m; (c) $1.90\times 108$ m/s twice

#### 11.3 POYNTING'S THEOREM AND WAVE POWER

In order to find the power flow associated with an electromagnetic wave, it is necessary to develop a power theorem for the electromagnetic field known as the Poynting theorem. It was originally postulated in 1884 by an English physicist, John H. Poynting.

The development begins with one of Maxwell's curl equations, in which we assume that the medium may be conductive:
$$
\nabla\tim

[Truncated for analysis]

#### Page 399

The two time derivatives in (67) can be rearranged as follows:
$$
 \epsilon\mathbf{E}\cdot\frac{\partial\mathbf{E}}{\partial t}=\frac{\partial}{\partial t}\left(\frac{1}{2}\mathbf{D}\cdot\mathbf{E}\right)\quad{(68a)}
$$
and
$$
 \mu\mathbf{H}\cdot\frac{\partial\mathbf{H}}{\partial t}=\frac{\partial}{\partial t}\left(\frac{1}{2}\mathbf{B}\cdot\mathbf{H}\right)\quad{(68b)}
$$
With these, Eq. (67) becomes
$$
 -\,\nabla\cdot(\mathbf{E}\times\mathbf{H})=\mathbf{J}\cdot\mathbf{E}+\frac{\partial}{\partial t}\left(\frac{1}{2}\mathbf{D}\cdot\mathbf{E}\right)+\frac{\partial}{\partial t}\left(\frac{1}{2}\mathbf{B}\cdot\mathbf{H}\right)\quad{(69)}
$$
Finally, we integrate (69) throughout a volume:
$$
 -\int_{\mathrm{vol}}\nabla\cdot(\mathbf{E}\times\mathbf{H})dv=\int_{\mathrm{vol}}\mathbf{J}\cdot\mathbf{E}dv+\int_{\mathrm{vol}}\frac{\partial}{\partial t}\left(\frac{1}{2}\mathbf{D}\cdot\mathbf{E}\right)dv+\int_{\mathrm{vol}}\frac{\partial}{\partial t}\left(\frac{1}{2}\mathbf{B}\cdot\mathbf{H}\right)dv
$$
The divergence theorem is then applied to the left-hand side, thus converting the volume integral there into an integral over the surface that encloses the volume. On the right-hand side, th

[Truncated for analysis]

#### Page 400

instantaneous power flow at a point, and many of us think of the Poynting vector as a "pointing" vector. This homonym, while accidental, is correct.$^{4}$

Because S is given by the cross product of E and H, the direction of power flow at any point is normal to both the E and H vectors. This certainly agrees with our experience with the uniform plane wave, for propagation in the +z direction was associated with an $E_{x}$ and $H_{y}$ component
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
Thus
$$
 S_{z}=E_{x} H_{y}=\frac{E_{x0}^

[Truncated for analysis]

## Core Ideas

- The derivation begins with Ampere-Maxwell law in a conductive medium.
- A vector identity converts field curls into the divergence of $\mathbf{E}\times\mathbf{H}$.
- Faraday's law supplies the magnetic-energy term.
- Electric energy density is $\mathbf{D}\cdot\mathbf{E}/2$.
- Magnetic energy density is $\mathbf{B}\cdot\mathbf{H}/2$.
- The term $\mathbf{J}\cdot\mathbf{E}$ represents instantaneous ohmic power density.
- The Poynting vector is $\mathbf{S}=\mathbf{E}\times\mathbf{H}$ in $\mathrm{W/m^2}$.
- A closed-surface integral of $\mathbf{S}$ gives total outward electromagnetic power.

## Source Anchors

- Equations (63) through (67) derive the local field-power balance from Maxwell's curl equations.
- Equations (68a) and (68b) identify the electric and magnetic stored-energy derivatives.
- Equation (69) is the differential form of the complete power balance.
- Equation (70) is the volume-integrated Poynting theorem after applying the divergence theorem.
- Equation (71) identifies $\oint(\mathbf{E}\times\mathbf{H})\cdot d\mathbf{S}$ as total outward power.
- Equation (72) defines $\mathbf{S}=\mathbf{E}\times\mathbf{H}$.

## Related Pages

- [[time-average-power-density-of-sinusoidal-waves|Time-Average Power Density of Sinusoidal Waves]]
- [[lossless-dielectric-plane-wave-propagation|Lossless Dielectric Plane-Wave Propagation]]
- [[good-conductor-intrinsic-impedance-and-power-density|Good-Conductor Intrinsic Impedance and Power Density]]
- [[skin-effect-resistance|Skin-Effect Resistance]]

## Concept Dependencies

- enables: [[time-average-power-density-of-sinusoidal-waves|Time-Average Power Density of Sinusoidal Waves]]
