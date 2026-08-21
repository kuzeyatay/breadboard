---
title: "1.309 Near-Field and Far-Field Behavior"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 531", "Page 532", "Page 533", "Section 14.1.2", "Section 14.1.3", "Problem D14.1"]
related: ["general-electromagnetic-fields-of-a-hertzian-dipole", "hertzian-dipole-radiation-pattern", "radiated-power-and-radiation-resistance", "radiation-intensity-and-solid-angle"]
---

# 1.309 Near-Field and Far-Field Behavior

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 531, Page 532, Page 533, Section 14.1.2, Section 14.1.3, Problem D14.1

The distance dependence of the Hertzian-dipole fields separates reactive energy storage from outward radiation. Close to the element, terms proportional to $1/r^3$ and $1/r^2$ can greatly exceed the $1/r$ term. The $1/r^3$ electric contribution resembles the electrostatic field of a dipole and represents energy stored in a reactive, predominantly capacitive field. The $1/r^2$ magnetic contribution corresponds to the induction field associated with a current element and the Biot-Savart law. These near-field terms do not contribute to the net radiated power. At distances comparable to a wavelength, the different radial terms and their additional phases combine to produce spatial oscillations that are not uniformly periodic. At large distances, $kr\gg1$, equivalently $r\gg\lambda$, the inverse-distance terms dominate and the field approaches a sinusoidal outgoing wave with a well-defined wavelength. The source uses roughly ten wavelengths as a practical far-zone example. In this region $E_{rs}$ is negligible, while $E_{\theta s}$ and $H_{\phi s}$ remain, satisfy $E_{\theta s}=\eta H_{\phi s}$, and locally approximate a uniform plane wave.

## Page-Grounded Details

#### Page 531
$$
E_{rs}=\frac{I_{0}d}{2\pi r^{2}}\eta\left[1+\frac{1}{(kr)^{2}}\right]^{1/2}\cos\theta\exp\left[-j(kr-\delta_{r})\right]
$$
(15)
$$
E_{\theta s}=\frac{I_{0}kd}{4\pi r}\eta\left[1-\frac{1}{(kr)^{2}}+\frac{1}{(kr)^{4}}\right]^{1/2}\sin\theta\exp\left[-j(kr-\delta_{\theta})\right]
$$
(16)

where the additional phase terms are
$$
\delta_{\phi}=\tan^{-1}[kr]
$$
(17a)
$$
\delta_{r}=\tan^{-1}[kr]-\frac{\pi}{2}
$$
(17b)

and
$$
\delta_{\theta}=\tan^{-1}\left[kr\left(1-\frac{1}{(kr)^{2}}\right)\right]
$$
(18)

In (17) and (18), the principal value is always taken when evaluating the inverse tangent. This means that the phases as expressed in (17) and (18) will occur within the range $\pm\pi/2$ as kr varies between zero and infinity. Suppose a single frequency (k value) is chosen, and the fields are observed at a fixed instant in time. Consider observing the field along a path in the direction of increasing r, in which spatial oscillations will be seen as r varies. As a result of the phase terms in (17) and (18), the oscillation period will change with increasing r. We may demonstrate this by considering the $H_{\phi}$ component as a function of r under the following condition

[Truncated for analysis]

#### Page 532

negative amplitudes that differ in each cycle. Second, at distances $r$ that are much greater than a wavelength, the second term in (21) dominates, and the field variation with $r$ approaches that of a pure sinusoid. We may therefore say that, for all practical purposes, the wave at large distances, where $r>>\lambda$, is a uniform plane wave having a sinusoidal variation with distance (and time, of course) and a well-defined wavelength. This wave evidently carries power away from the differential antenna.

