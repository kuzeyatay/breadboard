---
title: "7) Mathematical description of traveling waves"
date: "2026-06-26T07:30:28.222Z"
source: "user-note"
knowledge_type: "user-note"
tags: ["pattern-speed-differs-from-particle-speed", "phase-sign-determines-propagation-direction", "angular-frequency-measures-temporal-phase-rate", "wave-displacement-depends-on-position-and-time", "wave-number-measures-spatial-phase-rate", "wave-speed-equals-omega-over-k", "periodic-wave-speed-equals-wavelength-times-frequency", "constant-phase-tracks-wave-pattern-motion", "left-moving-waves-preserve-x-plus-vt", "right-moving-waves-preserve-x-minus-vt", "snapshot-graph-fixes-time-across-positions", "history-graph-fixes-position-through-time"]
---

## Mathematical description of traveling waves

A mechanical wave is a travelling disturbance, but that description is still mostly verbal. To use waves in calculations, we need a way to say what the medium is doing at every place and at every time. This is the main difference from a single oscillator. For a mass on a spring, one function $x(t)$ is enough, because there is only one displacement coordinate changing with time. For a wave on a string, one point of the string may be high while another point is low, and both of those points continue changing as time passes. So the displacement must depend on two variables: position and time.

For a transverse wave on a string, we usually let $x$ describe position along the string and $y$ describe the transverse displacement of the string from equilibrium. The wave function is therefore written as

$$
y(x,t).
$$

This notation means: at position $x$ and time $t$, the string has displacement $y$. It is important not to read $y(x,t)$ as the path of one piece of string through space. It is a field-like description of the whole string. Fixing $t$ gives the shape of the string at one instant. Fixing $x$ gives the motion in time of one particular point of the string.

![pasted 1782460001915](/physics-for-ee/assets/pasted-1782460001915.png)

This distinction is the first major source of confusion in wave graphs. A drawing of $y$ versus $x$ at one instant is a **snapshot** of the wave. It shows the shape of the disturbance along the medium. It is not a graph of how one particle moves in time. A graph of $y$ versus $t$ at one fixed $x$ is a **history graph** for one point of the medium. These two graphs may both look sinusoidal, but they answer different questions. The snapshot tells where crests and troughs are located. The history graph tells how one point oscillates as the wave passes.

The next question is how to represent the fact that the shape moves. Suppose a pulse has some shape described by a function $g(x)$ at time $t=0$. The letter $g$ is just a placeholder for “whatever the pulse shape is”; it is not the frequency. If the pulse moves to the right with speed $v$, then after time $t$ the whole shape has shifted a distance $vt$ to the right. To make the mathematical expression keep the same shape while moving right, we write

$$
y(x,t)=g(x-vt).
$$

The combination $x-vt$ is the key. If $x-vt$ stays constant, then the value of $g$ stays constant, meaning we are following the same part of the wave. For example, if a crest corresponds to a certain value of $x-vt$, then as time increases, $x$ must also increase to keep $x-vt$ unchanged. That means the crest moves to the right.

A wave moving to the left is written instead as

$$
y(x,t)=g(x+vt).
$$

Now keeping $x+vt$ constant means that as $t$ increases, $x$ must decrease. The same part of the wave therefore moves left. This sign convention is worth understanding rather than memorizing: right-moving waves use $x-vt$, left-moving waves use $x+vt$, because the argument of the shape function must stay constant as the pattern moves.

![pasted 1782461727422](/physics-for-ee/assets/pasted-1782461727422.png)

The travelling-pulse form $g(x-vt)$ is very general: it can describe one isolated bump, a sharp pulse, or any other shape that moves without changing form. But many waves in this course are produced by a source that oscillates repeatedly. If the end of a string is driven up and down sinusoidally, it does not create just one isolated pulse; it creates a repeating pattern of crests and troughs. That is why the next useful special case is the sinusoidal travelling wave.

For a sinusoidal wave moving in the positive $x$-direction, we write

$$
y(x,t)=A\cos(kx-\omega t+\phi).
$$

Here $A$ is the amplitude, the maximum transverse displacement of the medium from equilibrium. The quantity $k$ is the **wave number**, which measures how rapidly the wave phase changes with position. The quantity $\omega$ is the angular frequency, which measures how rapidly the phase changes with time. The constant $\phi$ is the phase constant, which shifts the wave left, right, or in time depending on how the wave is positioned at $t=0$.

The expression inside the cosine,

$$
kx-\omega t+\phi,
$$

is called the phase. Points with the same phase are at the same stage of the wave pattern. For example, all crests correspond to phases that differ by multiples of $2\pi$. This is why the phase is the natural quantity to track when asking how the pattern moves. A right-moving crest keeps the same phase while $t$ increases, so $x$ must increase as well.

The spatial repetition of the wave is described by the wavelength $\lambda$. The wavelength is the distance between two neighboring points that are in the same stage of the pattern, such as crest to crest or trough to trough. Since one full cycle of cosine corresponds to a phase change of $2\pi$, increasing $x$ by one wavelength must increase $kx$ by $2\pi$. Therefore,

