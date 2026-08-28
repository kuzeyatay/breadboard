---
title: "1.164 Telegraphist's Equations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 319", "Page 320", "Section 10.2: The Transmission Line Equations"]
related: ["per-unit-length-transmission-line-model", "general-transmission-line-wave-equations", "lossless-traveling-wave-solutions", "characteristic-impedance-and-wave-current-direction"]
---

# 1.164 Telegraphist's Equations

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 319, Page 320, Section 10.2: The Transmission Line Equations

Applying KVL to the symmetric incremental line section and retaining terms that survive as $\Delta z\to0$ gives the voltage equation
$$
\frac{\partial V}{\partial z}=-\left(RI+L\frac{\partial I}{\partial t}\right)
$$
 The negative sign indicates that voltage decreases in the positive $z$ direction because of resistive and inductive drops. Applying KCL at the section's central node gives the current equation
$$
\frac{\partial I}{\partial z}=-\left(GV+C\frac{\partial V}{\partial t}\right)
$$
 Current decreases because some current flows through dielectric conductance and charges the distributed capacitance. These coupled first-order partial differential equations are the telegraphist's equations. They describe how voltage and current jointly evolve with position and time on a uniform transmission line. Neither variable can generally be solved independently until the equations are combined into second-order wave equations.

## Page-Grounded Details

#### Page 319

Figure 10.3 Lumped-element model of a short transmission line section with losses. The length of the section is $\Delta z$. Analysis involves applying Kirchoff's voltage and current laws (KVL and KCL) to the indicated loop and node, respectively.

First, KVL is applied to the loop that encompasses the entire section length, as shown in Figure 10.3:
$$
\begin{align*}V=&\,\frac{1}{2}RI\Delta z+\frac{1}{2}L\frac{\partial I}{\partial t}\Delta z+\frac{1}{2}L\Big(\frac{\partial I}{\partial t}+\frac{\partial\Delta I}{\partial t}\Big)\Delta z\\ &+\frac{1}{2}R(I+\Delta I)\Delta z+(V+\Delta V)\end{align*}\qquad(1)
$$
We can solve Eq. (1) for the ratio, $\Delta V/\Delta z$, obtaining:
$$
\frac{\Delta V}{\Delta z}=-\Big(RI+L\frac{\partial I}{\partial t}+\frac{1}{2}L\frac{\partial\Delta I}{\partial t}+\frac{1}{2}R\Delta I\Big)\qquad(2)
$$
Next, we write:
$$
\Delta I=\frac{\partial I}{\partial z}\Delta z\qquad{\rm and}\qquad\Delta V=\frac{\partial V}{\partial z}\Delta z\qquad(3)
$$
which are then substituted into (2) to result in
$$
\frac{\partial V}{\partial z}=-\Big(1+\frac{\Delta z}{2}\frac{\partial}{\partial z}\Big)\Big(RI+L\frac{\partial I}{\partial t}\Big)\qquad(4)
$$
Now, in the

[Truncated for analysis]

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
$$ \frac{\partial^{2}V}{\partial z^{2}}=LC\

[Truncated for analysis]

## Core Ideas

- KVL produces the spatial voltage-change equation.
- KCL produces the spatial current-change equation.
- Series resistance and inductance determine voltage variation.
- Shunt conductance and capacitance determine current variation.
- The two equations are coupled through both space and time derivatives.

## Source Anchors

- Equations (1) through (5) on Page 319 derive $\partial V/\partial z=-(RI+L\,\partial I/\partial t)$.
- Equation (3) identifies $\Delta I=(\partial I/\partial z)\Delta z$ and $\Delta V=(\partial V/\partial z)\Delta z$.
- Equations (6) through (8) on Pages 319 and 320 derive $\partial I/\partial z=-(GV+C\,\partial V/\partial t)$.
- Page 320 identifies Equations (5) and (8) as the telegraphist's equations.

## Related Pages

- [[per-unit-length-transmission-line-model|Per-Unit-Length Transmission-Line Model]]
- [[general-transmission-line-wave-equations|General Transmission-Line Wave Equations]]
- [[lossless-traveling-wave-solutions|Lossless Traveling-Wave Solutions]]
- [[characteristic-impedance-and-wave-current-direction|Characteristic Impedance and Wave Current Direction]]

## Concept Dependencies

- depends-on: [[per-unit-length-transmission-line-model|Per-Unit-Length Transmission-Line Model]]
