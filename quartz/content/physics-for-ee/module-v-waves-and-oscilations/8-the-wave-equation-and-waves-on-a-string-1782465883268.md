---
title: "8) The wave equation and waves on a string"
date: "2026-06-26T09:24:43.268Z"
source: "user-note"
knowledge_type: "user-note"
tags: ["curvature-produces-transverse-acceleration", "driving-frequency-changes-wavelength-not-speed", "higher-tension-increases-wave-speed", "string-wave-speed-depends-on-medium", "wave-number-differs-from-spring-constant", "mass-density-resists-string-acceleration", "larger-linear-density-lowers-wave-speed", "sinusoidal-waves-satisfy-omega-over-k-speed", "tension-turns-curvature-into-restoring-force", "wave-speed-equals-square-root-tension-over-density", "traveling-shapes-solve-wave-equation", "wave-equation-links-time-acceleration-to-curvature"]
---

## The wave equation and waves on a string

The previous subsection described travelling waves kinematically. We learned how to write a moving disturbance as $g(x-vt)$ or $g(x+vt)$, and how a sinusoidal travelling wave can be written as

$$
y(x,t)=A\cos(kx-\omega t+\phi).
$$

That description tells us what a travelling wave looks like, but it does not yet explain why the disturbance travels with a particular speed. In the expression $g(x-vt)$, the speed $v$ was put into the formula. The next question is dynamical: what property of the medium determines that speed?

The cleanest system for answering this is a transverse wave on a stretched string. Let $x$ measure position along the string, and let $y(x,t)$ be the small transverse displacement of the string from equilibrium. The string is under a tension $F$, and its mass per unit length is

$$
\mu=\frac{\text{mass}}{\text{length}}.
$$

The symbol $\mu$ tells us how much inertia the string has per metre. A heavy string has a larger $\mu$; a light string has a smaller $\mu$. The tension $F$ tells us how strongly neighboring parts of the string pull on each other. These two quantities will compete: tension tries to straighten and accelerate the string, while mass per unit length resists acceleration.

To see why a wave equation appears, focus on a very small piece of string between $x$ and $x+\Delta x$. If the string is perfectly straight, the tension forces on the two ends balance and there is no transverse acceleration. But if the string is curved, the two tension forces point in slightly different directions. Their horizontal components almost cancel, while their vertical components do not. The small unbalanced vertical force is what accelerates that small piece of string.

This is the key physical mechanism: **curvature produces acceleration**. A section of string that is curved upward or downward experiences a net restoring effect from tension, and that acceleration changes the shape of the disturbance. The wave equation is the mathematical expression of this mechanism.

![pasted 1782466213411](/physics-for-ee/assets/pasted-1782466213411.png)

For small slopes, the vertical component of the tension at any point is approximately the tension $F$ multiplied by the local slope of the string. The slope is

$$
\frac{\partial y}{\partial x},
$$

where the partial derivative means that time is held fixed while we look at how the string’s shape changes with position. The small string element has two ends, so what matters is not the slope at just one point, but the difference between the slopes at $x$ and $x+\Delta x$. If those slopes are equal, the vertical components of the two tension forces cancel. If the slopes are different, there is a net vertical force.

The change in slope over the small distance $\Delta x$ is measured by the spatial derivative of the slope:

$$
\frac{\partial}{\partial x}\left(\frac{\partial y}{\partial x}\right)
=
\frac{\partial^2 y}{\partial x^2}.
$$

So the difference in slope between the two ends is approximately

$$
\frac{\partial^2 y}{\partial x^2}\Delta x.
$$

Multiplying by the tension gives the net transverse force on the element:

$$
F_y \approx F\frac{\partial^2 y}{\partial x^2}\Delta x.
$$

This is the mathematical version of the physical statement made above: curvature creates transverse acceleration. The second derivative $\partial^2y/\partial x^2$ measures curvature, and the tension turns that curvature into a restoring force.

The mass of the same small string element is

$$
\Delta m=\mu \Delta x.
$$

Its transverse acceleration is

$$
\frac{\partial^2 y}{\partial t^2},
$$

where now the partial derivative means that position is held fixed while we look at how the displacement of that point changes with time. Newton’s second law for the small element gives

$$
F\frac{\partial^2 y}{\partial x^2}\Delta x
=
\mu \Delta x \frac{\partial^2 y}{\partial t^2}.
$$

The factor $\Delta x$ appears on both sides because both the net force and the mass belong to the same small piece of string. Cancelling $\Delta x$, we get

$$
F\frac{\partial^2 y}{\partial x^2}
=
\mu\frac{\partial^2 y}{\partial t^2}.
$$

Rearranging gives

$$
\frac{\partial^2 y}{\partial t^2}
=
\frac{F}{\mu}
\frac{\partial^2 y}{\partial x^2}.
$$

This is the wave equation for a transverse wave on an ideal stretched string. It says that the time acceleration of each point of the string is proportional to the spatial curvature of the string at that point. The more curved the string is locally, the larger the transverse acceleration. The proportionality factor is $F/\mu$, so it is controlled by the tension and the mass per unit length.

The standard form of the one-dimensional wave equation is

$$
\frac{\partial^2 y}{\partial t^2}
=
v^2
\frac{\partial^2 y}{\partial x^2},
$$

or equivalently,

