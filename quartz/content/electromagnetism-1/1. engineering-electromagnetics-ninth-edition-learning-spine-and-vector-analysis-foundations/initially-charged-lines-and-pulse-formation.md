---
title: "1.205 Initially Charged Lines and Pulse Formation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 368", "Page 369", "Page 370"]
related: ["matched-line-step-propagation-and-transit-delay", "multiple-reflections-and-transient-steady-state", "voltage-and-current-reflection-diagrams"]
---

# 1.205 Initially Charged Lines and Pulse Formation

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 368, Page 369, Page 370

An initially charged transmission line can discharge through a resistor and act as a pulse-forming line. If the line begins at voltage $V_0$ and a resistor $R_g$ is switched across one end, a voltage wave travels toward the open end. The wave must have polarity opposite to $V_0$ because it reduces the voltage behind its front. Current continuity and the resistor voltage relation give
$$
V_1^+=-\frac{V_0Z_0}{Z_0+R_g}
$$
 The open end has $\Gamma_L=1$, while reflections at the resistor depend on $\Gamma_g=(R_g-Z_0)/(R_g+Z_0)$. If $R_g=Z_0$, then $V_1^+=-V_0/2$ and the reflected wave from the open end completes the discharge in one round trip. The resistor receives a rectangular pulse of amplitude $V_0/2$ and duration $2l/v$. If the resistor is mismatched, discharge still completes but requires multiple reflections and produces a more complicated waveform. Example 10.12 begins such a sequence for $Z_0=100\ \Omega$, $R_g=100/3\ \Omega$, and $V_0=160$ V.

## Page-Grounded Details

#### Page 368

Figure 10.25 In an initially charged line, closing the switch as shown initiates a voltage wave of opposite polarity to that of the initial voltage. The wave thus depletes the line voltage and will fully discharge the line in one round trip if $R_g = Z_0$.

This value is also found from the current reflection diagram for $t > 2l/v$. Similarly, the steady-state load voltage should be
$$
V_L(\text{steady state}) = V_0 \frac{R_L}{R_g + R_L} = \frac{(10)(25)}{50 + 25} = \frac{10}{3}\, \mathrm{V}
$$
which is found also from the voltage reflection diagram for $t > l/v$.

#### 10.14.4 Initially Charged Lines

Another type of transient problem involves lines that are _initially charged_. In these cases, the manner in which the line discharges through a load is of interest. Consider the situation shown in Figure 10.25, in which a charged line of characteristic impedance $Z_0$ is discharged through a resistor of value $R_g$ when a switch at the resistor location is closed. $^{5}$ We consider the resistor at the $z = 0$ location; the other end of the line is open (as would be necessary) and is located at $z = l$.

When the switch is closed, current $I_R$ begins to flow thr

[Truncated for analysis]

#### Page 369

fact be negative (or of opposite sign to $V_{0}$). The line discharge process is analyzed by keeping track of $V_{1}^{+}$ as it propagates and undergoes multiple reflections at the two ends. Voltage and current reflection diagrams are used for this purpose in much the same way as before.

Referring to Figure 10.25, we see that for positive $V_{0}$ the current flowing through the resistor will be counterclockwise and hence negative. We also know that conti-nuity requires that the resistor current be equal to the current associated with the voltage wave, or
$$
I_{R}=I_{1}^{+}=\frac{V_{1}^{+}}{Z_{0}}
$$
Now the resistor voltage will be
$$
V_{R}=V_{0}+V_{1}^{+}=-I_{R}R_{g}=-I_{1}^{+}R_{g}=-\frac{V_{1}^{+}}{Z_{0}}R_{g}
$$
where the minus signs arise from the fact that $V_{R}$ (having positive polarity) is pro-duced by the negative current, $I_{R}$. We solve for $V_{1}^{+}$ to obtain
$$
V_{1}^{+}=\frac{-V_{0}Z_{0}}{Z_{0}+R_{g}}\quad{(122)}
$$
Having found $V_{1}^{+}$, we can set up the voltage and current reflection diagrams. The di-agram for voltage is shown in Figure 10.26. Note that the initial condition of voltage $V_{0}$ everywhere on the line is accounted for

[Truncated for analysis]

#### Page 370

Figure 10.27 Voltage across the resistor as a function of time, as determined from the reflection diagram of Figure 10.26, in which $R_{g}=Z_{0}$ ($\Gamma=0$).

A special case of practical importance is that in which the resistor is matched to the line, or $R_{g}=Z_{0}$. In this case, Eq. (122) gives $V_{1}^{+}=-V_{0}/2$. The line fully discharges in one round trip of $V_{1}^{+}$ and produces a voltage across the resistor of value $V_{R}=V_{0}/2$, which persists for time $T=2l/v$. The resistor voltage as a function of time is shown in Figure 10.27. The transmission line in this application is known as a pulse-forming line; pulses that are generated in this way are well formed and of low noise, provided the switch is sufficiently fast. Commercial units are available that are capable of generating high-voltage pulses of widths on the order of a few nanoseconds, using thyratron-based switches.

When the resistor is not matched to the line, full discharge still occurs, but does so over several reflections, leading to a complicated pulse shape.

#### EXAMPLE 10.12

In the charged line of Figure 10.25, the characteristic impedance is $Z_{0}=100\ \Omega$, and $ R_{g}=100/3

[Truncated for analysis]

## Core Ideas

- An initially charged line stores distributed electric and magnetic energy.
- Closing the discharge switch launches a voltage wave opposite in polarity to the initial voltage.
- The initial discharge wave is
$$
V_1^+=-\frac{V_0Z_0}{Z_0+R_g}
$$
- The open end reflects voltage with $\Gamma_L=1$.
- A matched discharge resistor has $R_g=Z_0$ and $\Gamma_g=0$.
- With a matched resistor, the pulse amplitude is $V_0/2$.
- The matched-line pulse duration is $2l/v$.
- A mismatched resistor produces a staircase-like sequence of multiple reflections.

## Source Anchors

- Source figure S1.P368.F1, Figure 10.25, shows the initially charged line and the opposite-polarity discharge wave.
- Pages 368 and 369 explain why $V_1^+$ must be negative relative to $V_0$.
- Page 369 derives $V_1^+=-V_0Z_0/(Z_0+R_g)$ as Eq. (122).
- Source figure S1.P369.F1, Figure 10.26, shows the voltage reflection diagram with initial voltage $V_0$ on the time-zero axis.
- Source figure S1.P370.F1, Figure 10.27, shows the matched-resistor pulse of amplitude $V_0/2$ and duration $2l/v$.
- Page 370 identifies this device as a pulse-forming line and notes nanosecond-scale commercial pulse generation.
- Page 370 begins Example 10.12 with $\Gamma_g=-1/2$, $V_1^+=V_1^-=-120$ V, $V_2^+=V_2^-=60$ V, $V_3^+=V_3^-=-30$ V, and $V_4^+=V_4^-=15$ V.

## Related Pages

- [[matched-line-step-propagation-and-transit-delay|Matched-Line Step Propagation and Transit Delay]]
- [[multiple-reflections-and-transient-steady-state|Multiple Reflections and Transient Steady State]]
- [[voltage-and-current-reflection-diagrams|Voltage and Current Reflection Diagrams]]

## Concept Dependencies

- depends-on: [[voltage-and-current-reflection-diagrams|Voltage and Current Reflection Diagrams]]
- applies-to: [[multiple-reflections-and-transient-steady-state|Multiple Reflections and Transient Steady State]]
- contrasts-with: [[matched-line-step-propagation-and-transit-delay|Matched-Line Step Propagation and Transit Delay]]
