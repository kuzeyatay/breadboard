---
title: "1.263 Total Internal Reflection and Critical Angle"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 449", "Page 450", "Page 451", "Section 12.6: Total Reflection and Total Transmission of Obliquely Incident Waves", "Example 12.8"]
related: ["phase-matching-reflection-law-snells-law", "polarization-dependent-fresnel-coefficients", "oblique-incidence-geometry-polarization", "brewster-angle-total-transmission"]
---

# 1.263 Total Internal Reflection and Critical Angle

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 449, Page 450, Page 451, Section 12.6: Total Reflection and Total Transmission of Obliquely Incident Waves, Example 12.8

Total internal reflection occurs when a wave travels from a higher-index medium toward a lower-index medium at a sufficiently large incidence angle. Snell's law gives $\cos\theta_2=[1-(n_1/n_2)^2\sin^2\theta_1]^{1/2}$. When $\sin\theta_1>n_2/n_1$, this quantity becomes imaginary, as do the polarization-dependent effective impedances in the second medium. Substitution into the reflection formulas produces a complex reflection coefficient with unit magnitude, so all incident power is reflected even though the coefficient may carry a nontrivial phase. The threshold is the critical angle, defined by $\sin\theta_c=n_2/n_1$, and total reflection occurs for $\theta_1\geq\theta_c$. This condition requires $n_1>n_2$. Example 12.8 applies the rule to a prism that turns a beam through $90^\circ$ using a $45^\circ$ internal incidence angle. With air outside, the prism requires $n_1\geq\sqrt{2}=1.41$, so fused silica with index 1.45 is suitable. The same mechanism confines light in slab and optical-fiber waveguides by placing a higher-index core between lower-index cladding regions.

## Page-Grounded Details

#### Page 449

#### 12.6 TOTAL REFLECTION AND TOTAL TRANSMISSION OF OBLIQUELY INCIDENT WAVES

Now that we have methods available to us for solving problems involving oblique incidence reflection and transmission, we can explore the special cases of total reflection and total transmission. We look for special combinations of media, incidence angles, and polarizations that produce these properties. To begin, we identify the necessary condition for total reflection. We want total power reflection, so that $|\Gamma|^{2}=\Gamma\Gamma^{*}=1$, where $\Gamma$ is either $\Gamma_{p}$ or $\Gamma_{s}$. The fact that this condition involves the possibility of a complex $\Gamma$ allows some flexibility. For the incident medium, we note that $\eta_{1p}$ and $\eta_{1s}$ will always be real and positive. On the other hand, when we consider the second medium, $\eta_{2p}$ and $\eta_{2s}$ involve factors of $\cos\theta_{2}$ or $1/\cos\theta_{2}$, where
$$
\cos\theta_{2}=\left[1-\sin^{2}\theta_{2}\right]^{1/2}=\left[1-\left(\frac{n_{1}}{n_{2}}\right)^{2}\sin^{2}\theta_{1}\right]^{1/2}\quad{(75)}
$$
where Snell's law has been used. We observe that $\cos\theta_{2}$, and hence $\eta_{2p}$ and

[Truncated for analysis]

#### Page 450

Figure 12.8 Beam-steering prism for Example 12.8.

#### EXAMPLE 12.8

A prism is to be used to turn a beam of light by 90 deg, as shown in Figure 12.8. Light enters and exits the prism through two antireflective (AR-coated) surfaces. Total reflection is to occur at the back surface, where the incident angle is 45 deg to the normal. Determine the minimum required refractive index of the prism material if the surrounding region is air.

*Solution.* Considering the back surface, the medium beyond the interface is air, with $n_{2}=1.00$. Because $\theta_{1}=45^{\circ}$, (76) is used to obtain
$$
n_{1} \geq \frac{n_{2}}{\sin 45^{\circ}}=\sqrt{2}=1.41
$$
Because fused silica glass has refractive index $n_{g}=1.45$, it is a suitable material for this application and is in fact widely used.

Another important application of total reflection is in _optical waveguides_. These, in their simplest form, are constructed of three layers of glass, in which the middle layer has a slightly higher refractive index than the outer two. Figure 12.9 shows the basic structure. Light, propagating from left to right, is confined to the middle layer by total reflection at the two interfaces, as shown

[Truncated for analysis]

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

## Core Ideas

- Total reflection requires $|\Gamma|^2=1$.
- The condition is $\sin\theta_1\geq n_2/n_1$.
- The critical angle satisfies $\sin\theta_c=n_2/n_1$.
- Total internal reflection occurs for $\theta_1\geq\theta_c$.
- The incident medium must have the higher refractive index: $n_1>n_2$.
- Above the critical angle, the transmitted-angle cosine and effective impedance become imaginary.
- Prisms and dielectric waveguides use total internal reflection.

## Source Anchors

- Equation (75) gives
$$
\cos\theta_2=\left[1-\left(\frac{n_1}{n_2}\right)^2\sin^2\theta_1\right]^{1/2}
$$
- Equation (76) gives the total-reflection condition $\sin\theta_1\geq n_2/n_1$.
- Equation (77) defines $\sin\theta_c=n_2/n_1$.
- Equation (78) states $\theta_1\geq\theta_c$ for total reflection.
- Figure S1.P450.F1, corresponding to Figure 12.8, shows the 90-degree beam-steering prism.
- Example 12.8 obtains a minimum prism index of $\sqrt{2}=1.41$ and identifies fused silica at 1.45 as suitable.
- Figure S1.P451.F1, corresponding to Figure 12.9, shows confinement in a symmetric dielectric slab waveguide.

## Related Pages

- [[phase-matching-reflection-law-snells-law|Phase Matching, Reflection Law, and Snell's Law]]
- [[polarization-dependent-fresnel-coefficients|Polarization-Dependent Fresnel Coefficients]]
- [[oblique-incidence-geometry-polarization|Oblique-Incidence Geometry and Polarization]]
- [[brewster-angle-total-transmission|Brewster-Angle Total Transmission]]

## Concept Dependencies

- depends-on: [[phase-matching-reflection-law-snells-law|Phase Matching, Reflection Law, and Snell's Law]]
- applies-to: [[polarization-dependent-fresnel-coefficients|Polarization-Dependent Fresnel Coefficients]]
