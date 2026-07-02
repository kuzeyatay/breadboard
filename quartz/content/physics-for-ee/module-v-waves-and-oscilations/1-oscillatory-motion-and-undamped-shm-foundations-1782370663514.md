---
title: "1) Oscillatory motion and undamped SHM foundations"
date: "2026-06-25T06:57:43.514Z"
source: "user-note"
knowledge_type: "user-note"
tags: ["amplitude-measures-maximum-displacement", "shm-acceleration-opposes-displacement", "shm-is-not-constant-acceleration-motion", "shm-position-is-sinusoidal", "hooke-law-force-opposes-displacement", "linear-restoring-force-creates-shm", "restoring-force-points-toward-equilibrium", "frequency-is-inverse-period", "maximum-speed-occurs-at-equilibrium", "oscillation-requires-stable-equilibrium", "phase-locates-oscillator-within-cycle", "undamped-oscillators-conserve-amplitude"]
---

## Oscillatory motion and undamped SHM foundations

When an object oscillates, it does something more specific than merely move back and forth. It repeatedly moves away from a special position, returns to it, passes through it, slows down on the other side, and then comes back again. A mass on a spring, a vibrating ruler, and a pendulum all have this character. What makes these examples different from a cart simply rolling across a table is that the motion is organized around an **equilibrium position**. This is the position the system would remain in if it were placed there at rest.

Equilibrium alone, however, is not enough to create oscillation. The system must also respond to displacement in the right way. If the object is moved to one side of equilibrium, the force must point back toward equilibrium. If it is moved to the other side, the force must reverse direction and still point back. Such a force is called a **restoring force**. For a horizontal mass attached to a spring, choose $x=0$ as the equilibrium position. If the mass is displaced to the right, $x>0$, the spring pulls left. If the mass is displaced to the left, $x<0$, the spring pulls or pushes right. In both cases the force is opposite to the displacement.

![pasted 1782374086386](/physics-for-ee/assets/pasted-1782374086386.png)
![pasted 1782374255680](/physics-for-ee/assets/pasted-1782374255680.png)

This restoring tendency explains why the object keeps being brought back, but before writing an equation for the mechanism, we need language for describing the repeated motion itself. The **amplitude** $A$ is the maximum displacement from equilibrium. The **period** $T$ is the time needed for one complete repetition of the motion. The **frequency** $f$ is the number of complete oscillations per second, so

$$
f=\frac{1}{T}.
$$

Frequency is measured in hertz, where $1\,\text{Hz}=1\,\text{s}^{-1}$. These quantities tell us the size and timing of the motion, but they must be interpreted carefully. The amplitude is not the total distance travelled. If an oscillator moves between $x=+A$ and $x=-A$, then the distance from one extreme position to the other is $2A$, and the distance travelled in one full cycle is $4A$. So if a vibrating object moves between two extreme positions separated by $8.0\text{ cm}$, its amplitude is $4.0\text{ cm}$.

These descriptions are useful, but they do not yet explain the physics. Saying that an object has amplitude $A$ and period $T$ is like describing the shape of its motion from the outside. It does not tell us why that motion occurs. To explain the mechanism, we need the force law. The simplest important case is the one where the restoring force is proportional to displacement. For an ideal spring this is Hooke’s law,

$$
F=-kx.
$$

Here $F$ is the force in the $x$-direction, $x$ is displacement from equilibrium, and $k$ is the spring constant. The constant $k$ measures stiffness: a larger $k$ means a larger force for the same displacement. The minus sign carries the restoring character of the force. Positive displacement gives negative force; negative displacement gives positive force. This linear restoring force is the defining mechanism behind **simple harmonic motion**, or **SHM**.

Now Newton’s second law turns that physical mechanism into an equation of motion. Since $F=ma$, and acceleration is the second derivative of position with respect to time,

$$
m\frac{d^2x}{dt^2}=-kx.
$$

Dividing by $m$ and moving all terms to one side gives

$$
\frac{d^2x}{dt^2}+\frac{k}{m}x=0.
$$

This equation says something very specific. The acceleration is not constant. It changes as the displacement changes. If we write

$$
\omega^2=\frac{k}{m},
$$

then the equation becomes

$$
\frac{d^2x}{dt^2}+\omega^2x=0,
$$

or equivalently,

$$
a=-\omega^2x.
$$

The quantity $\omega$ is the **angular frequency**. For a mass-spring system,

$$
\omega=\sqrt{\frac{k}{m}}.
$$

