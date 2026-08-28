---
title: "1.204 Worked Transient with a Matched Generator"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 365", "Page 366", "Page 367", "Page 368"]
related: ["multiple-reflections-and-transient-steady-state", "voltage-and-current-reflection-diagrams", "matched-line-step-propagation-and-transit-delay"]
---

# 1.204 Worked Transient with a Matched Generator

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 365, Page 366, Page 367, Page 368

Example 10.11 applies reflection diagrams to a 50 $\Omega$ line driven by a 10 V battery through $R_g=50\ \Omega$ and terminated by $R_L=25\ \Omega$. Initial voltage division between $R_g$ and $Z_0$ launches $V_1^+=5$ V. The load reflection coefficient is $\Gamma_L=(25-50)/(25+50)=-1/3$, so the reflected wave is $V_1^-=-5/3$ V. Because $R_g=Z_0$, the generator is matched and has $\Gamma_g=0$, so the returning wave is absorbed and no further waves appear. The current waves are found independently from their voltage waves: $I_1^+=5/50=0.1$ A and $I_1^-=-(-5/3)/50=1/30$ A. The load reaches $5-5/3=10/3$ V when the first wave and its load reflection arrive. The battery current reaches $0.1+1/30=2/15$ A after the reflected wave returns. These values agree with the final lumped circuit consisting of 50 $\Omega$ and 25 $\Omega$ in series.

## Page-Grounded Details

#### Page 365

Figure 10.22 (a) Current reflection diagram for the line of Figure 10.20 as obtained from the voltage diagram of Figure 10.21a. (b) Current at the $z=3l/4$ position as determined from the current reflection diagram, showing the expected steady-state value of $V_{0}/(R_{L}+R_{g})$.

In Figure 10.20, $R_{g}=Z_{0}=50 \Omega$, $R_{L}=25 \Omega$, and the battery voltage is $V_{0}=10\ \text{V}$. The switch is closed at time $t=0$. Determine the voltage at the load resistor and the current in the battery as functions of time.

Solution. Voltage and current reflection diagrams are shown in Figure 10.23a and b. At the moment the switch is closed, half the battery voltage appears across the

EXAMPLE 10.11

#### Page 366

Figure 10.23 Voltage (a) and current (b) reflection diagrams for Example 10.11.

50-Ω resistor, with the other half comprising the initial voltage wave. Thus $V_{1}^{+} = (1/2)V_{0} = 5$ V. The wave reaches the 25-Ω load, where it reflects with reflection coefficient
$$
\Gamma_{L}=\frac{25-50}{25+50}=-\frac{1}{3}
$$
So $V_{1}^{-}=-(1/3)V_{1}^{+}=-5/3$ V. This wave returns to the battery, where it encounters reflection coefficient $\Gamma_{g}=0$. Thus, no further waves appear; steady state is reached.

Once the voltage wave values are known, the current reflection diagram can be constructed. The values for the two current waves are
$$
I_{1}^{+}=\frac{V_{1}^{+}}{Z_{0}}=\frac{5}{50}=\frac{1}{10}A
$$
#### Page 367

and
$$
I_{\overline{1}}^{-}=-\frac{V_{\overline{1}}^{-}}{Z_{0}}=-(-\frac{5}{3})(\frac{1}{50})=\frac{1}{30}\,\mathrm{A}
$$
Note that no attempt is made here to derive $I_{1}^{-}$ from $I_{1}^{+}$. They are both obtained independently from their respective voltages.

The voltage at the load as a function of time is now found by summing the voltages along the vertical line at the load position. The resulting plot is shown in Figure 10.24$a$. Current in the battery is found by summing the currents along the vertical axis, with the resulting plot shown as Figure 10.24$b$. Note that in steady state, we treat the circuit as lumped, with the battery in series with the 50- and 25-$\Omega$ resistors. Therefore, we expect to see a steady-state current through the battery (and everywhere else) of
$$
I_{B}(\text{steady state})=\frac{10}{50+25}=\frac{1}{7.5}\,\mathrm{A}
$$
Figure 10.24 Voltage across the load ($\alpha$) and current in the battery ($\beta$) as determined from the reflection diagrams of Figure 10.23 (Example 10.11).

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

## Core Ideas

- Matching the generator resistance to $Z_0$ makes $\Gamma_g=0$.
- The initial wave is $V_1^+=V_0Z_0/(R_g+Z_0)=5$ V.
- The 25 $\Omega$ load produces $\Gamma_L=-1/3$.
- The first reflected voltage is $V_1^-=-5/3$ V.
- No waves remain after the first backward wave is absorbed at the generator.
- The steady battery current is $10/(50+25)=2/15$ A.
- The steady load voltage is $10(25)/(50+25)=10/3$ V.
- The reflection diagrams reproduce the ordinary lumped-circuit limit.

## Source Anchors

- Page 365 specifies $R_g=Z_0=50\ \Omega$, $R_L=25\ \Omega$, and $V_0=10$ V.
- Source figure S1.P366.F1, Figure 10.23, shows the example's voltage and current reflection diagrams.
- Page 366 calculates $V_1^+=5$ V, $\Gamma_L=-1/3$, and $V_1^-=-5/3$ V.
- Pages 366 and 367 calculate $I_1^+=1/10$ A and $I_1^-=1/30$ A.
- Source figure S1.P367.F1, Figure 10.24, shows load voltage and battery current versus time.
- Pages 367 and 368 verify the steady-state current $2/15$ A and load voltage $10/3$ V.

## Related Pages

- [[multiple-reflections-and-transient-steady-state|Multiple Reflections and Transient Steady State]]
- [[voltage-and-current-reflection-diagrams|Voltage and Current Reflection Diagrams]]
- [[matched-line-step-propagation-and-transit-delay|Matched-Line Step Propagation and Transit Delay]]

## Concept Dependencies

- example-of: [[multiple-reflections-and-transient-steady-state|Multiple Reflections and Transient Steady State]]
- related: [[matched-line-step-propagation-and-transit-delay|Matched-Line Step Propagation and Transit Delay]]
