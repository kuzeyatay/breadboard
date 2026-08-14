---
title: "1.198 Smith Chart Locations of Voltage Extrema and VSWR"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 354", "Page 355"]
related: ["standing-wave-voltage-extrema-on-a-lossless-line", "smith-chart-motion-along-a-lossless-line", "single-stub-shunt-matching-with-the-smith-chart", "constant-resistance-and-constant-reactance-circles"]
---

# 1.198 Smith Chart Locations of Voltage Extrema and VSWR

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 354, Page 355

Voltage maxima and minima occur where the input impedance is purely resistive, so they lie on the $x=0$ axis of the Smith chart. The high-resistance intersection, $r>1$, corresponds to a voltage maximum and current minimum and is assigned wavelengths-toward-generator value 0.25. The low-resistance intersection, $r<1$, corresponds to a voltage minimum and current maximum and is assigned value 0. In Example 10.10, the load point is at 0.135 wtg, so the nearest voltage maximum toward the generator is $0.250-0.135=0.115\lambda$, or 23 cm for a 2 m wavelength. The constant-$|\Gamma|$ circle crosses the high-resistance axis at $r=4.2$, directly giving $s=4.2$. The same chart can be used for normalized admittance $y_L=g+jb$, treating resistance circles as conductance circles and reactance circles as susceptance circles. In admittance use, the $g>1$, $b=0$ segment corresponds to a voltage minimum, and the reflection angle differs by $180^\circ$ from the impedance-chart reading.

## Page-Grounded Details

#### Page 354

Figure 10.13 A photographic reduction of one version of a useful Smith chart (Source: Emeloid Company, Hillside, NJ.) For accurate work, larger charts are available wherever fine technical books are sold.

Source: The Emeloid Company, Hillside, NJ.

must occur at the load when $Z_{L}$ is a pure resistance; if $R_{L}>Z_{0}$ there is a maximum at the load, and if $R_{L}<Z_{0}$ there is a minimum. We may extend this result now by noting that we could cut off the load end of a transmission line at a point where the input impedance is a pure resistance and replace that section with a resistance $R_{\rm in}$; there would be no changes on the generator portion of the line. It follows, then, that the location of voltage maxima and minima must be at those points where $Z_{\rm in}$ is a pure resistance. Purely resistive input impedances must occur on the $x=0$ line (the $\Gamma_{r}$ axis) of the Smith chart. Voltage maxima or current minima occur when $r>1$, or at wtg = 0.25, and voltage minima or current maxima occur when $r<1$, or at wtg = 0.

#### Page 355

Figure 10.14 Normalized input impedance produced by a normalized load impedance $z_{L}=0.5+j1$ on a line 0.3$\lambda$ long is $z_{\mathrm{in}}=0.28-j0.40$.

In Example 10.10, then, the maximum at $\mathrm{wtg}=0.250$ must occur $0.250-0.135=0.115$ wavelengths toward the generator from the load. This is a distance of $0.115\times 200$, or 23 cm from the load.

We should also note that because the standing wave ratio produced by a resistive load $R_{L}$ is either $R_{L}/R_{0}$ or $R_{0}/R_{L}$, whichever is greater than unity, the value of $s$ may be read directly as the value of $r$ at the intersection of the $|\Gamma|$ circle and the $r$ axis, $r>1$. In our example, this intersection is marked point $C$, and $r=4.2$; thus, $s=4.2$.

Transmission line charts may also be used for normalized admittances, although there are several slight differences in such use. We let $y_{L}=Y_{L}/Y_{0}=g+jb$ and use the $r$ circles as $g$ circles and the $x$ circles as $b$ circles. The two differences are, first, the line segment where $g>1$ and $b=0$ corresponds to a voltage minimum; and second, $180^{\circ}$ must be added to the angle of $\Gamma$

[Truncated for analysis]

## Core Ideas

- Voltage extrema occur where $x=0$ and the input impedance is purely resistive.
- At $r>1$, the line has a voltage maximum and current minimum.
- At $r<1$, the line has a voltage minimum and current maximum.
- The high-resistance intersection occurs at wtg $=0.25$.
- The low-resistance intersection occurs at wtg $=0$.
- The high-resistance axis crossing gives the VSWR directly as $s=r$.
- Admittance plotting reinterprets $r,x$ circles as $g,b$ circles and shifts the reflection angle by $180^\circ$.

## Source Anchors

- Pages 354 and 355 identify purely resistive chart locations as voltage maxima or minima.
- Page 354 assigns voltage maxima to $r>1$ at wtg $=0.25$ and minima to $r<1$ at wtg $=0$.
- Page 355 locates the Example 10.10 maximum $0.115\lambda$, or 23 cm, from the load.
- Page 355 reads $s=4.2$ at point C.
- Page 355 explains normalized admittance use and the required $180^\circ$ reflection-angle adjustment.
- Page 355 includes Problem D10.6 on input impedance, VSWR, voltage-maximum distance, and resistive replacement planes.

## Related Pages

- [[standing-wave-voltage-extrema-on-a-lossless-line|Standing-Wave Voltage Extrema on a Lossless Line]]
- [[smith-chart-motion-along-a-lossless-line|Smith Chart Motion Along a Lossless Line]]
- [[single-stub-shunt-matching-with-the-smith-chart|Single-Stub Shunt Matching with the Smith Chart]]
- [[constant-resistance-and-constant-reactance-circles|Constant-Resistance and Constant-Reactance Circles]]

## Concept Dependencies

- applies-to: [[standing-wave-voltage-extrema-on-a-lossless-line|Standing-Wave Voltage Extrema on a Lossless Line]]
- depends-on: [[constant-resistance-and-constant-reactance-circles|Constant-Resistance and Constant-Reactance Circles]]
