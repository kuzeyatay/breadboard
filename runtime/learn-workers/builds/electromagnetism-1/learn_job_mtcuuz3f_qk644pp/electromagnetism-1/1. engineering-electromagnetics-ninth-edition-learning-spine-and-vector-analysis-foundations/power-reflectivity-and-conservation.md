---
title: "1.248 Power Reflectivity and Conservation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 426, Example 12.1 setup", "Page 427, Example 12.1 power calculation and Equation (15)", "Page 428, transmitted-power relations, Equation (17), and D12.1"]
related: ["reflection-and-transmission-coefficients", "incident-reflected-and-transmitted-plane-waves", "standing-wave-ratio-and-extremum-locations", "plane-wave-field-and-power-analysis-procedures", "multiple-interface-reflection"]
---

# 1.248 Power Reflectivity and Conservation

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 426, Example 12.1 setup, Page 427, Example 12.1 power calculation and Equation (15), Page 428, transmitted-power relations, Equation (17), and D12.1

Field-amplitude coefficients do not directly equal power fractions because average power depends on both electric and magnetic fields and therefore on intrinsic impedance. For the reflected wave in region 1, the source derives the general result
$$
\langle S_{1r}\rangle=|\Gamma|^2\langle S_{1i}\rangle
$$
 Thus $|\Gamma|^2$ is the reflected fraction of incident power. A direct transmitted-power expression contains the real parts of reciprocal complex impedances and $|\tau|^2$, so energy conservation often gives the simpler relation
$$
\langle S_2\rangle=(1-|\Gamma|^2)\langle S_{1i}\rangle
$$
 Example 12.1 uses $\eta_1=100\ \Omega$, $\eta_2=300\ \Omega$, and incident electric amplitude $100\ \mathrm{V/m}$. It obtains $\Gamma=0.5$, reflected amplitude $50\ \mathrm{V/m}$, and transmitted amplitude $150\ \mathrm{V/m}$. The incident, reflected, and transmitted average power densities are respectively $50$, $12.5$, and $37.5\ \mathrm{W/m^2}$, confirming power conservation.

## Page-Grounded Details

#### Page 426

Figure 12.2 The instantaneous values of the total field $E_{x1}$ are shown at $\omega t=\pi/2$. $E_{x1}=0$ for all time at multiples of one half-wavelength from the conducting surface.

#### 12.1.4 Partial Reflection and Power Reflectivity

Now suppose that perfect dielectrics exist in both regions 1 and 2, so that $\eta_{1}$ and $\eta_{2}$ are both real positive quantities and $\alpha_{1}=\alpha_{2}=0$. Equation (9) enables us to calculate the reflection coefficient and find $E_{x1}^{-}$ in terms of the incident field $E_{x1}^{+}$. Knowing $E_{x1}^{+}$ and $E_{x1}^{-}$, we then find $H_{y1}^{+}$ and $H_{y1}^{-}$. In region 2, $E_{x2}^{+}$ is found from (10), and this then determines $H_{y2}^{+}$.

#### EXAMPLE 12.1

As a numerical example we select
$$
\begin{array}[]{rcl}\eta_{1}&=&100~{}\Omega\\\eta_{2}&=&300~{}\Omega\\ E_{x10}^{+}&=&100~{}\text{V/m}\end{array}
$$
and calculate values for the incident, reflected, and transmitted waves.

**Solution.** The reflection coefficient is
$$
\Gamma=\frac{300-100}{300+100}=0.5
$$
and thus
$$
E_{x10}^{-}=50~{}\text{V/m}
$$
#### Page 427

