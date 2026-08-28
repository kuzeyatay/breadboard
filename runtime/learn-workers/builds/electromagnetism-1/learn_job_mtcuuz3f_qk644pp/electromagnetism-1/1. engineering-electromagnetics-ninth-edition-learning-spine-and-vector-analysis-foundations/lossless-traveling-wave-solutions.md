---
title: "1.166 Lossless Traveling-Wave Solutions"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 321", "Page 322", "Section 10.3: Lossless Propagation"]
related: ["general-transmission-line-wave-equations", "lc-ladder-and-pulse-forming-network", "characteristic-impedance-and-wave-current-direction", "sinusoidal-phase-propagation-and-wavelength"]
---

# 1.166 Lossless Traveling-Wave Solutions

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 321, Page 322, Section 10.3: Lossless Propagation

For a lossless line, $R=G=0$, so the voltage wave equation reduces to
$$
\frac{\partial^2V}{\partial z^2}=LC\frac{\partial^2V}{\partial t^2}
$$
 Its general solution is
$$
V(z,t)=f_1\left(t-\frac{z}{v}\right)+f_2\left(t+\frac{z}{v}\right)=V^++V^-
$$
 The function $f_1$ propagates in the positive $z$ direction because a fixed argument requires $z$ to increase as $t$ increases. The function $f_2$ propagates in the negative $z$ direction because fixed argument requires $z$ to decrease. Applying the chain rule gives $\partial^2f_1/\partial z^2=f_1''/v^2$ and $\partial^2f_1/\partial t^2=f_1''$. Substitution into the wave equation requires
$$
v=\frac{1}{\sqrt{LC}}
$$
 The same propagation speed applies to the current wave.

## Page-Grounded Details

#### Page 321

Under this condition, only the first term on the right-hand side of either Eq. (11) or Eq. (12) survives. Eq. (11), for example, becomes
$$
\frac{\partial^{2}V}{\partial z^{2}}=LC\frac{\partial^{2}V}{\partial t^{2}}\quad{(13)}
$$
In considering the voltage function that will satisfy (13), it is most expedient to simply state the solution, and then show that it is correct. The solution of (13) is of the form:
$$
V(z,t)= f_{1}(t-\frac{z}{v})+ f_{2}(t+\frac{z}{v})=V^{+}+V^{-}\quad{(14)}
$$
where v, the wave velocity, is a constant. The expressions $(t\pm z/v)$ are the arguments of functions $f_{1}$ and $f_{2}$. The identities of the functions themselves are not critical to the solution of (13). Therefore, $f_{1}$ and $f_{2}$ can be any function.

The arguments of $f_{1}$ and $f_{2}$ indicate, respectively, travel of the functions in the forward and backward z directions. We assign the symbols $V^{+}$ and $V^{-}$ to identify the forward and backward voltage wave components. To understand the behavior, consider for example the value of $f_{1}$ (whatever this might be) at the zero value of its argument, occurring when $z=t=0$. Now, as time increases to positive

[Truncated for analysis]

#### Page 322

where $f_{1}^{\prime\prime}$ is the second derivative of $f_{1}$ with respect to its argument. The results in (17) can now be substituted into (13), obtaining
$$
\frac{1}{v^{2}}f_{1}^{\prime\prime}=LCf_{1}^{\prime\prime}\quad{(18)}
$$
We now identify the wave velocity for lossless propagation, which is the condition for equality in (18):
$$
v=\frac{1}{\sqrt{LC}}\quad{(19)}
$$
Performing the same procedure using $f_{2}$ (and its argument) leads to the same expression for $v$.

The form of $v$ as expressed in Eq. (19) confirms our original expectation that the wave velocity would be in some inverse proportion to $L$ and $C$. The same result will be true for current, as Eq. (12) under lossless conditions would lead to a solution of the form identical to that of (14), with velocity given by (19). What is not known yet, however, is the relation between voltage and current.

We have already found that voltage and current are related through the telegraph's equations, (5) and (8). These, under lossless conditions ($R=G=0$), become
$$
\frac{\partial V}{\partial z}=-L\frac{\partial I}{\partial t}\quad{(20)}
$$
$$ \frac{\partial I}{\partial z}=-C\frac{\partial V}{\parti

[Truncated for analysis]

## Core Ideas

- Lossless propagation requires $R=G=0$.
- The general solution is a sum of forward and backward arbitrary waveforms.
- $t-z/v$ denotes positive-$z$ propagation.
- $t+z/v$ denotes negative-$z$ propagation.
- The lossless wave velocity is $v=1/\sqrt{LC}$.

## Source Anchors

- Equation (13) on Page 321 is the lossless voltage wave equation.
- Equation (14) gives the forward and backward arbitrary-function solution.
- Equations (15) through (18) on Pages 321 and 322 verify the solution using the chain rule.
- Equation (19) identifies $v=1/\sqrt{LC}$.

## Related Pages

- [[general-transmission-line-wave-equations|General Transmission-Line Wave Equations]]
- [[lc-ladder-and-pulse-forming-network|LC Ladder and Pulse-Forming Network]]
- [[characteristic-impedance-and-wave-current-direction|Characteristic Impedance and Wave Current Direction]]
- [[sinusoidal-phase-propagation-and-wavelength|Sinusoidal Phase Propagation and Wavelength]]

## Concept Dependencies

- part-of: [[general-transmission-line-wave-equations|General Transmission-Line Wave Equations]]
- related: [[lc-ladder-and-pulse-forming-network|LC Ladder and Pulse-Forming Network]]
