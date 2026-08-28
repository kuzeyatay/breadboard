---
title: "1.203 Voltage and Current Reflection Diagrams"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 362", "Page 363", "Page 364", "Page 365"]
related: ["multiple-reflections-and-transient-steady-state", "worked-transient-with-a-matched-generator", "initially-charged-lines-and-pulse-formation"]
---

# 1.203 Voltage and Current Reflection Diagrams

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 362, Page 363, Page 364, Page 365

A reflection diagram records where each wavefront is located as time advances. Position lies on the horizontal axis and time on the vertical axis, with diagonal lines representing propagation at velocity $v$. A forward wave travels from generator to load in $l/v$; its reflection returns in another $l/v$. To find voltage at a fixed location, draw a vertical reference line and add each wave voltage when its diagonal crosses that reference. This gives both the accumulated voltage and the exact time of each change. Current diagrams use the same wave paths but require a direction-dependent sign convention. For a forward-traveling voltage wave,
$$
I^+=\frac{V^+}{Z_0}
$$
 For a backward-traveling voltage wave,
$$
I^-=-\frac{V^-}{Z_0}
$$
 The minus sign is essential because a positive-polarity backward voltage wave carries current in the negative reference direction. Once each voltage wave is converted independently into its associated current wave, current at any location is found by the same crossing-and-summing procedure.

## Page-Grounded Details

#### Page 362

Figure 10.20 With series resistance at the battery location, voltage division occurs when the switch is closed, such that $V_{0}=V_{rg}+V_{1}^{+}$. Shown is the first reflected wave, which leaves voltage $V_{1}^{+}+V_{1}^{-}$ behind its leading edge. Associated with the wave is current $I_{1}^{-}$, which is $-V_{1}^{-}/Z_{0}$. Counterclockwise current is treated as negative and will occur when $V_{1}^{-}$ is positive.

Allowing time to approach infinity, the second term in parentheses in (117) becomes the power series expansion for the expression $1/(1-\Gamma_{g}\Gamma_{L})$. Thus, in steady state we obtain
$$
V_{L}=V_{1}^{+}\bigg{(}\frac{1+\Gamma_{L}}{1-\Gamma_{g}\Gamma_{L}}\bigg{)}
$$
In our present example, $V_{1}^{+}=V_{0}$ and $\Gamma_{g}=-1$. Substituting these into (118), we find the expected result in steady state: $V_{L}=V_{0}$.

A more general situation would involve a nonzero impedance at the battery location, as shown in Figure 10.20. In this case, a resistor of value $R_{g}$ is positioned in series with the battery. When the switch is closed, the battery voltage appears across the series combination of $R_{g}$ and the line characteristic impedan

[Truncated for analysis]

#### Page 363

Figure 10.21 (a) Voltage reflection diagram for the line of Figure 10.20. A reference line, drawn at $z=3l/4$, is used to evaluate the voltage at that position as a function of time. (b) The line voltage at $z=3l/4$ as determined from the reflection diagram of (a). Note that the voltage approaches the expected $V_{0}R_{L}/(R_{g}+R_{L})$ as time approaches infinity.

wave, $V_{1}^{+}$, starts at the origin, or lower-left corner of the diagram ($z=t=0$). The location of the leading edge of $V_{1}^{+}$ as a function of time is shown as the diagonal line that joins the origin to the point along the right-hand vertical line that corresponds to time $t=l/v$ (the one-way transit time). From there (the load location), the position of the leading edge of the reflected wave, $V_{\overline{1}}^{-}$, is shown as a "reflected" line that joins the $t=l/v$ point on the right boundary to the $t=2l/v$ point on the ordinate. From there (at the battery location), the wave reflects again, forming $V_{2}^{+}$, shown as a line parallel to that for $V_{1}^{+}$. Subsequent reflected waves are shown, and their values are labeled.

#### Page 364

The voltage as a function of time at a given position in the line can now be determined by adding the voltages in the waves as they intersect a vertical line drawn at the desired location. This addition is performed starting at the bottom of the diagram ($t=0$) and progressing upward (in time). Whenever a voltage wave crosses the vertical line, its value is added to the total at that time. For example, the voltage at a location three-fourths the distance from the battery to the load is plotted in Figure 10.21$b$. To obtain this plot, the line $z=(3/4)l$ is drawn on the diagram. Whenever a wave crosses this line, the voltage in the wave is added to the voltage that has accumulated at $z=(3/4)l$ over all earlier times. This general procedure enables one to easily determine the voltage at any specific time and location. In doing so, the terms in (117) that have occurred up to the chosen time are being added, but with information on the time at which each term appears.

#### 10.14.3 Current Reflection Diagram

Line current can be found in a similar way through a current reflection diagram. It is easiest to construct the current diagram directly from the voltage diagram by deter

[Truncated for analysis]

#### Page 365

Figure 10.22 (a) Current reflection diagram for the line of Figure 10.20 as obtained from the voltage diagram of Figure 10.21a. (b) Current at the $z=3l/4$ position as determined from the current reflection diagram, showing the expected steady-state value of $V_{0}/(R_{L}+R_{g})$.

In Figure 10.20, $R_{g}=Z_{0}=50 \Omega$, $R_{L}=25 \Omega$, and the battery voltage is $V_{0}=10\ \text{V}$. The switch is closed at time $t=0$. Determine the voltage at the load resistor and the current in the battery as functions of time.

Solution. Voltage and current reflection diagrams are shown in Figure 10.23a and b. At the moment the switch is closed, half the battery voltage appears across the

EXAMPLE 10.11

## Core Ideas

- Plot position horizontally and time vertically.
- A one-way diagonal spans time $l/v$.
- Each reflection reverses the wave's direction on the diagram.
- Draw a vertical line at the observation position.
- Add a wave when its trajectory crosses the observation line.
- Use $I^+=V^+/Z_0$ for forward waves.
- Use $I^-=-V^-/Z_0$ for backward waves.
- Construct each current wave from its corresponding voltage wave rather than from another current wave.

## Source Anchors

- Source figure S1.P363.F1, Figure 10.21a, shows a voltage reflection diagram with a reference line at $z=3l/4$.
- Source figure S1.P363.F2, Figure 10.21b, shows voltage versus time at $z=3l/4$.
- Page 364 explains the crossing-and-summing procedure for voltage.
- Page 364 gives $I^+=V^+/Z_0$ and $I^-=-V^-/Z_0$ as Eqs. (120) and (121).
- Source figure S1.P365.F1, Figure 10.22a, derives the current reflection diagram from the voltage diagram.
- Source figure S1.P365.F2, Figure 10.22b, shows current versus time at $z=3l/4$.
- Page 365 identifies the expected current limit as $V_0/(R_L+R_g)$.

## Related Pages

- [[multiple-reflections-and-transient-steady-state|Multiple Reflections and Transient Steady State]]
- [[worked-transient-with-a-matched-generator|Worked Transient with a Matched Generator]]
- [[initially-charged-lines-and-pulse-formation|Initially Charged Lines and Pulse Formation]]

## Concept Dependencies

- applies-to: [[worked-transient-with-a-matched-generator|Worked Transient with a Matched Generator]]