The magnetic field intensities are
$$
H_{y10}^{+}=\frac{100}{100}=1.00A/m
$$
$$
H_{y10}^{-}=-\frac{50}{100}=-0.50A/m
$$
Using Eq.(77) from Chapter 11, we find that the magnitude of the average incident power density is
$$
\langle S_{1i}\rangle=\left|\frac{1}{2}\mathcal{R}e\{\mathbf{E}_{s}\times\mathbf{H}_{s}^{*}\}\right|=\frac{1}{2}E_{x10}^{+}H_{y10}^{+}=50W/m^{2}
$$
The average reflected power density is
$$
\langle S_{1r}\rangle=-\frac{1}{2}E_{x10}^{-}H_{y10}^{-}=12.5W/m^{2}
$$
In region 2, using(10),
$$
E_{x20}^{+}=\tau E_{x10}^{+}=150V/m
$$
and
$$
H_{y20}^{+}=\frac{150}{300}=0.500A/m
$$
Therefore, the average power density that is transmitted through the boundary into region 2 is
$$
\langle S_{2}\rangle=\frac{1}{2}E_{x20}^{+}H_{y20}^{+}=37.5W/m^{2}
$$
We may check and confirm the power conservation requirement:
$$
\langle S_{1i}\rangle=\langle S_{1r}\rangle+\langle S_{2}\rangle
$$
A general rule on the transfer of power through reflection and transmission can be formulated. We consider the same field vector and interface orientations as before, but allow for the case of complex impedances. For the incident power density, we have
$$
\langle S_{1i}\rangle=\frac{1}{

[Truncated for analysis]

#### Page 428

and so we see that the incident and transmitted power densities are related through
$$
 \langle S_{2}\rangle=\frac{\mathcal{R}e^{\{1/\eta_{2}^{*}\}}}{\mathcal{R}e^{\{1/\eta_{1}^{*}\}}}|\tau|^{2}\langle S_{1i}\rangle=|\frac{\eta_{1}}{\eta_{2}}|^{2}\left(\frac{\eta_{2}+\eta_{2}^{*}}{\eta_{1}+\eta_{1}^{*}}\right)|\tau|^{2}\langle S_{1i}\rangle
$$
Equation (16) is a relatively complicated way to calculate the transmitted power, unless the impedances are real. It is easier to take advantage of energy conservation by noting that whatever power is not reflected must be transmitted. Eq. (15) can be used to find
$$
 \langle S_{2}\rangle=(1-|\Gamma|^{2})\langle S_{1i}\rangle $$
(17)

As would be expected (and which must be true), Eq. (17) can also be derived from Eq. (16).

D12.1. A 1-MHz uniform plane wave is normally incident onto a fresh water lake ( $\epsilon_{r}^{\prime}=78$, $\epsilon_{r}^{\prime\prime}=0$, $\mu_{r}=1$ ). Determine the fraction of the incident power that is (a) reflected and (b) transmitted. (c) Determine the amplitude of the electric field that is transmitted into the lake.

Ans. (a) 0.63; (b) 0.37; (c) 0.20 V/m

#### 12.2 STANDING WAVE RATIO

In cases where $

[Truncated for analysis]

## Core Ideas

- Average power density is calculated from $(1/2)\operatorname{Re}\{\mathbf{E}_s\times\mathbf{H}_s^*\}$.
- The reflected power fraction is $|\Gamma|^2$.
- The transmitted power fraction is $1-|\Gamma|^2$ when conservation applies to the interface balance.
- The transmitted electric-field amplitude can exceed the incident amplitude when the second impedance is larger.
- A larger transmitted electric amplitude does not imply creation of power because the associated magnetic field changes with impedance.
- Incident power equals reflected plus transmitted power in Example 12.1.

## Source Anchors

- Example 12.1 calculates $\Gamma=0.5$ from $\eta_1=100\ \Omega$ and $\eta_2=300\ \Omega$.
- The example gives $E_{x10}^{-}=50\ \mathrm{V/m}$ and $E_{x20}^{+}=150\ \mathrm{V/m}$.
- The calculated powers are $50$, $12.5$, and $37.5\ \mathrm{W/m^2}$.
- Equation (15) gives $\langle S_{1r}\rangle=|\Gamma|^2\langle S_{1i}\rangle$.
- Equation (17) gives $\langle S_2\rangle=(1-|\Gamma|^2)\langle S_{1i}\rangle$.
- Drill D12.1 applies the power fractions to a 1 MHz wave incident on fresh water.

## Related Pages

- [[reflection-and-transmission-coefficients|Reflection and Transmission Coefficients]]
- [[incident-reflected-and-transmitted-plane-waves|Incident, Reflected, and Transmitted Plane Waves]]
- [[standing-wave-ratio-and-extremum-locations|Standing-Wave Ratio and Extremum Locations]]
- [[plane-wave-field-and-power-analysis-procedures|Plane-Wave Field and Power Analysis Procedures]]
- [[multiple-interface-reflection|Multiple-Interface Reflection]]

## Concept Dependencies

- related: [[standing-wave-ratio-and-extremum-locations|Standing-Wave Ratio and Extremum Locations]]
- related: [[multiple-interface-reflection|Multiple-Interface Reflection]]
