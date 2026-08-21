---
title: "1.200 Single-Stub Shunt Matching with the Smith Chart"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 357", "Page 358", "Page 359"]
related: ["smith-chart-locations-of-voltage-extrema-and-vswr", "slotted-line-determination-of-an-unknown-load", "smith-chart-motion-along-a-lossless-line"]
---

# 1.200 Single-Stub Shunt Matching with the Smith Chart

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 357, Page 358, Page 359

A short-circuited shunt stub can cancel the susceptance of a transformed load and produce a matched normalized admittance of $1+j0$. Because the stub is connected in parallel, the design is performed with admittances. Starting from $z_L=2.1+j0.8$, the corresponding normalized load admittance is found by moving one-quarter wavelength on the Smith chart, yielding $y_L=0.41-j0.16$. Along the same constant-VSWR circle, there are two points where conductance is unity: $1+j0.95$ and $1-j0.95$. Selecting $1+j0.95$ gives the shorter stub, which must supply $y_{\mathrm{stub}}=-j0.95$. The selected unity-conductance point lies 0.19 wavelength toward the generator from the load. For a short-circuited stub, the chart starts at $y=\infty$ and wtg $=0.250$. Moving to the point where $b=-0.95$ gives wtg $=0.379$, so the stub length is $0.129\lambda$, or 9.67 cm for the 75 cm wavelength.

## Page-Grounded Details

#### Page 357

Figure 10.16 If $z_{\mathrm{i n}}=2.5+j0$ on a line 0.3 wavelengths long, then $z_{L}=2.1+j0.8$.

$z_{\mathrm{i n}}=2.5$. We therefore enter the chart at $z_{\mathrm{i n}}=2.5$ and read 0.250 on the wtg scale. Subtracting 0.030 wavelength to reach the load, we find that the intersection of the $s=2.5$ (or $|\Gamma|=0.429$) circle and the radial line to 0.220 wavelength is at $z_{L}=2.1+j0.8$. The construction is sketched on the Smith chart of Figure 10.16. Thus $Z_{L}=105+j40\Omega$, a value that assumes its location at a scale reading of $-11.5$ cm, or an integral number of half-wavelengths from that position. Of course, we may select the "location" of our load at will by placing the short circuit at the point that we wish to consider the load location. Since load locations are not well defined, it is important to specify the point (or plane) at which the load impedance is determined.

As a final example, let us try to match this load to the 50-$\Omega$ line by placing a short-circuited stub of length $d_{11}$ a distance $d$ from the load (see Figure 10.17). The stub line has the same characteristic impedance as the main line. The lengths $d$ and $ d_{11}

[Truncated for analysis]

#### Page 358

The input impedance to the stub is a pure reactance; when combined in parallel with the input impedance of the length $d$ containing the load, the resultant input impedance must be $1+j0$. Because it is much easier to combine admittances in parallel than impedances, we can rephrase our goal in admittance language: the input admittance of the length $d$ containing the load must be $1+jb_{\rm in}$ for the addition of the input admittance of the stub $jb_{\rm stub}$ to produce a total admittance of $1+j0$. Hence the stub admittance is $-jb_{\rm in}$. We will therefore use the Smith chart as an admittance chart instead of an impedance chart.

The impedance of the load is $2.1+j0.8$, and its location is at $-11.5$ cm. The admittance of the load is therefore $1/(2.1+j0.8)$, and this value may be determined by adding one-quarter wavelength on the Smith chart, as $Z_{\rm in}$ for a quarter-wavelength line is $R_{0}^{2}/Z_{L}$, or $z_{\rm in}=1/z_{L}$, or $y_{\rm in}=z_{L}$. Entering the chart (Figure 10.18) at $z_{L}=2.1+j0.8$, we read 0.220 on the wtg scale; we add (or subtract) 0.250 and find the admittance $0.41-j0.16$ corresponding to this impedance. Thi

[Truncated for analysis]

#### Page 359

D10.7. Standing wave measurements on an air-filled lossless 75-$\Omega$ line show maxima of 18 V and minima of 5 V. The first voltage minimum is located at a scale reading of 17 cm; the second minimum occurs at 37 cm. Find: (a) s; (b) $\lambda$; (c) f; (d) $\Gamma_{L}$; (e) $Z_{L}$.

Ans. (a) 3.60; (b) 0.400 m; (c) 750 MHz; (d) 0.57$\angle$130; (e) 24.2 +j32.6$\Omega$

D10.8. A normalized load, $z_{L}=2-j1$, is located at $z=0$ on a lossless 50-$\Omega$ line. Let the wavelength be 100 cm. (a) A short-circuited stub is to be located at $z=-d$. What is the shortest suitable value for $d$? (b) What is the shortest possible length of the stub? Find s: (c) on the main line for $z<-d$; (d) on the main line for $-d<z<0$; (e) on the stub.

Ans. (a) 12.5 cm; (b) 12.5 cm; (c) 1.00; (d) 2.62; (e) $\infty$

#### 10.14 TRANSIENT ANALYSIS

Throughout most of this chapter, we have considered the operation of transmission lines under steady-state conditions, in which voltage and current were sinusoidal and at a single frequency. In this section we move away from the simple time-harmonic case and consider transmission line responses to voltage step functions and pulses,

[Truncated for analysis]

## Core Ideas

- Express the parallel matching condition in normalized admittance.
- Require the transformed main-line admittance to have conductance $g=1$.
- If the main-line admittance is $1+jb_{\mathrm{in}}$, choose $y_{\mathrm{stub}}=-jb_{\mathrm{in}}$.
- Convert impedance to admittance by a quarter-wavelength chart rotation.
- There are generally two unity-conductance intersections on the constant-VSWR circle.
- Choose between the two intersections according to desired stub and placement lengths.
- A short-circuited stub remains on the zero-conductance perimeter of the admittance chart.
- The worked design uses $d=0.19\lambda$ and stub length $d_1=0.129\lambda$.

## Source Anchors

- Source figure S1.P357.F2, Figure 10.17, shows a short-circuited shunt stub a distance $d$ from the load.
- Page 358 states the required total normalized admittance as $1+j0$.
- Page 358 converts $z_L=2.1+j0.8$ to $y_L=0.41-j0.16$ by a quarter-wavelength chart shift.
- Page 358 identifies the two unity-conductance points as $1+j0.95$ and $1-j0.95$.
- Page 358 selects $y_{\mathrm{stub}}=-j0.95$ and locates the stub $0.19\lambda$ from the load.
- Source figure S1.P358.F1, Figure 10.18, shows the complete matching construction and stub length $0.129\lambda$.
- Page 359 includes Problem D10.8 on shortest stub placement, shortest stub length, and VSWR in each line segment.

## Related Pages

- [[smith-chart-locations-of-voltage-extrema-and-vswr|Smith Chart Locations of Voltage Extrema and VSWR]]
- [[slotted-line-determination-of-an-unknown-load|Slotted-Line Determination of an Unknown Load]]
- [[smith-chart-motion-along-a-lossless-line|Smith Chart Motion Along a Lossless Line]]

## Concept Dependencies

- depends-on: [[smith-chart-motion-along-a-lossless-line|Smith Chart Motion Along a Lossless Line]]
- depends-on: [[smith-chart-locations-of-voltage-extrema-and-vswr|Smith Chart Locations of Voltage Extrema and VSWR]]
- applies-to: [[slotted-line-determination-of-an-unknown-load|Slotted-Line Determination of an Unknown Load]]