This formula already matches physical intuition. A stiffer spring produces stronger restoring acceleration, so the motion is faster. A larger mass is harder to accelerate, so the motion is slower. The angular frequency is therefore set by the mechanism, not by how far the mass was initially pulled.

The equation also tells us what kind of function $x(t)$ must be. We need a function whose second derivative is the same function multiplied by a negative constant. A cosine has exactly this property: differentiating it twice gives back a negative cosine. Therefore the displacement in undamped SHM can be written as

$$
x(t)=A\cos(\omega t+\phi).
$$

Here $x(t)$ is the displacement at time $t$, $A$ is the amplitude, and $\omega t+\phi$ is the **phase**. The phase tells where the oscillator is within its cycle. The constant $\phi$ is the **phase constant**, determined by the initial condition. For example, if the object starts at maximum positive displacement, one convenient choice is $\phi=0$, so $x(0)=A$. If it starts from a different position or with a different initial velocity, the same motion can still be described by changing $\phi$.

The appearance of $\omega t+\phi$ also explains the relation between angular frequency, frequency, and period. The cosine repeats whenever its argument increases by $2\pi$. One complete oscillation therefore corresponds to a phase increase of $2\pi$. During one period $T$,

$$
\omega T=2\pi,
$$

so

$$
\omega=\frac{2\pi}{T}=2\pi f.
$$

This is why angular frequency and ordinary frequency are not interchangeable. The frequency $f$ counts cycles per second. The angular frequency $\omega$ measures phase change in radians per second. The factor $2\pi$ is not decoration; it is the conversion between one full cycle and one full $2\pi$-radian phase turn.

![pasted 1782374302929](/physics-for-ee/assets/pasted-1782374302929.png)


Once the position is known, the velocity and acceleration follow from differentiation. From

$$
x(t)=A\cos(\omega t+\phi),
$$

the velocity is

$$
v(t)=\frac{dx}{dt}=-\omega A\sin(\omega t+\phi).
$$

The factor $\omega$ appears because a faster phase change makes the object move through the same displacement pattern more quickly. The maximum possible value of $|\sin(\omega t+\phi)|$ is $1$, so the maximum speed is

$$
v_{\max}=\omega A.
$$

Differentiating once more gives

$$
a(t)=\frac{d^2x}{dt^2}=-\omega^2A\cos(\omega t+\phi).
$$

Since $A\cos(\omega t+\phi)=x(t)$, this becomes again

$$
a(t)=-\omega^2x(t).
$$

This result is not just another formula; it is the central physical signature of SHM. At the rightmost point, $x=+A$, the acceleration is maximally to the left. At the leftmost point, $x=-A$, the acceleration is maximally to the right. At equilibrium, $x=0$, the acceleration is zero. But zero acceleration at equilibrium does not mean the object stops there. By the time the object reaches equilibrium, it has been accelerated toward that point, so its speed is greatest there.

![pasted 1782374377204](/physics-for-ee/assets/pasted-1782374377204.png)

This is exactly where a common mistake becomes visible. The constant-acceleration formulas from earlier kinematics do not apply to SHM over a finite interval, because SHM does not have constant acceleration. The acceleration changes continuously with position. Near an extreme point it is large and directed back toward equilibrium; near equilibrium it is zero; after crossing equilibrium it reverses direction. The correct model is therefore not constant-acceleration motion, but the differential equation

$$
\frac{d^2x}{dt^2}+\omega^2x=0.
$$

This first model is called **undamped** because nothing removes energy from the oscillator. There is no friction, no air resistance, and no external driving force. As a result, the amplitude stays constant and the same motion repeats indefinitely. Real systems are usually not this perfect: damping can gradually reduce the amplitude, and external forcing can feed energy into the motion. Those effects come later. The point of the undamped SHM model is to isolate the core structure: a stable equilibrium together with a linear restoring force produces acceleration opposite to displacement, and that is why the motion is sinusoidal.

We began with the observation that oscillating systems repeatedly return to a preferred position. That required the ideas of equilibrium and restoring force. The special case of a linear restoring force led to $F=-kx$, which, through Newton’s second law, became the SHM equation. That equation required a sinusoidal solution, gave meaning to amplitude, phase, period, frequency, and angular frequency, and explained why acceleration cannot be treated as constant. This foundation is the reference point for everything that follows: damping modifies it by removing energy, and forcing modifies it by adding energy from outside.
![pasted 1782375324069](/physics-for-ee/assets/pasted-1782375324069.png)