$$
k\lambda=2\pi,
$$

so

$$
k=\frac{2\pi}{\lambda}.
$$

This is why $k$ is called the wave number: it tells how many radians of phase occur per metre. It should not be confused with the spring constant $k$ from oscillations. The same letter is often used, but the meaning is different. In a spring, $k$ measures stiffness and has units of newtons per metre. In a wave, $k$ measures spatial phase rate and has units of radians per metre.

![pasted 1782461828175](/physics-for-ee/assets/pasted-1782461828175.png)

The temporal repetition is described by the period $T$ and frequency $f$. The period $T$ is the time for one full oscillation at a fixed position. The ordinary frequency $f$ is the number of cycles per second, so

$$
f=\frac{1}{T}.
$$

The angular frequency $\omega$ is related to the ordinary frequency by

$$
\omega=2\pi f=\frac{2\pi}{T}.
$$

This is the same $2\pi$ conversion used in simple harmonic motion. The difference is that in a wave, the oscillation is happening at many positions, with different points generally out of phase with one another.

Now the wave speed can be obtained by following a point of constant phase. For the right-moving sinusoidal wave,

$$
y(x,t)=A\cos(kx-\omega t+\phi),
$$

a particular crest satisfies

$$
kx-\omega t+\phi=\text{constant}.
$$

As time changes, the crest moves so that this phase remains constant. Differentiating with respect to time gives

$$
k\frac{dx}{dt}-\omega=0.
$$

Therefore the speed of the crest is

$$
\frac{dx}{dt}=\frac{\omega}{k}.
$$

So the wave speed is

$$
v=\frac{\omega}{k}.
$$

Using

$$
k=\frac{2\pi}{\lambda}
\qquad \text{and} \qquad
\omega=2\pi f,
$$

this becomes

$$
v=\lambda f.
$$

This formula is one of the central relations for periodic travelling waves. It says that the wave moves one wavelength in one period. Since $f=1/T$, the same relation can also be written as

$$
v=\frac{\lambda}{T}.
$$

The formula should be read carefully. The speed $v$ is the propagation speed of the wave pattern. It is not the maximum transverse speed of a piece of the string. A point of the string moves up and down; the crest moves along the string. Those are different motions. The relation $v=\lambda f$ describes how fast the pattern travels, not how fast the material point oscillates vertically.

![pasted 1782461952707](/physics-for-ee/assets/pasted-1782461952707.png)

The sinusoidal formula now lets us see the snapshot/history distinction inside one equation. If time is fixed, for example at $t=0$, then

$$
y(x,0)=A\cos(kx+\phi),
$$

which is a sinusoidal shape in space. The distance between neighboring crests is $\lambda$. If position is fixed, for example at $x=0$, then

$$
y(0,t)=A\cos(-\omega t+\phi),
$$

which is a sinusoidal oscillation in time. The time between repeated maxima is $T$. Thus the same expression $y(x,t)=A\cos(kx-\omega t+\phi)$ contains two different views: the spatial pattern seen in a snapshot and the time oscillation measured by watching one point. A travelling wave is therefore not just “a sine curve.” It is a sine curve whose spatial repetition and temporal repetition are locked together by the phase.

The sign in the phase tells the direction of travel. A wave of the form

$$
A\cos(kx-\omega t+\phi)
$$

travels in the positive $x$-direction, because a fixed phase requires $x$ to increase as $t$ increases. A wave of the form

$$
A\cos(kx+\omega t+\phi)
$$

travels in the negative $x$-direction, because a fixed phase requires $x$ to decrease as $t$ increases. The sign is not about whether the displacement $y$ is positive or negative. A right-moving wave can have parts above and below equilibrium. The sign tells how the pattern shifts along the $x$-axis as time passes.

This is another place where wave notation can mislead beginners. The variable $x$ labels position along the medium. The variable $y$ describes displacement of the medium. In a transverse wave on a string, the wave travels along $x$, while the string elements move in $y$. But in a longitudinal wave, the displacement may be along the same direction as propagation, and the disturbed quantity might be pressure rather than transverse displacement. The notation $y(x,t)$ is therefore a convenient model for a transverse string wave, not the only possible wave variable. What carries over to other mechanical waves is the same idea: a disturbance is described by a quantity that depends on both position and time.

The mathematical description developed here is still kinematic. It tells us how to represent a travelling wave, how to distinguish snapshots from history graphs, how to define wavelength and frequency, and how to relate them through $v=\lambda f$. It does not yet explain what determines the wave speed in a particular medium. For that, we must look at the dynamics of the medium: tension, inertia, and how neighboring parts pull on one another. That is the next step.

We started from the need to describe a disturbance that changes from place to place and from moment to moment. That required replacing the single-oscillator function $x(t)$ with a wave function such as $y(x,t)$. A travelling shape is represented by $g(x-vt)$ or $g(x+vt)$, and a sinusoidal travelling wave is represented by $A\cos(kx-\omega t+\phi)$. Tracking constant phase then explains why $v=\omega/k=\lambda f$. This prepares the next subsection, where the wave description becomes dynamical and the speed is connected to the physical properties of the medium.
