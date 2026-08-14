---
title: "1.193 Complex Loads, Mismatch, and Average Power"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 347", "Page 348"]
related: ["forward-and-reflected-voltage-reconstruction", "smith-chart-impedance-and-reflection-coefficient-mapping", "constant-resistance-and-constant-reactance-circles", "standing-wave-voltage-extrema-on-a-lossless-line"]
---

# 1.193 Complex Loads, Mismatch, and Average Power

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 347, Page 348

Examples 10.8 and 10.9 contrast a partially dissipative complex load with a purely reactive load. Two 300 $\Omega$ receivers in parallel produce 150 $\Omega$; placing $-j300\ \Omega$ in parallel with them gives $Z_L=120-j60\ \Omega$. Relative to a 300 $\Omega$ line, this load has $\Gamma=0.447\angle-153.4^\circ$ and $s=2.62$, indicating a worse mismatch than the preceding resistive case. Transforming through the same $288^\circ$ electrical length gives $Z_{\mathrm{in}}=755-j138.5\ \Omega$. A 60 V Thevenin source with 300 $\Omega$ source resistance then supplies $I_{s,\mathrm{in}}=0.0564\angle7.47^\circ$ A. The real part of the input impedance absorbs 1.200 W, which reaches the lossless-line load, so each receiver receives 0.6 W. By contrast, a purely capacitive $-j300\ \Omega$ load has $|\Gamma|=1$, infinite VSWR, purely reactive input impedance, and zero average delivered power.

## Page-Grounded Details

#### Page 347

We may now let $z=0$ in (104) to find the load voltage,
$$
V_{s,L}=(1+\Gamma)V_{0}^{+}=20\angle 72^{\circ}=20\angle-288^{\circ}
$$
The amplitude agrees with our previous value. The presence of the reflected wave causes $V_{s,\rm in}$ and $V_{s,\quad L}$ to differ in phase by about $-279^{\circ}$ instead of $-288^{\circ}$.

#### Example 10.8

In order to provide a slightly more complicated example, let us now place a purely capacitive impedance of $-j300\ \Omega$ in parallel with the two 300 $\Omega$ receivers. We are to find the input impedance and the power delivered to each receiver.

Solution. The load impedance is now 150 $\Omega$ in parallel with $-j300\ \Omega$, or
$$
Z_{L}=\frac{150(-j300)}{150-j300}=\frac{-j300}{1-j2}=120-j60\ \Omega
$$
We first calculate the reflection coefficient and the VSWR:
$$
\begin{split}\Gamma&=\frac{120-j60-300}{120-j60+300}=\frac{-180-j60}{420-j60}=0.447\angle-153.4^{\circ}\\ s&=\frac{1+0.447}{1-0.447}=2.62\end{split}
$$
Thus, the VSWR is higher and the mismatch is therefore worse. Let us next calculate the input impedance. The electrical length of the line is still $288^{\circ}$, so that
$$
Z_{in}=300\,\frac{(120-j60)\,

[Truncated for analysis]

#### Page 348

and the reflected wave is equal in amplitude to the incident wave. Hence, it should not surprise us to see that the VSWR is
$$
 s=\frac{1+\left|-j1\right|}{1-\left|-j1\right|}=\infty
$$
and the input impedance is a pure reactance
$$
 Z_{in}=300\frac{-j300\cos 288^{\circ}+j300\sin 288^{\circ}}{300\cos 288^{\circ}+j\left(-j300\right)\sin 288^{\circ}}=j589 $$
Thus, no average power can be delivered to the input impedance by the source, and therefore no average power can be delivered to the load.

Although we could continue to find many other facts and figures for these examples, much of the work may be done more easily for problems of this type by using graphical techniques. We encounter these in Section 10.13.

D10.4. A 50-ohm lossless line has a length of 0.4$\lambda$. The operating frequency is 300 MHz. A load $Z_{L}=40+j30~{}\Omega$ is connected at $z=0$, and the Thevenin-equivalent source at $z=-l$ is $12\angle 0^{\circ}$ V in series with $Z_{Th}=50+j0~{}\Omega$. Find: (a) $\Gamma$; (b) s; (c) $Z_{in}$.

Ans. (a) $0.333\angle 90^{\circ}$; (b) 2.00; (c) 25.5 + j 5.90 $\Omega$

D10.5. For the transmission line of Problem D10.4, also find: (a) the phasor volta

[Truncated for analysis]

## Core Ideas

- Parallel impedances must be combined before calculating the load reflection coefficient.
- For Example 10.8, $Z_L=150\parallel(-j300)=120-j60\ \Omega$.
- The mismatch measures are $\Gamma=0.447\angle-153.4^\circ$ and $s=2.62$.
- For a lossless line, average input power equals average load power.
- A pure reactance has $|\Gamma|=1$ and reflects all incident average power.
- When $|\Gamma|=1$, the VSWR is infinite.
- A lossless line terminated in a pure reactance presents a pure reactance at its input.

## Source Anchors

- Page 347 calculates $Z_L=120-j60\ \Omega$ for the receiver and capacitor combination.
- Page 347 calculates $\Gamma=0.447\angle-153.4^\circ$ and $s=2.62$.
- Page 347 obtains $Z_{\mathrm{in}}=755-j138.5\ \Omega$ and $I_{s,\mathrm{in}}=0.0564\angle7.47^\circ$ A.
- Page 347 finds $P_{\mathrm{in}}=P_L=1.200$ W, giving 0.6 W to each receiver.
- Pages 347 and 348 calculate $\Gamma=-j=1\angle-90^\circ$, $s=\infty$, and $Z_{\mathrm{in}}=j589\ \Omega$ for the purely capacitive load.
- Page 348 includes Problems D10.4 and D10.5 as a reusable procedure for finding $\Gamma$, $s$, $Z_{\mathrm{in}}$, endpoint voltages, and delivered power.

## Related Pages

- [[forward-and-reflected-voltage-reconstruction|Forward and Reflected Voltage Reconstruction]]
- [[smith-chart-impedance-and-reflection-coefficient-mapping|Smith Chart Impedance and Reflection-Coefficient Mapping]]
- [[constant-resistance-and-constant-reactance-circles|Constant-Resistance and Constant-Reactance Circles]]
- [[standing-wave-voltage-extrema-on-a-lossless-line|Standing-Wave Voltage Extrema on a Lossless Line]]

## Concept Dependencies

- enables: [[smith-chart-impedance-and-reflection-coefficient-mapping|Smith Chart Impedance and Reflection-Coefficient Mapping]]
- causes: [[standing-wave-voltage-extrema-on-a-lossless-line|Standing-Wave Voltage Extrema on a Lossless Line]]
