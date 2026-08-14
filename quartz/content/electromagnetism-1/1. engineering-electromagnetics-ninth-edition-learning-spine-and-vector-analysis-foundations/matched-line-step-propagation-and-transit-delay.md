---
title: "1.201 Matched-Line Step Propagation and Transit Delay"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 359", "Page 360", "Page 361"]
related: ["multiple-reflections-and-transient-steady-state", "voltage-and-current-reflection-diagrams", "initially-charged-lines-and-pulse-formation"]
---

# 1.201 Matched-Line Step Propagation and Transit Delay

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 359, Page 360, Page 361

Transient analysis replaces the single-frequency steady-state assumption with propagating steps and pulses. The basic treatment assumes a lossless, nondispersive line, even though real pulses contain many Fourier components and can broaden when $\beta$ or the load reflection coefficient varies with frequency. For a line of length $l$ terminated in $R_L=Z_0$, closing a battery switch at $t=0$ launches a forward voltage step $V^+=V_0$. Behind the leading edge, the line voltage is $V_0$; ahead of it, the line remains at zero voltage. The edge travels at velocity $v$, generally the group velocity, and reaches the load after the one-way transit time $l/v$. Because the load is matched, no reflection occurs and the transient ends when the wave arrives. The associated current step is $I^+=V^+/Z_0$. Thus the load voltage and current remain zero until $t=l/v$, then become $V_0$ and $V_0/R_L$, respectively.

## Page-Grounded Details

#### Page 359

D10.7. Standing wave measurements on an air-filled lossless 75-$\Omega$ line show maxima of 18 V and minima of 5 V. The first voltage minimum is located at a scale reading of 17 cm; the second minimum occurs at 37 cm. Find: (a) s; (b) $\lambda$; (c) f; (d) $\Gamma_{L}$; (e) $Z_{L}$.

Ans. (a) 3.60; (b) 0.400 m; (c) 750 MHz; (d) 0.57$\angle$130; (e) 24.2 +j32.6$\Omega$

D10.8. A normalized load, $z_{L}=2-j1$, is located at $z=0$ on a lossless 50-$\Omega$ line. Let the wavelength be 100 cm. (a) A short-circuited stub is to be located at $z=-d$. What is the shortest suitable value for $d$? (b) What is the shortest possible length of the stub? Find s: (c) on the main line for $z<-d$; (d) on the main line for $-d<z<0$; (e) on the stub.

Ans. (a) 12.5 cm; (b) 12.5 cm; (c) 1.00; (d) 2.62; (e) $\infty$

#### 10.14 TRANSIENT ANALYSIS

Throughout most of this chapter, we have considered the operation of transmission lines under steady-state conditions, in which voltage and current were sinusoidal and at a single frequency. In this section we move away from the simple time-harmonic case and consider transmission line responses to voltage step functions and pulses,

[Truncated for analysis]

#### Page 360

Figure 10.19 (a) Closing the switch at time $t=0$ initiates voltage and current waves $V^{+}$ and $l^{+}$. The leading edge of both waves is indicated by the dashed line, which propagates in the lossless line toward the load at velocity $v$. In this case, $V^{+}=V_{0}$; the line voltage is $V^{+}$ everywhere to the left of the leading edge, where current is $l^{+}=V^{+}/Z_{0}$. To the right of the leading edge, voltage and current are both zero. Clockwise current, indicated here, is treated as positive and will occur when $V^{+}$ is positive. (b) Voltage across the load resistor as a function of time, showing the one-way transit time delay, $l/v$.

At the front end of the line is a battery of voltage $V_{0}$, which is connected to the line by closing a switch. At time $t=0$, the switch is closed, and the line voltage at $z=0$ becomes equal to the battery voltage. This voltage, however, does not appear across the load until adequate time has elapsed for the propagation delay. Specifically, at $t=0$, a voltage wave is initiated in the line at the battery end, which then propagates toward the load. The leading edge of the wave, labeled $V^{+}$ in Figure 10.

[Truncated for analysis]

#### Page 361

does not reflect, as the load is matched. The transient phase is thus over, and the load voltage is equal to the battery voltage. A plot of load voltage as a function of time is shown in Figure 10.19b, indicating the propagation delay of $t=l/v$ .

Associated with the voltage wave $V^{+}$ is a current wave whose leading edge is of value $I^{+}$. This wave is a propagating step function as well, whose value at all points to the left of $V^{+}$ is $I^{+}=V^{+}/Z_{0}$; at all points to the right, current is zero. A plot of current through the load as a function of time will thus be identical in form to the voltage plot of Figure 10.19b, except that the load current at $t=l/v$ will be $I_{L}=V^{+}/Z_{0}=V_{0}/R_{L}$.

We next consider a more general case, in which the load of Figure 10.19a is again a resistor but is not matched to the line ($R_{L}\neq Z_{0}$). Reflections will thus occur at the load, complicating the problem. At $t=0$, the switch is closed as before and a voltage wave, $V_{1}^{+}=V_{0}$, propagates to the right. Upon reaching the load, however, the wave will now reflect, producing a back-propagating wave, $V_{1}^{-}$. The relation between $ V_{1}^

[Truncated for analysis]

## Core Ideas

- Transient signals contain many frequency components even when represented as simple steps or pulses.
- Frequency-dependent $\beta(\omega)$ can produce pulse broadening.
- A switched source launches a propagating voltage step rather than changing the entire line instantaneously.
- The one-way transit time is $l/v$.
- Behind the forward edge, $V=V^+$ and $I=V^+/Z_0$.
- Ahead of the edge, voltage and current retain their initial values.
- A matched load has no reflected wave.

## Source Anchors

- Page 359 introduces transient analysis for steps, pulses, digital signals, and line energy storage.
- Page 359 limits the initial treatment to lossless, nondispersive lines and discusses frequency-dependent $\beta(\omega)$ and pulse broadening.
- Source figure S1.P360.F1, Figure 10.19a, shows the propagating voltage and current leading edges.
- Source figure S1.P360.F2, Figure 10.19b, shows the load-voltage delay $l/v$.
- Pages 360 and 361 state $V^+=V_0$ and $I^+=V^+/Z_0$.
- Page 361 explains that the matched load produces no reflection.

## Related Pages

- [[multiple-reflections-and-transient-steady-state|Multiple Reflections and Transient Steady State]]
- [[voltage-and-current-reflection-diagrams|Voltage and Current Reflection Diagrams]]
- [[initially-charged-lines-and-pulse-formation|Initially Charged Lines and Pulse Formation]]

## Concept Dependencies

- contrasts-with: [[multiple-reflections-and-transient-steady-state|Multiple Reflections and Transient Steady State]]
- enables: [[voltage-and-current-reflection-diagrams|Voltage and Current Reflection Diagrams]]
