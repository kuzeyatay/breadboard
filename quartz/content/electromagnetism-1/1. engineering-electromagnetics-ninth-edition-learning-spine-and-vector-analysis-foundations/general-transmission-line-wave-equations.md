---
title: "1.165 General Transmission-Line Wave Equations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 320", "Page 321", "Section 10.2: The Transmission Line Equations", "Section 10.3: Lossless Propagation"]
related: ["telegraphists-equations", "lossless-traveling-wave-solutions", "per-unit-length-transmission-line-model", "maxwell-equation-application-problems"]
---

# 1.165 General Transmission-Line Wave Equations

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 320, Page 321, Section 10.2: The Transmission Line Equations, Section 10.3: Lossless Propagation

The coupled telegraphist's equations can be decoupled by differentiating and substitution. Differentiating the voltage equation with respect to $z$, differentiating the current equation with respect to $t$, and eliminating current derivatives yields
$$
\frac{\partial^2V}{\partial z^2}=LC\frac{\partial^2V}{\partial t^2}+(LG+RC)\frac{\partial V}{\partial t}+RGV
$$
 An analogous procedure gives
$$
\frac{\partial^2I}{\partial z^2}=LC\frac{\partial^2I}{\partial t^2}+(LG+RC)\frac{\partial I}{\partial t}+RGI
$$
 The $LC$ term supports propagation through distributed energy storage. The first-time-derivative term contains the combined loss effects $LG+RC$, while the $RG$ term couples both dissipative mechanisms directly to the field variable. These are the general wave equations for a uniform line and form the basis for both lossless and lossy propagation analysis.

## Page-Grounded Details

#### Page 320

Then, using (3) and simplifying, we obtain
$$
\frac{\partial I}{\partial z}=-\left(1+\frac{\Delta z}{2}\frac{\partial}{\partial z}\right)\left(GV+C\frac{\partial V}{\partial t}\right)\quad{(7)}
$$
Again, we obtain the final form by allowing $\Delta z$ to be reduced to a negligible magnitude. The result is
$$
\frac{\partial I}{\partial z}=-\left(GV+C\frac{\partial V}{\partial t}\right)\quad{(8)}
$$
The coupled differential equations, (5) and (8), describe the evolution of current and voltage in any transmission line. Historically, they have been referred to as the telegraphist's equations. Their solution leads to the wave equation for the transmission line, which we now undertake. We begin by differentiating Eq. (5) with respect to $z$ and Eq. (8) with respect to $t$, obtaining:
$$
\frac{\partial^{2}V}{\partial z^{2}}=-R\frac{\partial I}{\partial z}-L\frac{\partial^{2}I}{\partial t\partial z}\quad{(9)}
$$
and
$$
\frac{\partial^{2}I}{\partial z\partial t}=-G\frac{\partial V}{\partial t}-C\frac{\partial^{2}V}{\partial t^{2}}\quad{(10)}
$$
Next, Eqs. (8) and (10) are substituted into (9). After rearranging terms, the result is:
$$
\frac{\partial^{2}V}{\partial z^{2}}=LC\

[Truncated for analysis]

#### Page 321

Under this condition, only the first term on the right-hand side of either Eq. (11) or Eq. (12) survives. Eq. (11), for example, becomes
$$
 \frac{\partial^{2}V}{\partial z^{2}}=LC\frac{\partial^{2}V}{\partial t^{2}}\quad{(13)}
$$
In considering the voltage function that will satisfy (13), it is most expedient to simply state the solution, and then show that it is correct. The solution of (13) is of the form:
$$
 V(z,t)= f_{1}(t-\frac{z}{v})+ f_{2}(t+\frac{z}{v})=V^{+}+V^{-}\quad{(14)} $$
where v, the wave velocity, is a constant. The expressions $(t\pm z/v)$ are the arguments of functions $f_{1}$ and $f_{2}$. The identities of the functions themselves are not critical to the solution of (13). Therefore, $f_{1}$ and $f_{2}$ can be any function.

The arguments of $f_{1}$ and $f_{2}$ indicate, respectively, travel of the functions in the forward and backward z directions. We assign the symbols $V^{+}$ and $V^{-}$ to identify the forward and backward voltage wave components. To understand the behavior, consider for example the value of $f_{1}$ (whatever this might be) at the zero value of its argument, occurring when $z=t=0$. Now, as time increases to positive

[Truncated for analysis]

## Core Ideas

- Differentiate and substitute to eliminate one of the two line variables.
- Voltage and current satisfy wave equations of identical mathematical form.
- The $LC$ term controls the second-time-derivative propagation behavior.
- The $LG+RC$ and $RG$ terms arise from line losses.
- Setting $R=G=0$ reduces the equations to the lossless wave equation.

## Source Anchors

- Equations (9) and (10) on Page 320 are intermediate differentiated forms.
- Equation (11) gives the general voltage wave equation.
- Equation (12) gives the general current wave equation.
- Page 320 identifies Equations (11) and (12) as the general transmission-line wave equations.

## Related Pages

- [[telegraphists-equations|Telegraphist's Equations]]
- [[lossless-traveling-wave-solutions|Lossless Traveling-Wave Solutions]]
- [[per-unit-length-transmission-line-model|Per-Unit-Length Transmission-Line Model]]
- [[maxwell-equation-application-problems|Maxwell-Equation Application Problems]]

## Concept Dependencies

- depends-on: [[telegraphists-equations|Telegraphist's Equations]]
- depends-on: [[per-unit-length-transmission-line-model|Per-Unit-Length Transmission-Line Model]]
