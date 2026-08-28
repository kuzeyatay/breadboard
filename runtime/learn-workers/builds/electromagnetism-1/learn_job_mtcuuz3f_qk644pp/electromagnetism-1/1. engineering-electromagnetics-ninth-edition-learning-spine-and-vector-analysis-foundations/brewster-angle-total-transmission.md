---
title: "1.264 Brewster-Angle Total Transmission"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 451", "Page 452", "Page 453", "Section 12.6: Total Reflection and Total Transmission of Obliquely Incident Waves", "Example 12.9", "Exercise D12.5"]
related: ["oblique-incidence-geometry-polarization", "phase-matching-reflection-law-snells-law", "polarization-dependent-fresnel-coefficients", "total-internal-reflection-critical-angle"]
---

# 1.264 Brewster-Angle Total Transmission

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 451, Page 452, Page 453, Section 12.6: Total Reflection and Total Transmission of Obliquely Incident Waves, Example 12.9, Exercise D12.5

A single dielectric interface can produce total transmission at a special angle, but only for p-polarized incidence. Setting the s-polarized reflection coefficient to zero would require equality of the two s-polarized effective impedances, and the source concludes that no incidence angle satisfies this condition for the stated dielectric case. For p polarization, setting $\Gamma_p=0$ yields a solvable matching condition. Using $\eta=\eta_0/n$ and Snell's law gives $\sin\theta_B=n_2/\sqrt{n_1^2+n_2^2}$. This Brewster angle is also called the polarization angle. When unpolarized or mixed-polarization light arrives at this angle, its p component is completely transmitted while the reflected light contains only the s component. Near the exact angle, reflected light remains predominantly s-polarized, which explains the polarization of glare from horizontal surfaces and the operation described for glare-reducing sunglasses. For air-to-glass transmission with $n_2=1.45$, the source obtains $\theta_B=55.4^\circ$ and a transmitted angle of $34.6^\circ$. These angles sum to $90^\circ$. Figure 12.10 shows the Brewster zero crossings for $\Gamma_p$ and the absence of such crossings for $\Gamma_s$.

## Page-Grounded Details

#### Page 451

Figure 12.9 A dielectric slab waveguide (symmetric case), showing light confinement to the center material by total reflection.

We next consider the possibility of total transmission. In this case, the requirement is simply that $\Gamma=0$. We investigate this possibility for the two polarizations. First, we consider s-polarization. If $\Gamma_{s}=0$, then from (71) we require that $\eta_{2s}=\eta_{1s}$, or
$$
\eta_{2}\sec\theta_{2}=\eta_{1}\sec\theta_{1}
$$
Using Snell's law to write $\theta_{2}$ in terms of $\theta_{1}$, the preceding equation becomes
$$
\eta_{2}\left[1-\left(\frac{n_{1}}{n_{2}}\right)^{2}\sin^{2}\theta_{1}\right]^{-1/2}=\eta_{1}\left[1-\sin^{2}\theta_{1}\right]^{-1/2}
$$
There is no value of $\theta_{1}$ that will satisfy this, so we turn instead to p-polarization. Using (67), (68), and (69), with Snell's law, we find that the condition for $\Gamma_{p}=0$ is
$$
\eta_{2}\left[1-\left(\frac{n_{1}}{n_{2}}\right)^{2}\sin^{2}\theta_{1}\right]^{1/2}=\eta_{1}\left[1-\sin^{2}\theta_{1}\right]^{1/2}
$$
This equation does have a solution, which is
$$
\sin\theta_{1}=\sin\theta_{B}=\frac{n_{2}}{\sqrt{n_{1}^{2}+n_{2}^{2}}}\quad{(79)}
$$
where we have u

[Truncated for analysis]

#### Page 452

Light is incident from air to glass at Brewster's angle. Determine the incident and transmitted angles.

