---
title: "1.194 Smith Chart Impedance and Reflection-Coefficient Mapping"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 348", "Page 349"]
related: ["constant-resistance-and-constant-reactance-circles", "reading-reflection-coefficient-from-the-smith-chart", "smith-chart-motion-along-a-lossless-line"]
---

# 1.194 Smith Chart Impedance and Reflection-Coefficient Mapping

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 348, Page 349

The Smith chart reduces repeated complex-number calculations by representing normalized impedance through the reflection coefficient plane. Its polar coordinates are $|\Gamma|$ and the reflection phase $\phi$, while its rectangular coordinates are $\Gamma_r$ and $\Gamma_i$. Passive loads lie on or within the unit circle because $|\Gamma|\leq1$. The construction begins with
$$
\Gamma=\frac{Z_L-Z_0}{Z_L+Z_0}
$$
 Normalizing the load as $z_L=Z_L/Z_0=r+jx$ removes the particular characteristic impedance and produces
$$
\Gamma=\frac{z_L-1}{z_L+1},\qquad z_L=\frac{1+\Gamma}{1-\Gamma}
$$
 This bilinear transformation maps impedance values into the bounded reflection-coefficient disk. Figure 10.9 establishes the coordinate systems and the $|\Gamma|=1$ boundary. Although reflection-coefficient contours are not drawn directly because they would clutter the chart, magnitude is found by radial distance and phase by the counterclockwise angle from the positive $\Gamma_r$ axis.

## Page-Grounded Details

#### Page 348

and the reflected wave is equal in amplitude to the incident wave. Hence, it should not surprise us to see that the VSWR is
$$
s=\frac{1+\left|-j1\right|}{1-\left|-j1\right|}=\infty
$$
and the input impedance is a pure reactance,
$$
Z_{in}=300\frac{-j300\cos 288^{\circ}+j300\sin 288^{\circ}}{300\cos 288^{\circ}+j\left(-j300\right)\sin 288^{\circ}}=j589
$$
Thus, no average power can be delivered to the input impedance by the source, and therefore no average power can be delivered to the load.

Although we could continue to find many other facts and figures for these examples, much of the work may be done more easily for problems of this type by using graphical techniques. We encounter these in Section 10.13.

D10.4. A 50-ohm lossless line has a length of 0.4$\lambda$. The operating frequency is 300 MHz. A load $Z_{L}=40+j30~{}\Omega$ is connected at $z=0$, and the Thevenin-equivalent source at $z=-l$ is $12\angle 0^{\circ}$ V in series with $Z_{Th}=50+j0~{}\Omega$. Find: (a) $\Gamma$; (b) s; (c) $Z_{in}$.

Ans. (a) $0.333\angle 90^{\circ}$; (b) 2.00; (c) 25.5 + j 5.90 $\Omega$

D10.5. For the transmission line of Problem D10.4, also find: (a) the phasor volta

[Truncated for analysis]

#### Page 349

Figure 10.9 The polar coordinates of the Smith chart are the magnitude and phase angle of the reflection coefficient; the rectangular coordinates are the real and imaginary parts of the reflection coefficient. The entire chart lies within the circle $|\Gamma|=1$.

coefficient are very quickly determined. As a matter of fact, the diagram is constructed within a circle of unit radius, using polar coordinates, with radius variable $|\Gamma|$ and counterclockwise angle variable $\phi$ , where $\Gamma=|\Gamma|e^{j\phi}$ . Figure 10.9 shows this circle. Since $|\Gamma|<1$ , all our information must lie on or within the unit circle. Peculiarly enough, the reflection coefficient itself will not be plotted on the final chart, for these additional contours would make the chart very difficult to read.

The basic relationship upon which the chart is constructed is
$$
\Gamma={\frac{Z_{L}-Z_{0}}{Z_{L}+Z_{0}}}\quad{(106)}
$$
The impedances that we plot on the chart will be normalized with respect to the char-acteristic impedance. The normalized load impedance, $z_{L}$ , is
$$
z_{L}=r+jx={\frac{Z_{L}}{Z_{0}}}={\frac{R_{L}+jX_{L}}{Z_{0}}}
$$
and thus
$$
\Gamma={\frac{z_{L}-1}{z_{L}+1

[Truncated for analysis]

## Core Ideas

- Normalize impedance using $z_L=Z_L/Z_0=r+jx$.
- Use
$$
\Gamma=\frac{z_L-1}{z_L+1}
$$
to map normalized impedance to reflection coefficient.
- Use
$$
z_L=\frac{1+\Gamma}{1-\Gamma}$$ for the inverse transformation.
- The radial coordinate is $|\Gamma|$.
- The angular coordinate is $\phi$ in $\Gamma=|\Gamma|e^{j\phi}$.
- The rectangular chart coordinates are $\Gamma_r$ and $\Gamma_i$.
- Passive-load information lies inside or on $|\Gamma|=1$.

## Source Anchors

- Page 348 introduces the Smith chart as a graphical method for complex transmission-line calculations.
- Source figure S1.P349.F1, Figure 10.9, identifies polar and rectangular reflection-coefficient coordinates and the unit-circle boundary.
- Page 349 gives $\Gamma=(Z_L-Z_0)/(Z_L+Z_0)$ as Eq. (106).
- Page 349 defines $z_L=r+jx=Z_L/Z_0$.
- Page 349 gives the normalized forward and inverse mappings, including Eq. (107).
- Page 349 explains that explicit reflection-coefficient contours are omitted to preserve readability.

## Related Pages

- [[constant-resistance-and-constant-reactance-circles|Constant-Resistance and Constant-Reactance Circles]]
- [[reading-reflection-coefficient-from-the-smith-chart|Reading Reflection Coefficient from the Smith Chart]]
- [[smith-chart-motion-along-a-lossless-line|Smith Chart Motion Along a Lossless Line]]

## Concept Dependencies

- enables: [[constant-resistance-and-constant-reactance-circles|Constant-Resistance and Constant-Reactance Circles]]
