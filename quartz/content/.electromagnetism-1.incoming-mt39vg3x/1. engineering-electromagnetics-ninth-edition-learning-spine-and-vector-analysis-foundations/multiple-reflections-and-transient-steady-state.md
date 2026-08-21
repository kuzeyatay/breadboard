---
title: "1.202 Multiple Reflections and Transient Steady State"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 361", "Page 362"]
related: ["matched-line-step-propagation-and-transit-delay", "voltage-and-current-reflection-diagrams", "worked-transient-with-a-matched-generator", "forward-and-reflected-voltage-reconstruction"]
---

# 1.202 Multiple Reflections and Transient Steady State

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 361, Page 362

When a step reaches a mismatched resistive load, it generates a backward wave according to
$$
\Gamma_L=\frac{R_L-Z_0}{R_L+Z_0},\qquad V_1^-=\Gamma_LV_1^+
$$
 The backward wave returns to the source, where it reflects according to
$$
\Gamma_g=\frac{Z_g-Z_0}{Z_g+Z_0}
$$
 An ideal battery has $Z_g=0$ and therefore $\Gamma_g=-1$. Successive waves are products of the load and generator reflection coefficients. Summing all load arrivals gives a geometric series whose steady-state limit is
$$
V_L=V_1^+\frac{1+\Gamma_L}{1-\Gamma_g\Gamma_L}
$$
 For an ideal battery directly connected to the line, $V_1^+=V_0$ and the result reduces to $V_L=V_0$. If the battery has series resistance $R_g$, the initially launched wave is set by voltage division:
$$
V_1^+=\frac{V_0Z_0}{R_g+Z_0}
$$
 and the source reflection coefficient becomes $(R_g-Z_0)/(R_g+Z_0)$. Repeated reflections then converge to the ordinary lumped-circuit steady state.

## Page-Grounded Details

#### Page 361

does not reflect, as the load is matched. The transient phase is thus over, and the load voltage is equal to the battery voltage. A plot of load voltage as a function of time is shown in Figure 10.19b, indicating the propagation delay of $t=l/v$ .

Associated with the voltage wave $V^{+}$ is a current wave whose leading edge is of value $I^{+}$. This wave is a propagating step function as well, whose value at all points to the left of $V^{+}$ is $I^{+}=V^{+}/Z_{0}$; at all points to the right, current is zero. A plot of current through the load as a function of time will thus be identical in form to the voltage plot of Figure 10.19b, except that the load current at $t=l/v$ will be $I_{L}=V^{+}/Z_{0}=V_{0}/R_{L}$.

We next consider a more general case, in which the load of Figure 10.19a is again a resistor but is not matched to the line ($R_{L}\neq Z_{0}$). Reflections will thus occur at the load, complicating the problem. At $t=0$, the switch is closed as before and a voltage wave, $V_{1}^{+}=V_{0}$, propagates to the right. Upon reaching the load, however, the wave will now reflect, producing a back-propagating wave, $V_{1}^{-}$. The relation between $ V_{1}^

[Truncated for analysis]

#### Page 362

Figure 10.20 With series resistance at the battery location, voltage division occurs when the switch is closed, such that $V_{0}=V_{rg}+V_{1}^{+}$. Shown is the first reflected wave, which leaves voltage $V_{1}^{+}+V_{1}^{-}$ behind its leading edge. Associated with the wave is current $I_{1}^{-}$, which is $-V_{1}^{-}/Z_{0}$. Counterclockwise current is treated as negative and will occur when $V_{1}^{-}$ is positive.

Allowing time to approach infinity, the second term in parentheses in (117) becomes the power series expansion for the expression $1/(1-\Gamma_{g}\Gamma_{L})$. Thus, in steady state we obtain
$$
V_{L}=V_{1}^{+}\bigg{(}\frac{1+\Gamma_{L}}{1-\Gamma_{g}\Gamma_{L}}\bigg{)}
$$
In our present example, $V_{1}^{+}=V_{0}$ and $\Gamma_{g}=-1$. Substituting these into (118), we find the expected result in steady state: $V_{L}=V_{0}$.

A more general situation would involve a nonzero impedance at the battery location, as shown in Figure 10.20. In this case, a resistor of value $R_{g}$ is positioned in series with the battery. When the switch is closed, the battery voltage appears across the series combination of $R_{g}$ and the line characteristic impedan

[Truncated for analysis]

## Core Ideas

- The load reflection coefficient controls each reflection at the load.
- The generator reflection coefficient controls each reflection at the source.
- An ideal voltage source has $\Gamma_g=-1$.
- A source matched to the line has $\Gamma_g=0$.
- Each round trip introduces another factor of $\Gamma_g\Gamma_L$.
- The load-voltage sequence forms a geometric series.
- The steady-state load voltage is
$$
V_L=V_1^+\frac{1+\Gamma_L}{1-\Gamma_g\Gamma_L}
$$
- A series source resistance reduces the initial launched voltage by voltage division.

## Source Anchors

- Page 361 gives the resistive-load reflection coefficient as Eq. (115).
- Page 361 gives the ideal-battery reflection coefficient $\Gamma_g=-1$ as Eq. (116).
- Pages 361 and 362 express load voltage as a sequence of incident and reflected waves.
- Page 361 factors the sequence into Eq. (117).
- Page 362 evaluates the geometric series to obtain the steady-state load voltage.
- Source figure S1.P362.F1, Figure 10.20, shows a battery with series resistance and the first reflected wave.
- Page 362 gives $V_1^+=V_0Z_0/(R_g+Z_0)$ and $\Gamma_g=(R_g-Z_0)/(R_g+Z_0)$.

## Related Pages

- [[matched-line-step-propagation-and-transit-delay|Matched-Line Step Propagation and Transit Delay]]
- [[voltage-and-current-reflection-diagrams|Voltage and Current Reflection Diagrams]]
- [[worked-transient-with-a-matched-generator|Worked Transient with a Matched Generator]]
- [[forward-and-reflected-voltage-reconstruction|Forward and Reflected Voltage Reconstruction]]

## Concept Dependencies

- enables: [[voltage-and-current-reflection-diagrams|Voltage and Current Reflection Diagrams]]
- related: [[forward-and-reflected-voltage-reconstruction|Forward and Reflected Voltage Reconstruction]]
