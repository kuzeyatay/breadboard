---
title: "2) From mechanical waves to light waves: the minimum wave toolkit"
date: "2026-06-27T06:09:43.271Z"
source: "user-note"
knowledge_type: "user-note"
---

## From mechanical waves to light waves: the minimum wave toolkit

Before light can be treated as reflection, refraction, interference, or diffraction, we need to carry over a small but precise toolkit from mechanical waves. The point is not to repeat the whole previous module. The point is to keep only the ideas that will still be useful when the “thing that waves” is no longer a string, water surface, or air pressure, but an electromagnetic disturbance. In Module V, a wave was introduced as a disturbance that moves over time and transports energy. That definition is deliberately broad. It includes a pulse travelling along a rope, a pressure disturbance moving through air, and later, light propagating through space.

The first essential idea is that a travelling wave is not the same thing as an object being transported. On a string, for example, the disturbance moves horizontally along the string, but each small piece of string moves mainly up and down. This distinction matters because it prevents a common misconception: the wave speed is not usually the speed of the material particles. The wave pattern moves through the medium, while the medium locally oscillates. For light, this becomes even more important, because light does not need a material string or air column in order to propagate through vacuum. What carries over is not the material picture of a rope, but the mathematical idea of a moving pattern.

To describe a moving pattern, start with a shape $f(x)$. If the same shape is shifted to the right by a distance $a$, it is written as $f(x-a)$. The minus sign is not a mistake: to see the same part of the shape at a later position $x$, the function must look back to where that part came from. If the shape moves to the right with speed $v$, then after a time $t$ it has shifted by $vt$. A right-moving wave therefore has the form

$$
y(x,t)=f(x-vt),
$$

while a left-moving wave has the form

$$
y(x,t)=f(x+vt).
$$

Here $y(x,t)$ is the displacement, pressure variation, or other wave quantity at position $x$ and time $t$, and $v$ is the wave speed. These equations are the most compact way of saying: the shape is preserved, but its location changes with time.

This shifted-shape form is not just notation; it is the typical signature of a wave. Formally, the one-dimensional wave equation is

$$
\frac{\partial^2 y}{\partial x^2}-\frac{1}{v^2}\frac{\partial^2 y}{\partial t^2}=0.
$$

This equation links how the wave bends in space to how it changes in time. It is written with partial derivatives because $y$ depends on both position and time: we can ask how the wave changes as we move along $x$, or how it changes as time passes at one fixed position. A function of the form $f(x-vt)$ or $f(x+vt)$ satisfies this equation, which is why these forms represent travelling-wave solutions. The equation does not say that every wave is a wave on a string. It says something more portable: if a physical disturbance obeys this kind of space-time relation, then it propagates as a wave. That is the part we will carry into light.

For a repeating wave, the moving shape is often sinusoidal. A sinusoidal wave travelling to the right can be written as

$$
y(x,t)=A\cos\!\big(k(x-vt)\big),
$$

or equivalently,

$$
y(x,t)=A\cos(kx-\omega t).
$$

This is the mathematical centerpiece of the subsection. The symbol $A$ is the amplitude, the maximum size of the disturbance. The symbol $k$ is the wave number, which tells how rapidly the wave phase changes with position. The symbol $\omega$ is the angular frequency, which tells how rapidly the wave phase changes with time. The argument $kx-\omega t$ is the phase of the wave. The reason this form represents motion to the right is that the same phase value is found at larger $x$ when $t$ increases. In other words, the crests move in the positive $x$-direction.

The quantities $k$, $\omega$, $\lambda$, $T$, $f$, and $v$ are different ways of measuring the same repeating pattern. If we freeze time and look along the $x$-axis, the wave repeats after one wavelength $\lambda$. Since a cosine repeats when its argument changes by $2\pi$,

$$
k\lambda=2\pi,
$$

so

$$
k=\frac{2\pi}{\lambda}.
$$

If instead we stand at one fixed position and watch the wave pass in time, the motion repeats after one period $T$. That means

$$
\omega T=2\pi,
$$

so

$$
\omega=\frac{2\pi}{T}=2\pi f,
$$

where $f=1/T$ is the frequency. The wave moves one wavelength during one period, so its speed is

$$
v=\frac{\lambda}{T}=\lambda f.
$$

The same relation can also be written as

$$
v=\frac{\omega}{k}.
$$

These formulas are not separate facts to memorize independently. They are different translations of one idea: $k$ describes spatial repetition, $\omega$ describes time repetition, and $v$ connects the two.

[Interactive visual: snapshot versus time trace — freeze a sinusoidal wave and read $\lambda$ from the distance between crests, then stand at one fixed $x$ and read $T$ from the time between repeated motion; this teaches why $k$ is spatial while $\omega$ is temporal.]

This spatial-versus-temporal distinction is one of the most important carryovers into Module VI. A wave expression contains both $x$ and $t$, but not every question uses both parts equally. If a question asks about the shape of a wave in space, the relevant quantity is usually $k$ or $\lambda$. If a question asks how fast the disturbance oscillates in time, the relevant quantity is usually $\omega$, $T$, or $f$. Mixing these up leads to wrong reasoning, especially for standing waves.

The distinction becomes especially clear in a standing wave. For a string fixed at both ends, one possible form is

$$
y(x,t)=A_{\mathrm{SW}}\sin(kx)\sin(\omega t).
$$

This is not a travelling wave, because the spatial part and time part are separated. The factor $\sin(kx)$ fixes the shape in space: it tells where the nodes and antinodes are. The factor $\sin(\omega t)$ tells how that already-fixed shape oscillates in time. If the string has length $L$, the fixed end at $x=L$ requires

$$
\sin(kL)=0,
$$

so

$$
kL=n\pi
\qquad\text{and therefore}\qquad
L=\frac{n\pi}{k},
$$

where $n=1,2,3,\ldots$. The important point is not the string itself, but the logic: a spatial boundary condition depends on the spatial part of the wave. That is why $\omega$ does not appear in the expression for $L$. The wave still oscillates in time, but the allowed shapes are determined by $k$, not by $\omega$.

The standing-wave example also shows why superposition must stay in our toolkit. A standing wave can be understood as the overlap of a forward travelling wave and a backward travelling wave. More generally, when waves overlap, the resulting disturbance is found by adding the individual disturbances. In Module V, that idea explained standing waves on strings. In Module VI, the same idea will explain why light can produce bright and dark interference fringes and why it can spread after passing through an opening. The physical disturbance will change from mechanical displacement to electromagnetic fields, but the superposition logic remains the same.

So the minimum toolkit is now in place. A wave is a moving disturbance that transports energy, but the wave pattern is not the same thing as material transport. A travelling wave is described by a shape $f(x-vt)$ or, for a sinusoidal wave, by $A\cos(kx-\omega t)$. The wave equation captures the shared space-time structure of such propagation. The wave number $k$ describes spatial repetition, the angular frequency $\omega$ describes temporal repetition, and the wave speed connects them through $v=\lambda f=\omega/k$. Standing waves remind us not to confuse spatial behavior with time behavior, and superposition prepares us for interference and diffraction. We started from mechanical waves because they give visible, concrete examples of these ideas; from here onward, we keep the wave structure, not the mechanical medium, and carry that structure into the description of light.
