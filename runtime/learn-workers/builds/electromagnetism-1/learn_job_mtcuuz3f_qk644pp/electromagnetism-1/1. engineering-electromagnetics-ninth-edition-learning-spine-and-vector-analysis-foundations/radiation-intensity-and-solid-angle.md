---
title: "1.312 Radiation Intensity and Solid Angle"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 534", "Page 535", "Page 536", "Section 14.2.2", "Section 14.2.3", "Figure 14.4", "Problem D14.2"]
related: ["radiated-power-and-radiation-resistance", "hertzian-dipole-radiation-pattern", "directivity-and-beamwidth", "antenna-gain-and-radiation-efficiency"]
---

# 1.312 Radiation Intensity and Solid Angle

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 534, Page 535, Page 536, Section 14.2.2, Section 14.2.3, Figure 14.4, Problem D14.2

Solid angle provides the angular measure needed to describe how an antenna distributes power over direction. A cone subtending area $A=r^2$ on a sphere of radius $r$ has a solid angle of one steradian. Since the sphere has area $4\pi r^2$, the full sphere contains $4\pi$ steradians. In spherical coordinates, the differential surface area is $dA=r^2\sin\theta\,d\theta\,d\phi$, so the corresponding differential solid angle is $d\Omega=\sin\theta\,d\theta\,d\phi$. Radiation intensity converts radial power density in watts per square meter into power per steradian by multiplying by $r^2$. Thus $K(\theta,\phi)=r^2S_r$. In the far zone, where $S_r$ has the required $1/r^2$ dependence, $K$ is independent of radius and isolates the antenna's directional power distribution. Total radiated power is recovered by integrating $K$ over all solid angles. For the Hertzian dipole, radiation intensity is independent of $\phi$ and varies as $\sin^2\theta$, matching the squared field pattern.

## Page-Grounded Details

#### Page 534

Substituting (22) and (23) into (25), we obtain the time-average Poynting vector magnitude:
$$
|< S >|= S_r=\frac{1} {2} \left( \frac{I_0 k d} {4 \pi r} \right)^2 \eta \sin^2 \theta
$$
(26)

From this we find the time-average power that crosses the surface of a sphere of radius $r$, centered at the antenna:
$$
P_r=\int_{\phi=0}^{2\pi} \int_{\theta=0}^{\pi} S_r \ r^2 \sin\theta\ d\theta\ d\phi=2\pi \left( \frac{1} {2} \right) \left( \frac{I_0 k d} {4\pi} \right)^2 \eta \int_0^{\pi} \sin^3 \theta\ d\theta
$$
(27)

The integral is evaluated, and we substitute $k=2\pi/\lambda$. We will also assume that the medium is free space, where $\eta=\eta_0\doteq 120\pi$. We finally obtain:
$$
P_r=40 \pi^2 \left( \frac{I_0 d} {\lambda} \right)^2 \quad\ W
$$
(28)

This is the same average power that would be dissipated in a resistance $R_{\text{rad}}$ by sinusoidal current of amplitude $I_0$ in the absence of any radiation, where
$$
P_r=\frac{1} {2} I_0^2 \ R_{\text{rad}}
$$
(29)

We call this effective resistance the radiation resistance of the antenna. For the differential antenna, this becomes
$$
R_{\text{rad}}=\frac{2 P_r} {I_0^2}=80 \pi^2 \left( \frac{d} {\lambda} \right)^2

[Truncated for analysis]

#### Page 535

manner: If $A = r^{2}$, where $r$ is the sphere radius, then the cone is defined as having a solid angle, $\Omega$, equal to one steradian (sr).$^{1}$ As the total sphere area is $4\pi r^{2}$, we see that the total solid angle contained within a sphere is $4\pi$ steradians.

As a consequence of this definition, differential area on the sphere surface can be expressed in terms of a differential solid angle through:
$$
 d\,A = r^{2}\,d\Omega \quad{(31)}
$$
The total sphere area can then be expressed as an integral over solid angle, or equiv-alently by an integral using spherical coordinates:
$$
 A_{\text{net}} = 4\pi r^{2} = \int_{0}^{4\pi} r^{2}\,d\Omega = \int_{0}^{2\pi} \int_{0}^{\pi} r^{2}\sin\theta\,d\theta\,d\phi \quad{(32)}
$$
from which we identify the differential solid angle as expressed in spherical coordinates:
$$
 d\Omega = \sin\theta\,d\theta\,d\phi \quad{(33)}
$$
The preceding relations are depicted in Fig. 14.4.

D14.2. A cone is centered on the positive $z$ axis with its vertex at the origin. The cone angle in spherical coordinates is $\theta_{1}$. (a) If the cone subtends 1 sr of solid angle, determine $\theta_{1}$. (b) If $ \theta_{1} = 45^{\ci

[Truncated for analysis]

#### Page 536

Figure 14.4 A cone having differential solid angle $d\Omega$ subtends a (shaded) differential area on the surface of a sphere of radius $r$. This area, given by $dA=r^{2}d\Omega$, can also be expressed in our more familiar spherical coordinate system as $dA=r^{2}\sin\theta\,d\theta\,d\phi$.

The advantage of using the radiation intensity for power density is that this quantity is independent of the radius. This is true, however, only if the original power density exhibits a $1/r^{2}$ dependence. In fact, all antennas have this functional dependence on radius in the far zone, in that when far enough away, the antenna appears as a point source of power. Assuming the surrounding medium does not absorb any power, the integral of the Poynting vector over a closed sphere of any radius must give the same result. This fact demands an inverse-square dependence on radius for the power density. With the radial dependence removed, one can concentrate on the angular dependence of the power density as expressed by $K$, and this will differ significantly among different antennas.

#### 14.2.4 Directivity

A special case of a power source is an isotropic radiator, defined as having a c

[Truncated for analysis]

## Core Ideas

- Solid angle measures the directional extent of a cone.
- One steradian subtends area $r^2$ on a sphere of radius $r$.
- A complete sphere contains $4\pi$ steradians.
- The differential relation is $dA=r^2d\Omega$.
- In spherical coordinates, $d\Omega=\sin\theta\,d\theta\,d\phi$.
- Radiation intensity is $K=r^2S_r$ in watts per steradian.
- Far-zone radiation intensity is independent of radius.
- Total radiated power is the integral of $K$ over $4\pi$ steradians.

## Source Anchors

- The source defines
$$
dA=r^2d\Omega.
$$
- It identifies
$$
d\Omega=\sin\theta\,d\theta\,d\phi.
$$
- Figure 14.4 shows a differential cone subtending differential area on a sphere.
- Radiation intensity is
$$
K(\theta,\phi)=r^2S_r\ \mathrm{W/sr}.
$$
- For the Hertzian dipole
$$
K(\theta)=\frac{1}{2}\left(\frac{I_0kd}{4\pi}\right)^2\eta\sin^2\theta.
$$
- Total power is
$$
P_r=\int_0^{2\pi}\int_0^\pi K(\theta,\phi)\sin\theta\,d\theta\,d\phi.$$
- Problem D14.2 gives cone-angle and solid-angle conversion exercises.

## Related Pages

- [[radiated-power-and-radiation-resistance|Radiated Power and Radiation Resistance]]
- [[hertzian-dipole-radiation-pattern|Hertzian Dipole Radiation Pattern]]
- [[directivity-and-beamwidth|Directivity and Beamwidth]]
- [[antenna-gain-and-radiation-efficiency|Antenna Gain and Radiation Efficiency]]

## Concept Dependencies

- enables: [[directivity-and-beamwidth|Directivity and Beamwidth]]
