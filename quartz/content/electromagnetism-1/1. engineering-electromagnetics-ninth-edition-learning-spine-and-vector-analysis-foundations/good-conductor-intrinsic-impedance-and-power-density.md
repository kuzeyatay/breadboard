---
title: "1.232 Good-Conductor Intrinsic Impedance and Power Density"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 405", "Page 406"]
related: ["good-conductor-propagation-approximation", "skin-depth-and-field-confinement", "time-average-power-density-of-sinusoidal-waves", "skin-effect-resistance"]
---

# 1.232 Good-Conductor Intrinsic Impedance and Power Density

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 405, Page 406

For a good conductor, the general impedance $\eta=\sqrt{j\omega\mu/(\sigma+j\omega\epsilon')}$ simplifies because $\sigma\gg\omega\epsilon'$. Using the skin depth, the result is $\eta=(1+j)/(\sigma\delta)=\sqrt{2}\angle45^\circ/(\sigma\delta)$. The electric field inside the conductor is $E_x=E_{x0}e^{-z/\delta}\cos(\omega t-z/\delta)$. Dividing by the complex impedance gives $H_y=(\sigma\delta E_{x0}/\sqrt{2})e^{-z/\delta}\cos(\omega t-z/\delta-\pi/4)$. Thus the magnetic-field maximum occurs one-eighth cycle later than the electric-field maximum at every point. Applying the time-average phasor Poynting-vector formula yields $\langle S_z\rangle=(1/4)\sigma\delta E_{x0}^2e^{-2z/\delta}$. This power flows into the conductor and is converted into ohmic heat. Like the general lossy-medium result, the power density has twice the exponential attenuation rate of either field. After one skin depth, it is only $e^{-2}=0.135$ of its value at the surface.

## Page-Grounded Details

#### Page 405

Solution. We first evaluate the loss tangent, using the given data:
$$
\frac{\sigma}{\omega\epsilon^{\prime}}=\frac{4}{(2\pi\times 10^{6})(81)(8.85\times 10^{-12})}=8.9\times 10^{2}\gg 1
$$
Seawater is therefore a good conductor at 1 MHz (and at frequencies lower than this). The skin depth is
$$
\delta=\frac{1}{\sqrt{\pi f\mu\sigma}}=\frac{1}{\sqrt{(\pi\times 10^{6})(4\pi\times 10^{-7})}(4)}=0.25~{}~{}\mathrm{m}=25~{}~{}\mathrm{cm}
$$
 Now
$$
\lambda=2\pi\delta=1.6\mathrm{~m}
$$
 and
$$
v_{p}=\omega\delta=\left(2\pi\times 10^{6}\right)\left(0.25\right)=1.6\times 10^{6}~{}\mathrm{m/s}
$$
 In free space, these values would have been $\lambda=300$ m and of course $v=c$.

With a 25-cm skin depth, it is obvious that radio frequency communication in seawater is quite impractical. Notice, however, that $\delta$ varies as $1/\sqrt{f}$, so that things will improve at lower frequencies. For example, if we use a frequency of 10 Hz (in the ELF, or extremely low frequency range), the skin depth is increased over that at 1 MHz by a factor of $\sqrt{10^{6}/10}$, so that
$$
\delta(10~{}\mathrm{Hz})\doteq 80\mathrm{~m}
$$
 The corresponding wavelength is $ \lambda=2\pi\delta\dot

[Truncated for analysis]

#### Page 406

which may be written as
$$
\eta=\frac{\sqrt{2}\angle 45^{\circ}}{\sigma\delta}=\frac{(1+j)}{\sigma\delta}\quad{(85)}
$$
Thus, if we write (80) in terms of the skin depth,
$$
E_{x}=E_{x0}e^{-z/\delta}\cos\left(\omega t-\frac{z}{\delta}\right)\quad{(86)}
$$
then
$$
H_{y}=\frac{\sigma\delta E_{x0}}{\sqrt{2}}e^{-z/\delta}\cos\left(\omega t-\frac{z}{\delta}-\frac{\pi}{4}\right)\quad{(87)}
$$
and we see that the maximum amplitude of the magnetic field intensity occurs one-eighth of a cycle later than the maximum amplitude of the electric field intensity at every point.

From (86) and (87) we may obtain the time-average Poynting vector by applying (77),
$$
\langle S_{z}\rangle=\frac{1}{2}\frac{\sigma\delta E_{x0}^{2}}{\sqrt{2}}e^{-2z/\delta}\cos\left(\frac{\pi}{4}\right)
$$
or
$$
\langle S_{z}\rangle=\frac{1}{4}\sigma\delta E_{x0}^{2}e^{-2z/\delta}
$$
We again note that in a distance of one skin depth the power density is only $e^{-2}$ = 0.135 of its value at the surface.

#### 11.4.4 Skin Effect Resistance in Conductors

We are now prepared to address the problem of frequency-dependent resistance in conductors, which is an important factor in the operation of transmission lin

[Truncated for analysis]

## Core Ideas

- The good-conductor impedance is $\eta=(1+j)/(\sigma\delta)$.
- Its phase is $45^\circ$.
- Both electric and magnetic fields decay as $e^{-z/\delta}$.
- The magnetic field lags the electric field by $\pi/4$.
- A $\pi/4$ phase difference equals one-eighth of a cycle.
- The average power density is $\langle S_z\rangle=(1/4)\sigma\delta E_{x0}^2e^{-2z/\delta}$.
- Power density falls to $0.135$ of its surface value after one skin depth.

## Source Anchors

- Equation (85) gives $\eta=\sqrt{2}\angle45^\circ/(\sigma\delta)=(1+j)/(\sigma\delta)$.
- Equation (86) expresses the electric field in terms of skin depth.
- Equation (87) gives the magnetic field with phase delay $\pi/4$.
- Page 406 states that the magnetic-field maximum occurs one-eighth cycle after the electric-field maximum.
- The derived average Poynting vector is $\langle S_z\rangle=(1/4)\sigma\delta E_{x0}^2e^{-2z/\delta}$.
- The source again identifies the one-skin-depth power factor as $e^{-2}=0.135$.

## Related Pages

- [[good-conductor-propagation-approximation|Good-Conductor Propagation Approximation]]
- [[skin-depth-and-field-confinement|Skin Depth and Field Confinement]]
- [[time-average-power-density-of-sinusoidal-waves|Time-Average Power Density of Sinusoidal Waves]]
- [[skin-effect-resistance|Skin-Effect Resistance]]

## Concept Dependencies

- derives-from: [[time-average-power-density-of-sinusoidal-waves|Time-Average Power Density of Sinusoidal Waves]]
- depends-on: [[skin-depth-and-field-confinement|Skin Depth and Field Confinement]]
