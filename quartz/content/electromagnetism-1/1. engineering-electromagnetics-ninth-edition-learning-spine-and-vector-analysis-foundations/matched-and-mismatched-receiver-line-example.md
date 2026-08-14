---
title: "1.190 Matched and Mismatched Receiver-Line Example"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 344", "Page 345"]
related: ["finite-lossless-line-input-impedance", "voltage-standing-wave-ratio-and-load-recovery", "reflection-at-a-load-discontinuity", "half-wave-and-quarter-wave-impedance-transformation", "average-power-in-a-lossy-transmission-line"]
---

# 1.190 Matched and Mismatched Receiver-Line Example

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 344, Page 345

The receiver-line example integrates matching, phase delay, input impedance, VSWR, and delivered power. Figure 10.8 uses a $2$ m, $300\ \Omega$ lossless line with phase velocity $2.5\times10^8$ m/s at $100$ MHz. With a $300\ \Omega$ load and a source having $300\ \Omega$ internal impedance, both ends are matched. The wavelength is $2.5$ m, $\beta=0.8\pi$ rad/m, and the electrical length is $1.6\pi$ rad. The line input and load voltages both have $30$ V amplitude, but the load voltage is delayed by $1.6\pi$. The delivered power is $1.5$ W. Adding a second $300\ \Omega$ receiver in parallel makes $Z_L=150\ \Omega$, giving $\Gamma=-1/3$, VSWR $2$, and $Z_{\mathrm{in}}=466-j206\ \Omega$. The source then supplies $1.333$ W, less than the matched-load power, and the lossless line delivers that total to the parallel receivers.

## Page-Grounded Details

#### Page 344

if $Z_{02}$ is chosen so that
$$
Z_{02} = \sqrt{Z_{01}Z_{03}}
$$
(103)

This technique is called _quarter-wave matching_ and again is limited to the frequency (or narrow band of frequencies) such that $l = (2m + 1)\lambda/4$. We will encounter more examples of these techniques when we explore electromagnetic wave reflection in Chapter 12. Meanwhile, further examples that involve the use of the input impedance and the VSWR are presented in Section 10.12.

#### 10.12 SOME TRANSMISSION LINE EXAMPLES

In this section, we apply many of the results that we obtained in the previous sections to several typical transmission line problems. We simplify our work by restricting our attention to the lossless line.

We begin by assuming a two-wire 300 $\Omega$ line ($Z_{0} = 300~{}\Omega$), such as the lead-in wire from the antenna to a television or FM receiver. The circuit is shown in Figure 10.8. The line is 2 m long, and the values of $L$ and $C$ are such that the velocity on the line is $2.5\times 10^{8}$ m/s. We will terminate the line with a receiver having an input resistance of 300 $\Omega$ and represent the antenna by its Thevenin equivalent $Z = 300~{}\Omega$ in ser

[Truncated for analysis]

#### Page 345

power to the line. Because there is no reflection and no attenuation, the voltage at the load is 30 V, but it is delayed in phase by$1.6\pi$ rad. Thus,
$$
V_{\mathrm{in}}=30 \cos(2\pi 10^{8} t)\,{\rm V}
$$
whereas
$$
V_{L}=30 \cos(2\pi 10^{8} t-1.6\pi)\,{\rm V}
$$
The input current is
$$
I_{\mathrm{in}}=\frac{V_{\mathrm{in}}}{300}=0.1 \cos(2\pi 10^{8} t) \mathrm{A}
$$
while the load current is
$$
I_{L}=0.1 \cos(2\pi 10^{8} t-1.6\pi)\,{\rm A}
$$
The average power delivered to the input of the line by the source must all be delivered to the load by the line,
$$
P_{\mathrm{in}}=P_{L}=\frac{1}{2} \times 30 \times 0.1=1.5\mathrm{~W}
$$
Now let us connect a second receiver, also having an input resistance of 300 $\Omega$, across the line in parallel with the first receiver. The load impedance is now 150 $\Omega$, the reflection coefficient is
$$
\Gamma=\frac{150-300}{150+300}=-\frac{1}{3}
$$
and the standing wave ratio on the line is
$$
s=\frac{1+\frac{1}{3}}{1-\frac{1}{3}}=2
$$
The input impedance is no longer 300 $\Omega$ but is now
$$ \begin{align*}Z_{\mathrm{in}}&=Z_{0}\frac{Z_{L}\cos\beta l+jZ_{0}\sin\beta l}{Z_{0}\cos\beta l+jZ_{L}\sin\beta l}=300\frac{150\co

[Truncated for analysis]

## Core Ideas

- A $300\ \Omega$ load matches the $300\ \Omega$ line.
- The matched line has $\Gamma=0$ and VSWR $1$.
- At $100$ MHz, the wavelength is $2.5$ m and the electrical length is $1.6\pi$ rad.
- The matched load receives $1.5$ W.
- Two $300\ \Omega$ receivers in parallel produce a $150\ \Omega$ load.
- The mismatched case has $\Gamma=-1/3$ and VSWR $2$.
- The transformed input impedance is $466-j206\ \Omega$.
- The mismatched source-line system delivers $1.333$ W.

## Source Anchors

- Figure 10.8 depicts a line matched at both ends and states that this produces no reflections and maximum load power.
- Pages 344 and 345 specify $Z_0=300\ \Omega$, $l=2$ m, $v_p=2.5\times10^8$ m/s, and $f=100$ MHz.
- The matched case gives $V_{\mathrm{in}}=30\cos(2\pi10^8t)$ V and $V_L=30\cos(2\pi10^8t-1.6\pi)$ V.
- The matched input and load powers are both $1.5$ W.
- The parallel-receiver case gives $\Gamma=-1/3$, $s=2$, and $Z_{\mathrm{in}}=510\angle-23.8^\circ=466-j206\ \Omega$.
- The mismatched case supplies $1.333$ W to the lossless line and load combination.

## Related Pages

- [[finite-lossless-line-input-impedance|Finite Lossless Line Input Impedance]]
- [[voltage-standing-wave-ratio-and-load-recovery|Voltage Standing Wave Ratio and Load Recovery]]
- [[reflection-at-a-load-discontinuity|Reflection at a Load Discontinuity]]
- [[half-wave-and-quarter-wave-impedance-transformation|Half-Wave and Quarter-Wave Impedance Transformation]]
- [[average-power-in-a-lossy-transmission-line|Average Power in a Lossy Transmission Line]]

## Concept Dependencies

- example-of: [[finite-lossless-line-input-impedance|Finite Lossless Line Input Impedance]]
- example-of: [[reflection-at-a-load-discontinuity|Reflection at a Load Discontinuity]]
- example-of: [[voltage-standing-wave-ratio-and-load-recovery|Voltage Standing Wave Ratio and Load Recovery]]
- applies-to: [[average-power-in-a-lossy-transmission-line|Average Power in a Lossy Transmission Line]]
