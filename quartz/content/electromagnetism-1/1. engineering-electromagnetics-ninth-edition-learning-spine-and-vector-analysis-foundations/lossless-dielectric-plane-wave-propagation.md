---
title: "1.222 Lossless Dielectric Plane-Wave Propagation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 392", "Page 393"]
related: ["fresh-water-plane-wave-calculation", "microwave-absorption-and-penetration-in-water", "poynting-vector-and-electromagnetic-energy-conservation", "linear-polarization-and-orthogonal-field-decomposition"]
---

# 1.222 Lossless Dielectric Plane-Wave Propagation

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 392, Page 393

A uniform plane wave in a general lossy medium has a propagation constant with attenuation coefficient $\alpha$ and phase constant $\beta$, and its wavelength is defined by $\lambda=2\pi/\beta$. The magnetic-field phasor is related to the electric-field phasor through the intrinsic impedance $\eta$, which is complex when the permittivity has a nonzero imaginary part. In the special case of a lossless medium, $\epsilon''=0$, so $\alpha=0$ and $\beta=\omega\sqrt{\mu\epsilon'}$. The real electric field then has the traveling-wave form $E_x=E_{x0}\cos(\omega t-\beta z)$. Its phase velocity is $v_p=\omega/\beta=1/\sqrt{\mu\epsilon'}$, and its wavelength is $\lambda=1/(f\sqrt{\mu\epsilon'})$. Expressed relative to free space, $v_p=c/\sqrt{\mu_r\epsilon'_r}$ and $\lambda=\lambda_0/\sqrt{\mu_r\epsilon'_r}$. The corresponding magnetic field is $H_y=(E_{x0}/\eta)\cos(\omega t-\beta z)$, with real intrinsic impedance $\eta=\sqrt{\mu/\epsilon'}$. Thus $\mathbf{E}$, $\mathbf{H}$, and the propagation direction are mutually perpendicular, and the electric and magnetic fields are in phase.

## Page-Grounded Details

#### Page 392

which leads to the fundamental definition of wavelength,
$$
\lambda=\frac{2\pi}{\beta}\qquad(47)
$$
Because we have a uniform plane wave, the magnetic field is found through
$$
H_{ys}=\frac{E_{x0}}{\eta}e^{-\alpha z}e^{-j\beta z}
$$
where the intrinsic impedance is now a complex quantity,
$$
\eta=\sqrt{\frac{\mu}{\epsilon^{\prime}-j\epsilon^{\prime\prime}}}=\sqrt{\frac{\mu}{\epsilon^{\prime}}}\frac{1}{\sqrt{1-j(\epsilon^{\prime\prime}/\epsilon^{\prime})}}\qquad(48)
$$
The electric and magnetic fields are no longer in phase.

A special case is that of a lossless medium, or perfect dielectric, in which $\epsilon^{\prime\prime}=0$, and so $\epsilon=\epsilon^{\prime}$. From (44), this leads to $\alpha=0$, and from (45),
$$
\beta=\omega\sqrt{\mu\epsilon^{\prime}}\qquad\text{(lossless medium)}\qquad(49)
$$
With $\alpha=0$, the real field assumes the form
$$
E_{x}=E_{x0}\cos(\omega t-\beta z)\qquad(50)
$$
We may interpret this as a wave traveling in the $+z$ direction at a phase velocity $v_{p}$, where
$$
v_{p}=\frac{\omega}{\beta}=\frac{1}{\sqrt{\mu\epsilon^{\prime}}}=\frac{c}{\sqrt{\mu_{r}\epsilon^{\prime}_{r}}}
$$
The wavelength is
$$
\lambda=\frac{2\pi}{\beta}

[Truncated for analysis]

#### Page 393

The two fields are once again perpendicular to each other, perpendicular to the direction of propagation, and in phase with each other everywhere. Note that when E is crossed into H, the resultant vector is in the direction of propagation. We shall see the reason for this when we discuss the Poynting vector.

​// Example 11.3

Let us apply these results to a 1-MHz plane wave propagating in fresh water. At this frequency, losses in water are negligible, which means that we can assume that $\epsilon^{\prime\prime}\doteq 0$. In water, $\mu_{r}=1$ and at 1 MHz, $\epsilon_{r}^{\prime}=81$.

Solution. We begin by calculating the phase constant. Using (45) with $\epsilon^{\prime\prime}=0$, we have
$$
 \beta=\omega\sqrt{\mu\epsilon^{\prime}}=\omega\sqrt{\mu_{0}\epsilon_{0}}\,\sqrt{\epsilon_{r}^{\prime}}=\frac{\omega\sqrt{\epsilon_{r}^{\prime}}}{c}=\frac{2\pi\times 10^{6}\sqrt{81}}{3.0\times 10^{8}}=0.19\,\mathrm{rad/m}
$$
Using this result, we can determine the wavelength and phase velocity:
$$
 \lambda=\frac{2\pi}{\beta}=\frac{2\pi}{.19}=33\mathrm{~m}
$$
$$
 v_{p}=\frac{\omega}{\beta}=\frac{2\pi\times 10^{6}}{.19}=3.3\times 10^{7}\,\mathrm{m/s} $$
The wavelength in air would hav

[Truncated for analysis]

## Core Ideas

- Wavelength is defined by $\lambda=2\pi/\beta$.
- A lossless dielectric satisfies $\epsilon''=0$ and therefore $\alpha=0$.
- The lossless-medium phase constant is $\beta=\omega\sqrt{\mu\epsilon'}$.
- The phase velocity is $v_p=1/\sqrt{\mu\epsilon'}=c/\sqrt{\mu_r\epsilon'_r}$.
- The wavelength is $\lambda=\lambda_0/\sqrt{\mu_r\epsilon'_r}$.
- The intrinsic impedance is real: $\eta=\sqrt{\mu/\epsilon'}$.
- The vectors $\mathbf{E}$ and $\mathbf{H}$ are perpendicular to each other and to the propagation direction.
- For positive $z$ propagation, $\mathbf{E}\times\mathbf{H}$ points in the positive $z$ direction.

## Source Anchors

- Equation (47) defines $\lambda=2\pi/\beta$.
- Equation (48) gives $\eta=\sqrt{\mu/(\epsilon'-j\epsilon'')}$ for a lossy medium.
- Equations (49) and (50) give $\beta=\omega\sqrt{\mu\epsilon'}$ and $E_x=E_{x0}\cos(\omega t-\beta z)$ when $\epsilon''=0$.
- Equation (51) gives $\lambda=c/(f\sqrt{\mu_r\epsilon'_r})=\lambda_0/\sqrt{\mu_r\epsilon'_r}$.
- Equation (52) identifies the lossless intrinsic impedance as $\eta=\sqrt{\mu/\epsilon'}$.
- Page 393 states that the two fields are mutually perpendicular, perpendicular to propagation, and in phase.

## Related Pages

- [[fresh-water-plane-wave-calculation|Fresh-Water Plane-Wave Calculation]]
- [[microwave-absorption-and-penetration-in-water|Microwave Absorption and Penetration in Water]]
- [[poynting-vector-and-electromagnetic-energy-conservation|Poynting Vector and Electromagnetic Energy Conservation]]
- [[linear-polarization-and-orthogonal-field-decomposition|Linear Polarization and Orthogonal Field Decomposition]]

