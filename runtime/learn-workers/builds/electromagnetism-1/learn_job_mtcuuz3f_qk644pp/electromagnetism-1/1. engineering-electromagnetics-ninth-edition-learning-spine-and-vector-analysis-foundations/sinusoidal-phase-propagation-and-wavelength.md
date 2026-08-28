---
title: "1.168 Sinusoidal Phase Propagation and Wavelength"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 323", "Page 324", "Section 10.4: Lossless Propagation of Sinusoidal Voltages"]
related: ["lossless-traveling-wave-solutions", "characteristic-impedance-and-wave-current-direction", "distributed-versus-lumped-circuit-models"]
---

# 1.168 Sinusoidal Phase Propagation and Wavelength

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 323, Page 324, Section 10.4: Lossless Propagation of Sinusoidal Voltages

A practical signal can be decomposed into sinusoidal frequency components, propagated according to the line's frequency-dependent behavior, and recombined in the time domain. For a single frequency $f=\omega/(2\pi)$, the real instantaneous voltage has the form
$$
\mathcal{V}(z,t)=|V_0|\cos(\omega t\pm\beta z+\phi)
$$
 The minus sign gives forward propagation, $\mathcal{V}_f=|V_0|\cos(\omega t-\beta z)$, and the plus sign gives backward propagation, $\mathcal{V}_b=|V_0|\cos(\omega t+\beta z)$. The phase constant is
$$
\beta=\frac{\omega}{v_p}
$$
 where $v_p$ is phase velocity. While $\omega$ measures phase change per unit time in rad/s, $\beta$ measures phase change per unit distance in rad/m. One spatial cycle requires $\beta\lambda=2\pi$, so
$$
\lambda=\frac{2\pi}{\beta}=\frac{v_p}{f}
$$
## Page-Grounded Details

#### Page 323

Figure 10.4 Current directions in waves having positive voltage polarity.

to the current in a single propagating wave. Using (19), we write the characteristic impedance as
$$
Z_{0}=Lv=\sqrt{\frac{L}{C}}\quad{(24)}
$$
By inspecting (14) and (23), we now note that
$$
V^{+}=Z_{0}I^{+}\quad{(25a)}
$$
and
$$
V^{-}=-Z_{0}I^{-}\quad{(25b)}
$$
The significance of the preceding relations can be seen in Figure 10.4. The figure shows forward- and backward-propagating voltage waves, $V^{+}$ and $V^{-}$, both of which have positive polarity. The currents that are associated with these voltages will flow in opposite directions. We define positive current as having a clockwise flow in the line, and negative current as having a counterclockwise flow. The minus sign in (25b) thus assures that negative current will be associated with a backward-propagating wave that has positive polarity. This is a general convention, applying to lines with losses also. Propagation with losses is studied by solving (11) under the assumption that either R or G (or both) are not zero. We will do this in Section 10.7 under the special case of sinusoidal voltages and currents. Sinusoids in lossless transmissi

[Truncated for analysis]

#### Page 324

lines. In such studies, the effect of the transmission line on any signal can be deter-mined by noting the effects on the frequency components. This means that one can effectively propagate the spectrum of a given signal, using frequency-dependent line parameters, and then reassemble the frequency components into the resultant signal in time domain. Our objective in this section is to obtain an understanding of sinu-soidal propagation and the implications on signal behavior for the lossless line case.

We begin by assigning sinusoidal functions to the voltage functions in Eq. (14). Specifically, we consider a specific frequency, $f=\omega/2\pi$, and write $f_{1}=f_{2}=V_{0}\cos(\omega t+\phi)$. By convention, the cosine function is chosen; the sine is obtainable, as we know, by setting $\phi=-\pi/2$. We next replace $t$ with $(t\pm z/v_{p})$, obtaining
$$
\mathcal{V}(z,t)=\absolutevalue{V_{0}}\cos[\omega(t\pm z/v_{p})+\phi]=\absolutevalue{V_{0}}\cos[\omega t\pm\beta z+\phi] \quad{(26)}
$$
where we have assigned a new notation to the velocity, which is now called the phase velocity, $v_{p}$. This is applicable to a pure sinusoid (having a single frequency) and will be

[Truncated for analysis]

## Core Ideas

- Sinusoidal components form the basis of frequency-domain line analysis.
- Forward propagation uses phase $\omega t-\beta z$.
- Backward propagation uses phase $\omega t+\beta z$.
- Phase constant is $\beta=\omega/v_p$ in rad/m.
- Wavelength is $\lambda=2\pi/\beta=v_p/f$.

## Source Anchors

- Page 323 motivates sinusoidal analysis through decomposition and reconstruction of practical signals.
- Equation (26) on Page 324 gives the sinusoidal voltage with phase velocity and phase constant.
- Equations (27a) and (27b) distinguish forward and backward instantaneous voltage waves.
- Equation (28) defines $\beta=\omega/v_p$.
- Equations (29) and (30) identify spatial periodicity and $\lambda=2\pi/\beta=v_p/f$.

## Related Pages

- [[lossless-traveling-wave-solutions|Lossless Traveling-Wave Solutions]]
- [[characteristic-impedance-and-wave-current-direction|Characteristic Impedance and Wave Current Direction]]
- [[distributed-versus-lumped-circuit-models|Distributed Versus Lumped Circuit Models]]

## Concept Dependencies

- example-of: [[lossless-traveling-wave-solutions|Lossless Traveling-Wave Solutions]]
- related: [[characteristic-impedance-and-wave-current-direction|Characteristic Impedance and Wave Current Direction]]
- applies-to: [[distributed-versus-lumped-circuit-models|Distributed Versus Lumped Circuit Models]]
