---
title: "1.191 Standing-Wave Voltage Extrema on a Lossless Line"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 346", "Page 347"]
related: ["forward-and-reflected-voltage-reconstruction", "smith-chart-locations-of-voltage-extrema-and-vswr", "smith-chart-motion-along-a-lossless-line"]
---

# 1.191 Standing-Wave Voltage Extrema on a Lossless Line

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 346, Page 347

The voltage standing wave is produced by interference between forward and reflected waves. If the load reflection coefficient is written as $\Gamma=|\Gamma|e^{j\phi}$, the voltage maxima occur at positions determined by the reflection phase and propagation constant. In the worked line, $\beta=0.8\pi$ and $\phi=\pi$, giving maxima at $z=-0.625$ m and $z=-1.875$ m. Voltage minima are one-quarter wavelength from adjacent maxima and occur at $z=0$ and $z=-1.25$ m. The load at $z=0$ is therefore a voltage minimum, consistent with the rule that a purely resistive load smaller than $Z_0$ produces a load-plane minimum, while a purely resistive load greater than $Z_0$ produces a load-plane maximum. With a minimum voltage of 20 V and VSWR $s=2$, the maximum is 40 V. The calculated input voltage, $38.5\angle-8.8^\circ$ V, lies close to that maximum because the line is nearly three-quarters of a wavelength long.

## Page-Grounded Details

#### Page 346

receiver now receives only 0.667 W. Because the input impedance of each receiver is 300 $\Omega$, the voltage across the receiver is easily found as
$$
\begin{align*}0.667&=\frac{1}{2} \frac{|V_{s,L}|^{2}}{300}\\|V_{s,L}|&=20\space V\end{align*}
$$
in comparison with the 30 V obtained across the single load.

Before we leave this example, let us ask ourselves several questions about the voltages on the transmission line. Where is the voltage a maximum and a minimum, and what are these values? Does the phase of the load voltage still differ from the input voltage by $288^{\circ}$? Presumably, if we can answer these questions for the voltage, we could do the same for the current.

Equation (89) serves to locate the voltage maxima at
$$
z_{\max}=-\frac{1}{2\beta}(\phi+2m\pi)\quad(m=0,1,2,\ldots)
$$
where $\Gamma=|\Gamma|e^{j\phi}$. Thus, with $\beta=0.8\pi$ and $\phi=\pi$, we find
$$
z_{\max}=-0.625\quad\text{and}\quad-1.875\space m
$$
while the minima are $\lambda/4$ distant from the maxima;
$$
z_{\min}=0\quad\text{and}\quad-1.25\space m
$$
and we find that the load voltage (at $z=0$) is a voltage minimum. This, of course, verifies the general conclusion we reach

[Truncated for analysis]

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

## Core Ideas

- Write the load reflection coefficient as $\Gamma=|\Gamma|e^{j\phi}$.
- Voltage maxima satisfy
$$
z_{\max}=-\frac{\phi+2m\pi}{2\beta},\qquad m=0,1,2,\ldots$$
- Adjacent voltage maxima and minima are separated by $\lambda/4$.
- For pure resistances, $Z_L<Z_0$ places a voltage minimum at the load.
- For pure resistances, $Z_L>Z_0$ places a voltage maximum at the load.
- The VSWR gives $|V|_{\max}=s|V|_{\min}$.
- A line length near an odd multiple of $\lambda/4$ exchanges load-plane minima and input-plane maxima.

## Source Anchors

- Page 346 gives $z_{\max}=-0.625$ m and $-1.875$ m for $\beta=0.8\pi$ and $\phi=\pi$.
- Page 346 gives voltage minima at $z=0$ and $z=-1.25$ m.
- Page 346 identifies the 20 V load voltage as the line minimum and obtains a 40 V maximum from $s=2$.
- Page 346 calculates $V_{s,\mathrm{in}}=(0.0756\angle15.0^\circ)(510\angle-23.8^\circ)=38.5\angle-8.8^\circ$ V.
- Page 346 states the load-plane extrema rule for purely resistive $Z_L$ and $Z_0$.

## Related Pages

- [[forward-and-reflected-voltage-reconstruction|Forward and Reflected Voltage Reconstruction]]
- [[smith-chart-locations-of-voltage-extrema-and-vswr|Smith Chart Locations of Voltage Extrema and VSWR]]
- [[smith-chart-motion-along-a-lossless-line|Smith Chart Motion Along a Lossless Line]]

## Concept Dependencies

- derives-from: [[forward-and-reflected-voltage-reconstruction|Forward and Reflected Voltage Reconstruction]]
- related: [[smith-chart-locations-of-voltage-extrema-and-vswr|Smith Chart Locations of Voltage Extrema and VSWR]]
