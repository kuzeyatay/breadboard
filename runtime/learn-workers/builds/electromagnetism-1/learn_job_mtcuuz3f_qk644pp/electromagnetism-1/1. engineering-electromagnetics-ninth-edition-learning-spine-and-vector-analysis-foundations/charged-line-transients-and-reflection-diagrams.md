---
title: "1.206 Charged-Line Transients and Reflection Diagrams"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 371", "Page 372", "Page 379", "Page 380"]
related: ["transmission-line-reflection-and-standing-wave-analysis", "wave-superposition-and-current-standing-waves", "traveling-wave-direction-and-sinusoidal-solutions"]
---

# 1.206 Charged-Line Transients and Reflection Diagrams

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 371, Page 372, Page 379, Page 380

A charged transmission line responds to switching through a sequence of forward- and backward-traveling voltage and current waves. The terminal voltage during each interval is found by moving along the appropriate axis of a reflection diagram and summing every wave that has reached that terminal. In the worked case, the resistor voltage changes after each round-trip interval of duration $2l/v$, taking the successive values $40$ V, $-20$ V, $10$ V, and $-5$ V. Current waves are obtained from their associated voltage waves using the characteristic impedance, with the sign depending on propagation direction. The resistor current can also be checked by dividing the plotted resistor voltage by $-R_g$ for the circuit orientation used in the example. Boundary conditions provide an independent validation: because the opposite end is open, its total current must remain zero at every time. The chapter problems generalize this method to mismatched source and load resistances, finite-duration pulses, switches placed inside a line, frozen-wave generators, and networks whose source and load voltages and battery currents must all be plotted.

## Page-Grounded Details

#### Page 371

moving up the axis, we add the voltages of both waves to our total at each occurrence. The voltage within each time interval is thus:
$$
\begin{array} { r l } & { V_{R}=V_{0}+V_{1}^{+}=40~{}\mathrm{V}} & { ( 0 < t < 2l/v ) } \\ { = V_{0}+V_{1}^{+}+V_{1}^{-}+V_{2}^{+}=-20~{}\mathrm{V}} & { ( 2l/v < t < 4l/v ) } \\ { = V_{0}+V_{1}^{+}+V_{1}^{-}+V_{2}^{+}+V_{2}^{-}+V_{3}^{+}=10~{}\mathrm{V}} & { ( 4l/v < t < 6l/v ) } \\ { = V_{0}+V_{1}^{+}+V_{1}^{-}+V_{2}^{+}+V_{2}^{-}+V_{3}^{+}+V_{3}^{-}+V_{4}^{+}=-5~{}\mathrm{V} } & { ( 6l/v < t < 8l/v ) } \end{array}
$$
The resulting voltage plot over the desired time range is shown in Figure 10.28a.

Figure 10.28 Resistor voltage (a) and current (b) as functions of time for the line of Figure 10.25, with values as specified in Example 10.12.

#### Page 372

The current through the resistor is most easily obtained by dividing the voltages in Figure 10.28a by $-R_{g}$. As a demonstration, we can also use the current diagram of Figure 10.22a to obtain this result. Using (120) and (121), we evaluate the current waves as follows:
$$
\begin{array}[]{rcl}I_{1}^{+}&=&V_{1}^{+}/Z_{0}=-1.2\ A\\ I_{1}^{-}&=&-V_{1}^{-}/Z_{0}=+1.2\ A\\ I_{2}^{+}&=&-I_{2}^{-}&=V_{2}^{+}/Z_{0}=+0.6\ A\\ I_{3}^{+}&=&-I_{3}^{-}&=V_{3}^{+}/Z_{0}=-0.30\ A\\ I_{4}^{+}&=&-I_{4}^{-}&=V_{4}^{+}/Z_{0}=+0.15\ A\end{array}
$$
Using these values on the current reflection diagram, Figure 10.22a, we add up currents in the resistor in time by moving up the left-hand axis, as we did with the voltage diagram. The result is shown in Figure 10.28b. As a further check to the correctness of our diagram construction, we note that current at the open end of the line ($Z=l$) must always be zero. Therefore, summing currents up the right-hand axis must give a zero result for all time. The reader is encouraged to verify this.

#### REFERENCES

1. White, H. J., P. R. Gillette, and J. V. Lebacqz. "The Pulse-Forming Network." Chapter 6 in Pulse Generators, edited by G. N, Glasoe and J. V.

[Truncated for analysis]

#### Page 379

Figure 10.36 See Problem 10.36.

