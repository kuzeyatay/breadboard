---
title: "1.195 Constant-Resistance and Constant-Reactance Circles"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 350", "Page 351"]
related: ["smith-chart-impedance-and-reflection-coefficient-mapping", "reading-reflection-coefficient-from-the-smith-chart", "smith-chart-locations-of-voltage-extrema-and-vswr"]
---

# 1.195 Constant-Resistance and Constant-Reactance Circles

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 350, Page 351

Writing $\Gamma=\Gamma_r+j\Gamma_i$ and separating the inverse impedance transformation into real and imaginary parts reveals the geometric structure of the Smith chart. The normalized resistance and reactance are
$$
r=\frac{1-\Gamma_r^2-\Gamma_i^2}{(1-\Gamma_r)^2+\Gamma_i^2},\qquad x=\frac{2\Gamma_i}{(1-\Gamma_r)^2+\Gamma_i^2}
$$
 Rearranging produces circle equations. A constant-$r$ circle has center $\left(r/(1+r),0\right)$ and radius $1/(1+r)$. Every such circle is centered on the $\Gamma_r$ axis and passes through $\Gamma=1+j0$. A constant-$x$ circle has center $\left(1,1/x\right)$ and radius $1/|x|$; only the portions within $|\Gamma|=1$ appear. Positive reactance lies above the horizontal axis and negative reactance below it. The $x=0$ locus is the $\Gamma_r$ axis. The limiting cases connect the geometry to physical loads: $r=0$ is the unit circle associated with pure reactance, while infinite resistance or reactance collapses to the open-circuit point $\Gamma=1$.

## Page-Grounded Details

#### Page 350

In polar form, we have used $|\Gamma|$ and $\phi$ as the magnitude and angle of $\Gamma$. With $\Gamma_{r}$ and $\Gamma_{i}$ as the real and imaginary parts of $\Gamma$, we write
$$
\Gamma=\Gamma_{r}+j\Gamma_{i}\qquad(108)
$$
Thus
$$
r+jx=\frac{1+\Gamma_{r}+j\Gamma_{i}}{1-\Gamma_{r}-j\Gamma_{i}}\qquad(109)
$$
The real and imaginary parts of this equation are
$$
r=\frac{1-\Gamma_{r}^{2}-\Gamma_{i}^{2}}{(1-\Gamma_{r})^{2}+\Gamma_{i}^{2}}\qquad(110)
$$
$$
x=\frac{2\Gamma_{i}}{(1-\Gamma_{r})^{2}+\Gamma_{i}^{2}}\qquad(111)
$$
After several lines of elementary algebra, we may write (110) and (111) in forms which readily display the nature of the curves on $\Gamma_{r}$, $\Gamma_{i}$ axes,
$$
\left(\Gamma_{r}-\frac{r}{1+r}\right)^{2}+\Gamma_{i}^{2}=\left(\frac{1}{1+r}\right)^{2}\qquad(112)
$$
$$
(\Gamma_{r}-1)^{2}+\left(\Gamma_{i}-\frac{1}{x}\right)^{2}=\left(\frac{1}{x}\right)^{2}\qquad(113)
$$
The first equation describes a family of circles, where each circle is associated with a specific value of resistance r. For example, if r = 0, the radius of this zero-resistance circle is seen to be unity, and it is centered at the origin ($\Gamma_{r}=0$, $ \Gamma_{i}=0

[Truncated for analysis]

#### Page 351

Figure 10.10 Constant-$r$ circles are shown on the $\Gamma_{r}$, $\Gamma_{i}$ plane. The radius of any circle is $1/(1+r)$.

obtain $z_{L}$, locate the appropriate $r$ and $x$ circles (interpolating as necessary), and determine $\Gamma$ by the intersection of the two circles. Because the chart does not have concentric circles showing the values of $|\Gamma|$, it is necessary to measure the radial distance from the origin to the intersection with dividers or a compass and use an auxiliary scale to find $|\Gamma|$. The graduated line segment below the chart in Figure 10.12 serves this purpose. The angle of $\Gamma$ is $\phi$, and it is the counterclockwise angle from the $\Gamma_{r}$ axis. Again, radial lines showing the angle would clutter up the chart badly, so the

Figure 10.11 The portions of the circles of constant $x$ lying within $|\Gamma|=1$ are shown on the $\Gamma_{r}$, $\Gamma_{i}$ axes. The radius of a given circle is $1/|x|$.

## Core Ideas

- Resolve $\Gamma$ into $\Gamma_r+j\Gamma_i$ before separating resistance and reactance.
- Constant resistance obeys
$$
\left(\Gamma_r-\frac{r}{1+r}\right)^2+\Gamma_i^2=\left(\frac{1}{1+r}\right)^2
$$
- A constant-$r$ circle has radius $1/(1+r)$.
- Constant reactance obeys
$$
(\Gamma_r-1)^2+\left(\Gamma_i-\frac{1}{x}\right)^2=\left(\frac{1}{x}\right)^2
$$
- A constant-$x$ circle has radius $1/|x|$.
- All constant-$r$ and constant-$x$ circles meet at the open-circuit point $\Gamma=1$.
- The zero-reactance locus is the horizontal reflection-coefficient axis.

## Source Anchors

- Page 350 gives Eqs. (108) through (111), separating normalized resistance and reactance.
- Page 350 gives the constant-$r$ and constant-$x$ circle equations as Eqs. (112) and (113).
- Page 350 identifies the $r=0$, $r=1$, and $r\to\infty$ limiting geometries.
- Source figure S1.P351.F1, Figure 10.10, shows constant-$r$ circles for $r=0.5$, $1$, and $2$.
- Source figure S1.P351.F2, Figure 10.11, shows the portions of constant-$x$ circles inside $|\Gamma|=1$.
- Page 350 states that the $x=0$ circle degenerates to the $\Gamma_r$ axis.

## Related Pages

- [[smith-chart-impedance-and-reflection-coefficient-mapping|Smith Chart Impedance and Reflection-Coefficient Mapping]]
- [[reading-reflection-coefficient-from-the-smith-chart|Reading Reflection Coefficient from the Smith Chart]]
- [[smith-chart-locations-of-voltage-extrema-and-vswr|Smith Chart Locations of Voltage Extrema and VSWR]]

## Concept Dependencies

- enables: [[reading-reflection-coefficient-from-the-smith-chart|Reading Reflection Coefficient from the Smith Chart]]