Solution. Because glass has refractive index $n_{2}=1.45$, the incident angle will be
$$
\theta_{1}=\theta_{B}=\sin^{-1}\left(\frac{n_{2}}{\sqrt{n_{1}^{2}+n_{2}^{2}}}\right)=\sin^{-1}\left(\frac{1.45}{\sqrt{1.45^{2}+1}}\right)=55.4^{\circ}
$$
The transmitted angle is found from Snell's law, through
$$
\theta_{2}=\sin^{-1}\left(\frac{n_{1}}{n_{2}}\sin\theta_{B}\right)=\sin^{-1}\left(\frac{n_{1}}{\sqrt{n_{1}^{2}+n_{2}^{2}}}\right)=34.6^{\circ}
$$
Note from this exercise that $\sin\theta_{2}=\cos\theta_{B}$, which means that the sum of the incident and refracted angles at the Brewster condition is always $90^{\circ}$.

Many of the results we have seen in this section are summarized in Figure 12.10, in which $\Gamma_{p}$ and $\Gamma_{s}$, from (69) and (71), are plotted as functions of the incident angle, $\theta_{1}$. Curves are shown for selected values of the refractive index ratio, $n_{1}/n_{2}$. For all plots in which $n_{1}/n_{2}>1$, $\Gamma_{s}$ and $\Gamma_{p}$ achieve values of $\pm 1$ at the critical angle. At larger angles, the reflection coeffic

[Truncated for analysis]

#### Page 453

Figure 12.10 (a) Plots of $\Gamma_{p}$ [Eq. (69)] as functions of the incident angle, $\theta_{1}$, as shown in Figure 12.7a. Curves are shown for selected values of the refractive index ratio, $n_{1}/n_{2}$. Both media are lossless and have $\mu_{r}=1$. Thus $\eta_{1}=\eta_{0}/n_{1}$ and $\eta_{2}=\eta_{0}/n_{2}$. (b) Plots of $\Gamma_{s}$ [Eq. (71)] as functions of the incident angle, $\theta_{1}$, as shown in Figure 12.7b. As in Figure 12.10a, the media are lossless, and curves are shown for selected $n_{1}/n_{2}$.

## Core Ideas

- Total transmission at one dielectric interface requires $\Gamma=0$.
- No corresponding total-transmission angle exists for s polarization in the stated case.
- The p-polarized Brewster condition is $\sin\theta_B=n_2/\sqrt{n_1^2+n_2^2}$.
- At $\theta_B$, the p component is fully transmitted.
- The reflected light at the Brewster angle is entirely s-polarized.
- The Brewster incident and refracted angles sum to $90^\circ$.
- Polarizing sunglasses suppress predominantly horizontal reflected glare.

## Source Anchors

- Equation (79) gives
$$
\sin\theta_B=\frac{n_2}{\sqrt{n_1^2+n_2^2}}
$$
- Page 451 states that the s-polarized zero-reflection condition has no angle solution.
- Page 451 explains why mixed-polarization light reflected at the Brewster angle is entirely s-polarized.
- The air-to-glass example obtains $\theta_B=55.4^\circ$ and $\theta_2=34.6^\circ$.
- Page 452 notes that the incident and refracted angles at the Brewster condition sum to $90^\circ$.
- Figure S1.P453.F1, corresponding to Figure 12.10, plots $\Gamma_p$ and $\Gamma_s$ against incidence angle for several index ratios.
- Exercise D12.5 gives the s-polarized reflection coefficient $-0.355$ for the Brewster-angle example.

## Related Pages

- [[oblique-incidence-geometry-polarization|Oblique-Incidence Geometry and Polarization]]
- [[phase-matching-reflection-law-snells-law|Phase Matching, Reflection Law, and Snell's Law]]
- [[polarization-dependent-fresnel-coefficients|Polarization-Dependent Fresnel Coefficients]]
- [[total-internal-reflection-critical-angle|Total Internal Reflection and Critical Angle]]

## Concept Dependencies

- applies-to: [[polarization-dependent-fresnel-coefficients|Polarization-Dependent Fresnel Coefficients]]
- depends-on: [[oblique-incidence-geometry-polarization|Oblique-Incidence Geometry and Polarization]]
- contrasts-with: [[total-internal-reflection-critical-angle|Total Internal Reflection and Critical Angle]]