10.37 In the transmission line of Figure 10.20, $R_{g}=Z_{0}=50\Omega$, and $R_{L}=25\Omega$. Determine and plot the voltage at the load resistor and the current in the battery as functions of time by constructing appropriate voltage and current reflection diagrams.

10.38 Repeat Problem 10.37, with $Z_{0}=50\Omega$, and $R_{L}=R_{g}=25\Omega$. Carry out the analysis for the time period $0<t<8l/v$.

10.39 In the transmission line of Figure 10.20, $Z_{0}=50\Omega$, and $R_{L}=R_{g}=25\Omega$. The switch is closed at $t=0$ and is opened again at time $t=l/4v$, thus creating a rectangular voltage pulse in the line. Construct an appropriate voltage reflection diagram for this case, and use it to make a plot of the voltage at the load resistor as a function of time for $0<t<8l/v$ (note that the effect of opening the switch is to initiate a second voltage wave, whose value is such that it leaves a net current of zero in its wake).

10.40 In the charged line of Figure 10.25, the characteristic impedance is $Z_{0}=100\Omega$, and $R_{g}=300\Omega$. The line is charged to initial voltage, $V_{0}=160V$, and the switch is closed at $

[Truncated for analysis]

#### Page 380

Figure 10.38 See Problem 10.42.

Figure 10.39 See Problem 10.43.

10.42  A simple _frozen wave generator_ is shown in Figure 10.38. Both switches are closed simultaneously at $t=0$. Construct an appropriate voltage reflection diagram for the case in which $R_{L}=Z_{0}$. Determine and plot the load resistor voltage as a function of time.

10.43  In Figure 10.39, $R_{L}=Z_{0}$ and $R_{g}=Z_{0}/3$. The switch is closed at $t=0$. Determine and plot as functions of time ($a$) the voltage across $R_{L}$; ($b$) the voltage across $R_{g}$; ($c$) the current through the battery.

## Core Ideas

- Terminal values are cumulative sums of all wave components that have arrived by a given time.
- Successive terminal changes occur at line transit or round-trip times determined by $l/v$.
- For a voltage wave, current magnitude is related by $|I|=|V|/Z_0$.
- Forward and backward current waves use opposite voltage-to-current sign conventions.
- An open-circuit termination requires the total current at that end to be zero for all time.
- Opening a switch can launch a second wave chosen to leave zero current behind it.
- Reflection diagrams can produce piecewise plots of load voltage, source voltage, resistor current, and battery current.

## Source Anchors

- For $0<t<2l/v$, the resistor voltage is $V_R=V_0+V_1^+=40\,\mathrm{V}$.
- For $2l/v<t<4l/v$, the cumulative resistor voltage is $-20\,\mathrm{V}$; the next two intervals give $10\,\mathrm{V}$ and $-5\,\mathrm{V}$.
- The listed current waves include $I_1^+=-1.2\,\mathrm{A}$, $I_1^-=+1.2\,\mathrm{A}$, $I_2^+=-I_2^-=+0.6\,\mathrm{A}$, $I_3^+=-I_3^-=-0.30\,\mathrm{A}$, and $I_4^+=-I_4^-=+0.15\,\mathrm{A}$.
- Figure 10.28 shows resistor voltage and current versus time and should be retained as source figures S1.P371.F1 and S1.P372.F1 for a regenerable reflection-timeline visual.
- Problem 10.39 states that opening the switch initiates a second voltage wave whose value leaves a net current of zero in its wake.
- Problems 10.37 through 10.43 request voltage and current reflection diagrams for several switched-line configurations.
- Figures 10.37, 10.38, and 10.39 should be retained as S1.P379.F1, S1.P380.F1, and S1.P380.F2 and attached to their switched-line procedures.

## Related Pages

- [[transmission-line-reflection-and-standing-wave-analysis|Transmission-Line Reflection and Standing-Wave Analysis]]
- [[wave-superposition-and-current-standing-waves|Wave Superposition and Current Standing Waves]]
- [[traveling-wave-direction-and-sinusoidal-solutions|Traveling-Wave Direction and Sinusoidal Solutions]]

## Concept Dependencies

- applies-to: [[transmission-line-reflection-and-standing-wave-analysis|Transmission-Line Reflection and Standing-Wave Analysis]]
- depends-on: [[wave-superposition-and-current-standing-waves|Wave Superposition and Current Standing Waves]]
- related: [[traveling-wave-direction-and-sinusoidal-solutions|Traveling-Wave Direction and Sinusoidal Solutions]]