$$
\frac{\partial^2 y}{\partial x^2}
=
\frac{1}{v^2}
\frac{\partial^2 y}{\partial t^2}.
$$

Comparing this standard form with the equation obtained for the string,

$$
\frac{\partial^2 y}{\partial t^2}
=
\frac{F}{\mu}
\frac{\partial^2 y}{\partial x^2},
$$

we identify

$$
v^2=\frac{F}{\mu}.
$$

Therefore the wave speed on an ideal stretched string is

$$
v=\sqrt{\frac{F}{\mu}}.
$$

This formula is the main result for waves on a string. A wave travels faster when the tension is larger, because stronger tension makes each curved part of the string accelerate more strongly. A wave travels more slowly when the string has larger mass per unit length, because more inertia must be accelerated for the same restoring effect. The square root appears because the wave equation identifies $F/\mu$ with $v^2$, not directly with $v$.

![pasted 1782466318943](/physics-for-ee/assets/pasted-1782466318943.png)

This result also repairs an important misconception about wave speed. The speed of a wave on an ideal string is not chosen directly by how fast the hand moves up and down. The hand can choose the driving frequency, but the medium determines the propagation speed. If the same string is kept at the same tension, the wave speed is fixed by $F$ and $\mu$. If the frequency is changed, the wavelength changes so that

$$
v=\lambda f
$$

remains consistent with the same medium speed. In other words, on a given ideal string, changing $f$ does not by itself make the wave speed larger; instead, it changes $\lambda$.

This is where the kinematic and dynamic descriptions meet. The previous subsection showed that a sinusoidal wave satisfies

$$
v=\frac{\omega}{k},
$$

where $\omega$ is angular frequency and $k$ is wave number. The string dynamics now tells us that the same speed must also satisfy

$$
v=\sqrt{\frac{F}{\mu}}.
$$

Therefore, for a sinusoidal wave on this ideal string,

$$
\frac{\omega}{k}=\sqrt{\frac{F}{\mu}}.
$$

This relation does not say that $k$ is the spring constant. Here $k$ is still the wave number,

$$
k=\frac{2\pi}{\lambda}.
$$

The letter is the same as in Hooke’s law, but the meaning is different. In this wave context, $k$ measures spatial phase change, not stiffness.

The sinusoidal travelling wave now becomes a useful check on the equation rather than a new starting point. Take

$$
y(x,t)=A\cos(kx-\omega t+\phi).
$$

If we differentiate twice with respect to time, the cosine returns with a factor $-\omega^2$:

$$
\frac{\partial^2 y}{\partial t^2}
=
-\omega^2 y.
$$

If we differentiate twice with respect to position, the same wave returns with a factor $-k^2$:

$$
\frac{\partial^2 y}{\partial x^2}
=
-k^2 y.
$$

Substituting these into the wave equation,

$$
\frac{\partial^2 y}{\partial t^2}
=
v^2
\frac{\partial^2 y}{\partial x^2},
$$

gives

$$
-\omega^2y
=
v^2(-k^2y).
$$

For a nonzero wave, this requires

$$
\omega^2=v^2k^2,
$$

so

$$
v=\frac{\omega}{k}.
$$

This is the same speed relation obtained earlier by tracking constant phase. The agreement is important: the kinematic formula tells us how fast the pattern moves, while the wave equation tells us what physical mechanism allows that pattern to move. For a string, both must match the medium speed

$$
v=\sqrt{\frac{F}{\mu}}.
$$

![pasted 1782466511209](/physics-for-ee/assets/pasted-1782466511209.png)

The wave equation is broader than one sinusoidal wave. Any right-moving shape $g(x-vt)$ or left-moving shape $g(x+vt)$ satisfies the one-dimensional wave equation, as long as the shape travels without changing form at speed $v$. This is why the equation is not merely a formula for sine waves. Sine waves are especially useful because they are simple periodic solutions, but the wave equation itself describes the propagation of disturbances more generally.

The string result has assumptions built into it. The string is treated as ideal, uniform, and under approximately constant tension. The transverse displacement is assumed small enough that the slope remains small, so the vertical components of the tension can be approximated using the slope of the string. Within that model, the conclusion is clear: the speed of the wave is not chosen independently. It is set by the medium, through the competition between tension and inertia.

Once this is understood, the next question becomes natural. If the disturbance propagates because neighboring parts of the string pull on one another, then mechanical energy must also be passing from one part of the string to the next. The wave equation tells us how the displacement propagates, and the string-speed formula tells us how fast it propagates. The next subsection asks how much energy and power the travelling wave carries.

We started with a gap in the kinematic description: $g(x-vt)$ describes a wave moving at speed $v$, but it does not explain the origin of that speed. Looking at a small curved segment of string supplied the missing mechanism. Tension turns curvature into a transverse restoring force, while the mass per unit length supplies the inertia. Newton’s second law then produces the wave equation,

$$
\frac{\partial^2 y}{\partial t^2}
=
v^2
\frac{\partial^2 y}{\partial x^2},
$$

and for an ideal stretched string the speed is

$$
v=\sqrt{\frac{F}{\mu}}.
$$

In short, the wave equation says that curvature causes acceleration, and the string-speed formula says how strongly the medium converts one into the other. This prepares the next subsection, where the travelling disturbance is treated as a carrier of energy and power.
