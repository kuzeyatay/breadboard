---
title: "1.173 Phasor-Domain Telegraphist Equations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 327", "Page 328"]
related: ["complex-instantaneous-voltage-and-phasor-voltage", "propagation-constant-and-traveling-wave-solutions", "characteristic-impedance-of-a-transmission-line"]
---

# 1.173 Phasor-Domain Telegraphist Equations

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 327, Page 328

The time-domain transmission-line equations become ordinary differential equations in position under sinusoidal steady-state analysis. Substituting $\mathcal{V}(z,t)=\operatorname{Re}\{V_s(z)e^{j\omega t}\}$ converts each time derivative into multiplication by $j\omega$, and the common factor $e^{j\omega t}$ cancels. The voltage wave equation becomes $d^2V_s/dz^2=(R+j\omega L)(G+j\omega C)V_s$. The first-order telegraphist equations similarly become $dV_s/dz=-(R+j\omega L)I_s$ and $dI_s/dz=-(G+j\omega C)V_s$. The combinations $Z=R+j\omega L$ and $Y=G+j\omega C$ are the per-unit-length series impedance and shunt admittance. This transformation is central because it replaces explicit time differentiation with algebraic frequency factors while retaining the spatial evolution needed to analyze propagation, attenuation, characteristic impedance, reflections, and finite line behavior.

## Page-Grounded Details

#### Page 327

In real instantaneous form, this becomes
$$
\mathcal{V}(z,t)=\operatorname{Re}[2\,V_{0}\cos(\beta z)e^{j\omega t}]=2\,V_{0}\cos(\beta z)\cos(\omega t)
$$
We recognize this as a standing wave, in which the amplitude varies, as $\cos(\beta z)$, and oscillates in time, as $\cos(\omega t)$. Zeros in the amplitude (nulls) occur at fixed locations, $z_{n}=(m\pi)/(2\beta)$ where $m$ is an odd integer. We extend the concept in Section 10.10, where we explore the voltage standing wave ratio as a measurement technique.

#### 10.6 TRANSMISSION LINE EQUATIONS AND THEIR SOLUTIONS IN PHASOR FORM

We now apply our results of the previous section to the transmission line equations, beginning with the general wave equation, (11). This is rewritten as follows, for the real instantaneous voltage, $\mathcal{V}(z,t)$:

$\frac{\partial^{2}\mathcal{V}}{\partial z^{2}}=LC\frac{\partial^{2}\mathcal{V}}{\partial t^{2}}+(LG+RC)\frac{\partial\mathcal{V}}{\partial t}+RGV$ (38)

We next substitute $\mathcal{V}(z,t)$ as given by the far right-hand side of (37b), noting that the complex conjugate term (c.c.) will form a separate redundant equation. We also use the fact that the operator $ \parti

[Truncated for analysis]

#### Page 328

The wave equation for current will be identical in form to (40). We therefore expect the phasor current to be in the form:
$$
I_{s}(z)=I_{0}^{+}e^{-\gamma z}+I_{0}^{-}e^{\gamma z}\quad{(42b)}
$$
The relation between the current and voltage waves is now found, as before, through the telegraphist's equations, (5) and (8). In a manner consistent with Eq. (37b), we write the sinusoidal current as
$$
I(z,t)=|I_{0}|\cos(\omega t\pm\beta z+\xi)=\frac{1}{2}\frac{(|I_{0}|e^{j\xi})}{I_{0}}e^{\pm j\beta z}e^{j\omega t}+\mathrm{c.c.}=\frac{1}{2}I_{s}(z)e^{j\omega t}+\mathrm{c.c.}
$$
(43)

Substituting the far right-hand sides of (37b) and (43) into (5) and (8) transforms the latter equations as follows:
$$
\frac{\partial\mathcal{V}}{\partial z}=-\left(R\mathcal{I}+L\,\frac{\partial\mathcal{I}}{\partial t}\right)\Rightarrow\frac{dV_{s}}{dz}=-(R+j\omega L)I_{s}=-ZI_{s}\quad{(44a)}
$$
and
$$
\frac{\partial\mathcal{I}}{\partial z}=-\left(G\mathcal{V}+C\,\frac{\partial\mathcal{V}}{\partial t}\right)\Rightarrow\frac{dI_{s}}{dz}=-(G+j\omega C)V_{s}=-YV_{s}\quad{(44b)}
$$
We can now substitute (42a) and (42b) into either (44a) or (44b) [we will use (44a)] to find:
$$ -\gamma V_{0}^{+}e^{-\gam

[Truncated for analysis]

## Core Ideas

- In phasor form, $\partial/\partial t$ becomes multiplication by $j\omega$.
- The common factor $e^{j\omega t}$ divides out after substitution.
- The voltage equation becomes $d^2V_s/dz^2=ZYV_s$.
- The first-order equations are $dV_s/dz=-ZI_s$ and $dI_s/dz=-YV_s$.
- $Z=R+j\omega L$ is series impedance per unit distance.
- $Y=G+j\omega C$ is shunt admittance per unit distance.

## Source Anchors

- Equations (38) through (40) transform the real voltage wave equation into phasor form.
- Equation (40) identifies $Z=R+j\omega L$ and $Y=G+j\omega C$.
- Equations (44a) and (44b) are the phasor-domain telegraphist equations.

## Related Pages

- [[complex-instantaneous-voltage-and-phasor-voltage|Complex Instantaneous Voltage and Phasor Voltage]]
- [[propagation-constant-and-traveling-wave-solutions|Propagation Constant and Traveling-Wave Solutions]]
- [[characteristic-impedance-of-a-transmission-line|Characteristic Impedance of a Transmission Line]]

## Concept Dependencies

- depends-on: [[complex-instantaneous-voltage-and-phasor-voltage|Complex Instantaneous Voltage and Phasor Voltage]]