We should now take a more careful look at the expressions containing terms varying as $1/r^{3}$, $1/r^{2}$, and $1/r$ in Eqs. (10), (13$a$), and (13$b$). At points very close to the current element, the $1/r^{3}$ term must be dominant. In the numerical example we have used, the relative values of the terms in $1/r^{3}$, $1/r^{2}$, and $1/r$ in the $E_{\theta s}$ expression are about 250, 16, and 1, respectively, when $r$ is 1 cm. The variation of an electric field as $1/r^{3}$ should remind us of the electrostatic field of the dipole (Chapter 4). The development of this concept is the subject of Problem 14.4. The near-field terms represent energy st

[Truncated for analysis]

#### Page 533

Figure 14.3 The polar plot of the $E$-plane pattern of a vertical current element. The crest amplitude of $E_{\theta s}$ is plotted as a function of the polar angle $\theta$ at a constant distance $r$. The locus is a circle.

is simply the coordinate plane that contains the electric field, which in our present case is any surface of constant $\phi$ in the spherical coordinate system. Figure 14.3 shows an $E$-plane plot of Eq. (22) in polar coordinates, in which the relative magnitude of $E_{\theta s}$ is plotted against $\theta$ for a constant $r$. The length of the vector shown in the figure represents the magnitude of $E_{\theta}$, normalized to unity at $\theta=90^{\circ}$; the vector length is just $|\sin\theta|$, and so as $\theta$ varies, the tip of the vector traces out a circle as shown.

A horizontal, or $H$-plane pattern may also be plotted for this or more complicated antenna systems. In the present case, this would show the variation of field intensity with $\phi$. The $H$-plane of the current element (the plane that contains the magnetic field) is any plane that is normal to the $z$ axis. As $E_{\theta}$ is not a function of $\phi$

[Truncated for analysis]

## Core Ideas

- The $1/r^3$ electric term dominates extremely close to the source.
- The $1/r^3$ term resembles an electrostatic dipole field.
- The $1/r^2$ magnetic term resembles an induction field from the Biot-Savart law.
- Near-field terms store reactive energy and do not produce net radiated power.
- Fields at distances comparable to $\lambda$ have nonuniform spatial periodicity.
- Far-zone conditions are $kr\gg1$ or $r\gg\lambda$.
- Only the $1/r$ radiation fields remain significant in the far zone.
- The far fields satisfy the plane-wave relation $E_{\theta s}=\eta H_{\phi s}$.

## Source Anchors

- At $r=1\,\mathrm{cm}$ in the stated numerical comparison, the relative $1/r^3$, $1/r^2$, and $1/r$ contributions to $E_{\theta s}$ are approximately 250, 16, and 1.
- The instantaneous magnetic field example reduces to
$$
\mathcal{H}_\phi=\frac{1}{r^2}\left[\cos\left(\frac{2\pi r}{\lambda}\right)+\frac{2\pi r}{\lambda}\sin\left(\frac{2\pi r}{\lambda}\right)\right]
$$
- The source identifies distances of about ten or more wavelengths as a practical far-zone range.
- The far fields are
$$
E_{rs}\doteq0
$$
$$
E_{\theta s}=j\frac{I_0kd}{4\pi r}\eta\sin\theta\,e^{-jkr}
$$
 and
$$
H_{\phi s}=j\frac{I_0kd}{4\pi r}\sin\theta\,e^{-jkr}
$$
- Problem D14.1 compares $|E_{\theta s}|$ from 1 cm through 2 m for a short antenna with $\lambda=10\,\mathrm{cm}$.

## Related Pages

- [[general-electromagnetic-fields-of-a-hertzian-dipole|General Electromagnetic Fields of a Hertzian Dipole]]
- [[hertzian-dipole-radiation-pattern|Hertzian Dipole Radiation Pattern]]
- [[radiated-power-and-radiation-resistance|Radiated Power and Radiation Resistance]]
- [[radiation-intensity-and-solid-angle|Radiation Intensity and Solid Angle]]

## Concept Dependencies

- enables: [[hertzian-dipole-radiation-pattern|Hertzian Dipole Radiation Pattern]]
- enables: [[radiated-power-and-radiation-resistance|Radiated Power and Radiation Resistance]]
