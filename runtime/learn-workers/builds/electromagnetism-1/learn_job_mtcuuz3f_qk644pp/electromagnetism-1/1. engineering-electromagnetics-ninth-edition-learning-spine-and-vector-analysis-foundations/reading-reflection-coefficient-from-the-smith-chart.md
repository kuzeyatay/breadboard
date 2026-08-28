---
title: "1.196 Reading Reflection Coefficient from the Smith Chart"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 351", "Page 352"]
related: ["smith-chart-impedance-and-reflection-coefficient-mapping", "constant-resistance-and-constant-reactance-circles", "smith-chart-motion-along-a-lossless-line"]
---

# 1.196 Reading Reflection Coefficient from the Smith Chart

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 351, Page 352

A normalized load $z_L=r+jx$ is plotted at the intersection of its constant-resistance and constant-reactance circles. The radial distance from the chart origin gives $|\Gamma|$, usually through an auxiliary radial scale, while a line from the origin through the plotted point reaches the circumference at the reflection phase $\phi$. The chart deliberately omits dense concentric magnitude circles and radial phase lines, so these quantities are read using the auxiliary scales. For $Z_L=25+j50\ \Omega$ on a 50 $\Omega$ line, normalization gives $z_L=0.5+j1$. The intersection of the $r=0.5$ and $x=1$ circles is point A in Figure 10.12. Its radius and angle give approximately $\Gamma=0.62\angle83^\circ$. This procedure turns an algebraic complex division into a geometric intersection and two scale readings, while preserving enough accuracy for many engineering calculations.

## Page-Grounded Details

#### Page 351

Figure 10.10 Constant-$r$ circles are shown on the $\Gamma_{r}$, $\Gamma_{i}$ plane. The radius of any circle is $1/(1+r)$.

obtain $z_{L}$, locate the appropriate $r$ and $x$ circles (interpolating as necessary), and determine $\Gamma$ by the intersection of the two circles. Because the chart does not have concentric circles showing the values of $|\Gamma|$, it is necessary to measure the radial distance from the origin to the intersection with dividers or a compass and use an auxiliary scale to find $|\Gamma|$. The graduated line segment below the chart in Figure 10.12 serves this purpose. The angle of $\Gamma$ is $\phi$, and it is the counterclockwise angle from the $\Gamma_{r}$ axis. Again, radial lines showing the angle would clutter up the chart badly, so the

Figure 10.11 The portions of the circles of constant $x$ lying within $|\Gamma|=1$ are shown on the $\Gamma_{r}$, $\Gamma_{i}$ axes. The radius of a given circle is $1/|x|$.

#### Page 352

Figure 10.12 The Smith chart contains the constant-r circles and constant-x circles, an auxiliary radial scale to determine |Γ|, and an angular scale on the circumference for measuring φ.

angle is indicated on the circumference of the circle. A straight line from the origin through the intersection may be extended to the perimeter of the chart. As an example, if $Z_{L}=25+j50\ \Omega$ on a 50-$\Omega$ line, $z_{L}=0.5+j1$, and point $A$ on Figure 10.12 shows the intersection of the $r=0.5$ and $x=1$ circles. The reflection coefficient is approximately 0.62 at an angle $\phi$ of $83^{\circ}$.

The Smith chart is completed by adding a second scale on the circumference by which distance along the line may be computed. This scale is in wavelength units, but the values placed on it are not obvious. To obtain them, we first divide the voltage at any point along the line,
$$
V_{s}=V_{0}^{+}(e^{-j\beta z}+\Gamma\,e^{j\beta z})
$$
by the current
$$
I_{s}=\frac{V_{0}^{+}}{Z_{0}}(e^{-j\beta z}-\Gamma\,e^{j\beta z})
$$
obtaining the normalized input impedance
$$ z_{\mathrm{in}}=\frac{V_{s}}{Z_{0}I_{s}}=\frac{e^{-j\beta z}+\Gamma\,e^{j\beta z}}{e^{-j\beta z}-\Gamma\,e^{j\b

[Truncated for analysis]

## Core Ideas

- Divide $Z_L$ by $Z_0$ before entering the Smith chart.
- Locate the point at the intersection of the required $r$ and $x$ circles.
- Measure $|\Gamma|$ as radial distance from the origin.
- Read $\phi$ where the radial line reaches the circumference.
- Interpolate between labeled resistance and reactance circles when necessary.
- For $z_L=0.5+j1$, the chart gives approximately $\Gamma=0.62\angle83^\circ$.

## Source Anchors

- Pages 351 and 352 describe locating $z_L$ from the intersection of constant-$r$ and constant-$x$ circles.
- Page 351 explains the auxiliary radial scale used to determine $|\Gamma|$.
- Page 351 explains extending a line to the circumference to read $\phi$.
- Source figure S1.P352.F1, Figure 10.12, shows the combined chart, radial scale, angular scale, and point A.
- Page 352 uses $Z_L=25+j50\ \Omega$, $Z_0=50\ \Omega$, and $z_L=0.5+j1$ to obtain approximately $0.62\angle83^\circ$.

## Related Pages

- [[smith-chart-impedance-and-reflection-coefficient-mapping|Smith Chart Impedance and Reflection-Coefficient Mapping]]
- [[constant-resistance-and-constant-reactance-circles|Constant-Resistance and Constant-Reactance Circles]]
- [[smith-chart-motion-along-a-lossless-line|Smith Chart Motion Along a Lossless Line]]

## Concept Dependencies

- depends-on: [[smith-chart-motion-along-a-lossless-line|Smith Chart Motion Along a Lossless Line]]
