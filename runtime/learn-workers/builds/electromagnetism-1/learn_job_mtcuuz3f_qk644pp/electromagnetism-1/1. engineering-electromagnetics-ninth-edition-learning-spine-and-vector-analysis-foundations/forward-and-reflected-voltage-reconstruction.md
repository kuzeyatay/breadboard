---
title: "1.192 Forward and Reflected Voltage Reconstruction"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 346", "Page 347"]
related: ["standing-wave-voltage-extrema-on-a-lossless-line", "complex-loads-mismatch-and-average-power", "multiple-reflections-and-transient-steady-state"]
---

# 1.192 Forward and Reflected Voltage Reconstruction

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 346, Page 347

The total phasor voltage at any position on a lossless line is the sum of a forward wave and a reflected wave. The source expresses this as
$$
V_{sT}(z)=\left(e^{-j\beta z}+\Gamma e^{j\beta z}\right)V_0^+
$$
 If the input voltage is known at $z=-l$, then substituting that position isolates the forward-wave amplitude $V_0^+$. In the worked example, the line has electrical length $\beta l=1.6\pi$, the reflection coefficient is $-1/3$, and the input voltage is $38.5\angle-8.8^\circ$ V. Solving gives $V_0^+=30.0\angle72.0^\circ$ V. At the load, $z=0$, so the propagation factors become unity and the load voltage is $(1+\Gamma)V_0^+=20\angle72^\circ$ V. This confirms the amplitude found independently from delivered power. It also shows why phase cannot be inferred from electrical length alone when a reflected wave is present: the total voltages at the input and load differ by about $-279^\circ$, rather than the $-288^\circ$ phase shift associated with a single traveling wave.

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

- The total voltage is the phasor sum of incident and reflected waves.
- At the input
$$
V_{s,\mathrm{in}}=\left(e^{j\beta l}+\Gamma e^{-j\beta l}\right)V_0^+.
$$
- The incident-wave phasor follows from
$$
V_0^+=\frac{V_{s,\mathrm{in}}}{e^{j\beta l}+\Gamma e^{-j\beta l}}.$$
- At the load, $V_{s,L}=(1+\Gamma)V_0^+$.
- Reflections change both the magnitude and phase of the total voltage.
- The total-voltage phase difference is not generally equal to $-\beta l$.

## Source Anchors

- Page 346 presents the total-voltage expression as Eq. (104).
- Page 346 applies the expression at $z=-l$ as Eq. (105).
- Page 346 obtains $V_0^+=30.0\angle72.0^\circ$ V.
- Page 347 obtains $V_{s,L}=20\angle72^\circ=20\angle-288^\circ$ V.
- Page 347 states that the input and load total voltages differ by about $-279^\circ$, not $-288^\circ$.

## Related Pages

- [[standing-wave-voltage-extrema-on-a-lossless-line|Standing-Wave Voltage Extrema on a Lossless Line]]
- [[complex-loads-mismatch-and-average-power|Complex Loads, Mismatch, and Average Power]]
- [[multiple-reflections-and-transient-steady-state|Multiple Reflections and Transient Steady State]]

## Concept Dependencies

- applies-to: [[complex-loads-mismatch-and-average-power|Complex Loads, Mismatch, and Average Power]]
