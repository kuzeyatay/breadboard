---
title: "1.225 Conductivity as Imaginary Permittivity"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 394", "Page 395", "Page 396, Figure 11.2"]
related: ["microwave-absorption-and-penetration-in-water", "good-dielectric-approximation", "good-conductor-propagation-approximation", "poynting-vector-and-electromagnetic-energy-conservation"]
---

# 1.225 Conductivity as Imaginary Permittivity

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 394, Page 395, Page 396, Figure 11.2

In a conducting medium, free charge carriers move under an electric field and produce conduction current according to $\mathbf{J}=\sigma\mathbf{E}$. The Maxwell curl equation can represent loss either through a complex permittivity $\epsilon'-j\epsilon''$ or by explicitly separating conduction and displacement currents. Writing $\nabla\times\mathbf{H}_s=(\sigma+j\omega\epsilon')\mathbf{E}_s$ and comparing it with $\nabla\times\mathbf{H}_s=j\omega(\epsilon'-j\epsilon'')\mathbf{E}_s$ gives $\epsilon''=\sigma/\omega$. The loss tangent is therefore $\epsilon''/\epsilon'=\sigma/(\omega\epsilon')$. It also equals the magnitude ratio of conduction current density to displacement current density. These currents point in the same spatial direction but differ in time phase by $90^\circ$, with displacement current leading conduction current. Figure 11.2 organizes the phasor relationship among $\mathbf{J}_{ds}$, $\mathbf{J}_{\sigma s}$, total current $\mathbf{J}_s$, and $\mathbf{E}_s$. The angle $\theta$ satisfies $\tan\theta=\sigma/(\omega\epsilon')$, explaining the name loss tangent. The reciprocal of this quantity is identified as the quality factor $Q$ of a capacitor containing the lossy dielectric.

## Page-Grounded Details

#### Page 394

### EXAMPLE 11.4

We again consider plane wave propagation in water, but at the much higher microwave frequency of 2.5 GHz. At frequencies in this range and higher, dipole relaxation and resonance phenomena in the water molecules become important.^2 Real and imaginary parts of the permittivity are present, and both vary with frequency. At frequencies below that of visible light, the two mechanisms together produce a value of $e^{\prime\prime}$ that increases with increasing frequency, reaching a maximum in the vicinity of $10^{13}$ Hz. $e^{\prime}$ decreases with increasing frequency, reaching a minimum also in the vicinity of $10^{13}$ Hz. Reference 3 provides specific details. At 2.5 GHz, dipole relaxation effects dominate. The permittivity values are $\epsilon_{r}^{\prime}=78$ and $\epsilon_{r}^{\prime\prime}=7$. From (44), we have
$$
\alpha=\frac{(2\pi\times 2.5\times 10^{9})\sqrt{78}}{(3.0\times 10^{8})\sqrt{2}}\left(\sqrt{1+\left(\frac{7}{78}\right)^{2}}-1\right)^{1/2}=21~{}\mathrm{Np/m}
$$
This first calculation demonstrates the operating principle of the microwave oven. Almost all foods contain water, and so they can be cooked when incident microwave radiation

[Truncated for analysis]

#### Page 395

Consider the Maxwell curl equation (23) which, using (42), becomes:
$$
\nabla\times H_{s}=j\omega(\epsilon^{\prime}-j\epsilon^{\prime\prime})E_{s}=\omega\epsilon^{\prime\prime}E_{s}+j\omega\epsilon^{\prime}E_{s}\qquad(53)
$$
This equation can be expressed in a more familiar way, in which conduction current is included:
$$
\nabla\times H_{s}=J_{s}+j\omega\epsilon E_{s}\qquad(54)
$$
We next use $J_{s}=\sigma\,E_{s}$, and interpret $\epsilon$ in (54) as $\epsilon^{\prime}$. The latter equation becomes:
$$
\nabla\times H_{s}=(\sigma+j\omega\epsilon^{\prime})E_{s}=J_{\sigma s}+J_{ds}\qquad(55)
$$
which we have expressed in terms of conduction current density, $J_{\sigma s}=\sigma\,E_{s}$, and displacement current density, $J_{ds}=j\omega\epsilon^{\prime}E_{s}$. Comparing Eqs. (53) and (55), we find that in a conductive medium:
$$
\epsilon^{\prime\prime}=\frac{\sigma}{\omega}\qquad(56)
$$
We next turn our attention to the case of a dielectric material in which the loss is very small. The criterion by which we should judge whether or not the loss is small is the magnitude of the loss tangent, $\epsilon^{\prime\prime}/\epsilon^{\prime}$. This parameter will have a direc

[Truncated for analysis]

#### Page 396

Figure11.2 The time-phase relationship between $J_{ds}$, $J_{\sigma s}$, $J_{s}$, and $E_{s}$. The tangent of $\theta$ is equal to $\sigma/\omega\epsilon'$, and $90^{\circ}$ - $\theta$ is the common power-factor angle, or the angle by which $J_{s}$ leads $E_{s}$.

loss tangent is $\epsilon''/\epsilon'\ll 1$, which we say identifies the medium as a good dielectric. Considering a conductive material, for which $\epsilon''=\sigma/\omega$, (43) becomes
$$
jk=j\omega\sqrt{\mu\epsilon'}\sqrt{1-j\frac{\sigma}{\omega\epsilon'}}\quad{(59)}
$$
We may expand the second radical using the binomial theorem
$$
(1+x)^{n}=1+nx+\frac{n(n-1)}{2!}x^{2}+\frac{n(n-1)(n-2)}{3!}x^{3}+\cdots
$$
where $|x|\ll 1$. We identify $x$ as $-j\sigma/\omega\epsilon'$ and $n$ as 1/2, and thus
$$
jk=j\omega\sqrt{\mu\epsilon'}\left[1-j\frac{\sigma}{2\omega\epsilon'}+\frac{1}{8}\left(\frac{\sigma}{\omega\epsilon'}\right)^{2}+\cdots\right]=\alpha+j\beta
$$
Now, for a good dielectric,
$$
\alpha=\mathcal{R}e(jk)\doteq j\omega\sqrt{\mu\epsilon'}\left(-j\frac{\sigma}{2\omega\epsilon'}\right)=\frac{\sigma}{2}\sqrt{\frac{\mu}{\epsilon'}}\quad{(60a)}
$$
and
$$ \beta=\mathcal{F}m(jk)\dote

[Truncated for analysis]

## Core Ideas

- Conduction current obeys $\mathbf{J}_{\sigma s}=\sigma\mathbf{E}_s$.
- Displacement current is $\mathbf{J}_{ds}=j\omega\epsilon'\mathbf{E}_s$.
- Conductivity contributes an imaginary permittivity $\epsilon''=\sigma/\omega$.
- The loss tangent is $\tan\theta=\epsilon''/\epsilon'=\sigma/(\omega\epsilon')$.
- The loss tangent measures the conduction-current to displacement-current magnitude ratio.
- Displacement current leads conduction current by $90^\circ$.
- The capacitor quality factor for a lossy dielectric is the reciprocal of the loss tangent.

## Source Anchors

- Equations (53) through (55) present equivalent complex-permittivity and explicit-current forms of the Maxwell curl equation.
- Equation (56) gives $\epsilon''=\sigma/\omega$.
- Equation (57) gives $\mathbf{J}_{\sigma s}/\mathbf{J}_{ds}=\sigma/(j\omega\epsilon')$.
- Equation (58) gives $\tan\theta=\epsilon''/\epsilon'=\sigma/(\omega\epsilon')$.
- Figure 11.2 shows the time-phase relationship among displacement, conduction, total current, and electric field.
- The caption of Figure 11.2 identifies $90^\circ-\theta$ as the power-factor angle by which total current leads the electric field.

## Related Pages

- [[microwave-absorption-and-penetration-in-water|Microwave Absorption and Penetration in Water]]
- [[good-dielectric-approximation|Good-Dielectric Approximation]]
- [[good-conductor-propagation-approximation|Good-Conductor Propagation Approximation]]
- [[poynting-vector-and-electromagnetic-energy-conservation|Poynting Vector and Electromagnetic Energy Conservation]]

## Concept Dependencies

- enables: [[good-dielectric-approximation|Good-Dielectric Approximation]]
- enables: [[good-conductor-propagation-approximation|Good-Conductor Propagation Approximation]]
