---
title: "1.188 Finite Lossless Line Input Impedance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 341", "Page 342", "Page 343"]
related: ["reflection-at-a-load-discontinuity", "standing-wave-decomposition-and-voltage-extrema", "half-wave-and-quarter-wave-impedance-transformation", "matched-and-mismatched-receiver-line-example", "propagation-constant-and-traveling-wave-solutions"]
---

# 1.188 Finite Lossless Line Input Impedance

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 341, Page 342, Page 343

A finite unmatched line supports many individual reflections, but in sinusoidal steady state they can be represented by one net forward wave and one net backward wave. Their total phasor voltage and current define the position-dependent wave impedance $Z_w(z)=V_{sT}(z)/I_{sT}(z)$. Substituting the forward and backward amplitude relations and the load reflection coefficient gives
$$
Z_w(z)=Z_0\frac{Z_L\cos(\beta z)-jZ_0\sin(\beta z)}{Z_0\cos(\beta z)-jZ_L\sin(\beta z)}
$$
 For a line of length $l$ occupying $-l\le z\le0$, evaluation at $z=-l$ produces the input impedance
$$
Z_{\mathrm{in}}=Z_0\frac{Z_L\cos(\beta l)+jZ_0\sin(\beta l)}{Z_0\cos(\beta l)+jZ_L\sin(\beta l)}
$$
 Figure 10.7 shows the finite line, source phasor, generator impedance, load, and equivalent input circuit. The input impedance is the quantity seen by the source and incorporates all steady-state reflections without tracking each reflected wave separately.

## Page-Grounded Details

#### Page 341

Finally, we introduce the symbol s to denote the VSWR. Voltage standing wave ratio is defined as:
$$
s\equiv\frac{V_{sT}(z_{\text{max}})}{V_{sT}(z_{\text{min}})}=\frac{1+|\Gamma|}{1-|\Gamma|}\quad{(92)}
$$
Since the absolute voltage amplitudes have divided out, our measured VSWR permits the immediate evaluation of $|\Gamma|$. The phase of $\Gamma$ is then found by measuring the location of the first maximum or minimum with respect to the load, and then using (86) or (89) as appropriate. Once $\Gamma$ is known, the load impedance can be found, assuming $Z_{0}$ is known.

D10.3. What voltage standing wave ratio results when $\Gamma=\pm 1/2$?

Ans. 3

#### EXAMPLE 10.7

Slotted line measurements yield a VSWR of 5, a 15-cm spacing between successive voltage maxima, and the first maximum at a distance of 7.5 cm in front of the load. Determine the load impedance, assuming a 50-$\Omega$ impedance for the slotted line.

Solution. The 15-cm spacing between maxima is $\lambda/2$, implying a wavelength of 30 cm. Because the slotted line is air-filled, the frequency is $f=c/\lambda=1$ GHz. The first maximum at 7.5 cm is thus at a distance of $\lambda/4$ from the load, which

[Truncated for analysis]

#### Page 342

Figure 10.7 Finite-length transmission line configuration and its equivalent circuit.

Figure 10.7 shows the basic problem. The line, assumed to be lossless, has charac-teristic impedance $Z_{0}$ and is of length l. The sinusoidal voltage source at frequency $\omega$provides phasor voltage $V_{s}$. Associated with the souce is a complex internal impedance,$Z_{g}$, as shown. The load impedance, $Z_{L}$, is also assumed to be complex and is located at$z=0$. The line thus exists along the negative z axis. The easiest method of approaching the problem is not to attempt to analyze every reflection individually, but rather to rec-ognize that in steady state, there will exist one net forward wave and one net backwardwave, representing the superposition of all waves that are incident on the load and allwaves that are reflected from it. We may thus write the total voltage in the line as
$$
V_{sT}(z)=V_{0}^{+}e^{-j\beta z}+V_{0}^{-}e^{j\beta z}\quad{(93)}
$$
in which $V_{0}^{+}$ and $V_{0}^{-}$ are complex amplitudes, composed respectively of the sum of allindividual forward and backward wave amplitudes and phases. In a similar way, wemay write the total current in the line

[Truncated for analysis]

#### Page 343
$$
Z_{\mathrm{in}}=Z_{0}\left[\frac{Z_{L}\cos(\beta l)+jZ_{0}\sin(\beta l)}{Z_{0}\cos(\beta l)+jZ_{L}\sin(\beta l)}\right]
$$
(98)

This is the quantity that we need in order to create the equivalent circuit in Figure 10.7.

One special case is that in which the line length is a half-wavelength, or an inte-ger multiple thereof. In that case,
$$
\beta l=\frac{2\pi}{\lambda}\frac{m\lambda}{2}=m\pi\quad(m=0,1,2,\ldots)
$$
Using this result in (98), we find
$$
Z_{\mathrm{in}}(l=m\lambda/2)=Z_{L}
$$
(99)

For a half-wave line, the equivalent circuit can be constructed simply by removing the line completely and placing the load impedance at the input. This simplifica-tion works, of course, provided the line length is indeed an integer multiple of a half-wavelength. Once the frequency begins to vary, the condition is no longer satis-fied, and (98) must be used in its general form to find $Z_{\mathrm{in}}$.

Another important special case is that in which the line length is an odd multiple of a quarter wavelength:
$$
\beta l=\frac{2\pi}{\lambda}(2m+1)\frac{\lambda}{4}=(2m+1)\frac{\pi}{2}\quad(m=0,1,2,\ldots)
$$
Using this result in (98) leads to
$$ Z_{\mathrm{in}}(l=\lambda/4)=\f

[Truncated for analysis]

## Core Ideas

- Multiple steady-state reflections combine into net forward and backward waves.
- $Z_w(z)$ is the ratio of total phasor voltage to total phasor current.
- The input impedance is $Z_w(-l)$.
- $Z_{\mathrm{in}}$ depends on $Z_0$, $Z_L$, $\beta$, and $l$.
- The line transforms the load impedance according to electrical length.
- The transformed input impedance supports an equivalent source circuit.

## Source Anchors

- Figure 10.7 shows the finite-length transmission-line configuration and equivalent circuit.
- Equations (93) and (94) define total voltage and current using net forward and backward waves.
- Equation (95) defines $Z_w(z)$.
- Equations (96) and (97) reduce the wave-impedance expression.
- Equation (98) gives the line input impedance.

## Related Pages

- [[reflection-at-a-load-discontinuity|Reflection at a Load Discontinuity]]
- [[standing-wave-decomposition-and-voltage-extrema|Standing-Wave Decomposition and Voltage Extrema]]
- [[half-wave-and-quarter-wave-impedance-transformation|Half-Wave and Quarter-Wave Impedance Transformation]]
- [[matched-and-mismatched-receiver-line-example|Matched and Mismatched Receiver-Line Example]]
- [[propagation-constant-and-traveling-wave-solutions|Propagation Constant and Traveling-Wave Solutions]]

## Concept Dependencies

- depends-on: [[reflection-at-a-load-discontinuity|Reflection at a Load Discontinuity]]
- depends-on: [[propagation-constant-and-traveling-wave-solutions|Propagation Constant and Traveling-Wave Solutions]]
