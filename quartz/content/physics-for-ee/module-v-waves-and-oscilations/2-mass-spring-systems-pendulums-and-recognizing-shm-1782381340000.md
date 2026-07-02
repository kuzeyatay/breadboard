---
title: "2) Mass-spring systems, pendulums, and recognizing SHM"
date: "2026-06-25T09:55:40.000Z"
source: "user-note"
knowledge_type: "user-note"
tags: ["pendulum-is-shm-only-for-small-angles", "pendulum-period-depends-on-length", "restoring-force-points-toward-equilibrium", "static-spring-extension-determines-vertical-frequency", "acceleration-proportional-to-displacement-indicates-shm", "amplitude-does-not-set-ideal-spring-frequency", "bob-mass-cancels-in-pendulum-motion", "gravity-shifts-vertical-spring-equilibrium", "linear-restoring-effects-reveal-shm", "measure-displacement-from-equilibrium-position", "small-angle-approximation-linearizes-pendulum-motion", "angular-frequency-differs-from-cycle-frequency"]
---

## Mass-spring systems, pendulums, and recognizing SHM

The previous subsection gave us the mathematical signature of simple harmonic motion:

$$
a=-\omega^2 x,
$$

or, equivalently,

$$
\frac{d^2x}{dt^2}+\omega^2x=0.
$$

This equation is not just a formula for one special object. It is a recognition test. Whenever the acceleration of a system is proportional to displacement from equilibrium and points in the opposite direction, the system undergoes simple harmonic motion. The task now is to see how actual physical systems produce that structure.

The cleanest example is the horizontal mass-spring system. Suppose a block of mass $m$ is attached to an ideal spring with spring constant $k$, and the block slides on a frictionless horizontal surface. We measure displacement $x$ from the equilibrium position, where the spring is neither stretched nor compressed. If the block is displaced, the spring exerts the restoring force

$$
F=-kx.
$$

Newton’s second law gives

$$
m\frac{d^2x}{dt^2}=-kx,
$$

so

$$
\frac{d^2x}{dt^2}+\frac{k}{m}x=0.
$$

Comparing this with the standard SHM equation,

$$
\frac{d^2x}{dt^2}+\omega^2x=0,
$$

we identify

$$
\omega=\sqrt{\frac{k}{m}}.
$$

This tells us that the oscillator’s angular frequency is fixed by the stiffness of the spring and the inertia of the mass. A larger spring constant means the spring reacts more strongly to the same displacement, so the mass is pulled back more aggressively and oscillates faster. A larger mass means the same restoring force produces less acceleration, so the oscillation is slower.

The ordinary frequency is then

$$
f=\frac{\omega}{2\pi}
=\frac{1}{2\pi}\sqrt{\frac{k}{m}},
$$

and the period is

$$
T=\frac{1}{f}
=2\pi\sqrt{\frac{m}{k}}.
$$

This is a natural place to repair a common confusion. The angular frequency $\omega$ and the ordinary frequency $f$ are not the same. The angular frequency tells how quickly the phase changes in radians per second. The ordinary frequency tells how many full cycles happen per second. Because one full cycle corresponds to $2\pi$ radians, the factor $2\pi$ must appear when moving between them.

[Interactive visual: Horizontal mass-spring oscillator — adjust $m$ and $k$ and observe how the period changes while the motion remains sinusoidal]

In this ideal mass-spring oscillator, the amplitude does not appear in the formula for $\omega$. Pulling the mass farther gives a larger oscillation, but not a different oscillation frequency. That statement depends on the spring being ideal, meaning that the restoring force remains proportional to displacement. If the spring stops behaving linearly at large displacements, the motion need not remain exactly simple harmonic. For the ideal model, however, the size of the motion and the timing of the motion are separate: $A$ sets how far the object moves, while $k/m$ sets how quickly it repeats.

The horizontal spring is the most direct case because the coordinate $x$ was chosen from the start to measure displacement from equilibrium, and the only horizontal force was already proportional to that displacement. Real systems often look less clean at first. A constant force may be present, or the most obvious reference point may not be the equilibrium point. The vertical spring is useful because it teaches exactly this point: before deciding whether a system is SHM, we must measure displacement from the position where the net force is zero.

Imagine a spring hanging from the ceiling with a mass attached to its lower end. Gravity pulls the mass downward, so the spring stretches until the upward spring force balances the weight. If the stretch from the unstretched length is $\Delta L$, equilibrium requires

$$
k\Delta L=mg.
$$

This equation is not yet the oscillation equation. It only locates the equilibrium position. But that is precisely why it matters. Once the equilibrium position is known, we should describe the motion using a new displacement $y$, measured from that equilibrium position rather than from the unstretched spring length.

If the mass is displaced an additional distance $y$ downward, gravity has not changed, but the spring force has changed by an extra amount proportional to $y$. The equilibrium parts of the forces cancel, leaving only

$$
F_{\text{net}}=-ky.
$$

So the equation of motion is

$$
m\frac{d^2y}{dt^2}=-ky,
$$

which has exactly the SHM form. Gravity did not destroy simple harmonic motion; it shifted the equilibrium point. The oscillation still happens around equilibrium, and the angular frequency is still

$$
\omega=\sqrt{\frac{k}{m}}.
$$

Using the static relation $k=mg/\Delta L$, this can also be written as

$$
\omega=\sqrt{\frac{g}{\Delta L}},
\qquad
f=\frac{1}{2\pi}\sqrt{\frac{g}{\Delta L}}.
$$

This form should be read carefully. The relevant length is not the spring’s original length, but the static extension $\Delta L$. Also, the factor $1/(2\pi)$ appears only when converting angular frequency $\omega$ to ordinary frequency $f$.



The vertical spring teaches that choosing the correct equilibrium coordinate can reveal SHM even when the original forces include extra constant terms. The pendulum introduces a different complication. Here the issue is not a shifted equilibrium; the lowest point is already the equilibrium position. The issue is that the restoring force is not exactly proportional to the displacement.

Consider a small mass suspended from a light string of length $L$. Its displacement is most naturally described by the angle $\theta$ from the vertical. Gravity pulls downward, but only the tangential component of gravity changes the angle and drives the swing back toward equilibrium. That tangential component is

$$
F_{\text{tan}}=-mg\sin\theta.
$$

The minus sign means the force acts toward $\theta=0$. Since tangential acceleration is

$$
a_{\text{tan}}=L\frac{d^2\theta}{dt^2},
$$

Newton’s second law along the arc gives

$$
mL\frac{d^2\theta}{dt^2}=-mg\sin\theta,
$$

or

$$
L\frac{d^2\theta}{dt^2}+g\sin\theta=0.
$$

This is close to the SHM form, but not yet the same, because $\sin\theta$ is not equal to $\theta$ for all angles. For small angles measured in radians, however,

$$
\sin\theta\approx\theta.
$$

Then the equation becomes

$$
\frac{d^2\theta}{dt^2}+\frac{g}{L}\theta=0,
$$

so the pendulum is approximately a simple harmonic oscillator with

$$
\omega=\sqrt{\frac{g}{L}},
\qquad
T=2\pi\sqrt{\frac{L}{g}},
\qquad
f=\frac{1}{2\pi}\sqrt{\frac{g}{L}}.
$$

This result should not be interpreted as saying that every pendulum motion is exactly SHM. It says that small-angle pendulum motion is approximately SHM because the nonlinear restoring term $\sin\theta$ becomes nearly linear. For larger angles, the motion is still periodic, but it is no longer exactly simple harmonic.

![pasted 1782386969707](/physics-for-ee/assets/pasted-1782386969707.png)

The formula for the pendulum also has a useful physical interpretation. The mass of the pendulum bob does not appear, because both the gravitational force and the inertia are proportional to $m$. A heavier bob has a larger weight, but it is also harder to accelerate by the same factor. The length $L$, however, matters strongly. A longer pendulum changes angle more slowly and has a longer period. The gravitational acceleration $g$ also matters: stronger gravity gives a stronger restoring effect and therefore faster oscillation.

The three examples now give a practical recognition method. First find the equilibrium position, meaning the position where the net force or net torque is zero. Then measure displacement from that equilibrium, not from an arbitrary reference point. Finally, ask what the net restoring effect looks like for a small displacement. If the net force can be written as

$$
F_{\text{net}}=-Cx,
$$

where $C$ is a positive constant and $x$ is displacement from equilibrium, then

$$
m\frac{d^2x}{dt^2}=-Cx,
$$

and the motion is SHM with

$$
\omega=\sqrt{\frac{C}{m}}.
$$

The same logic applies to angular motion, except that the coordinate may be an angle and the equation may come from torque rather than force. What matters is not whether the system looks like a spring. What matters is whether, near equilibrium, the acceleration is proportional to displacement and directed back toward equilibrium.

The horizontal spring showed the direct case: the restoring force is already linear. The vertical spring showed that constant forces such as gravity may shift the equilibrium but do not necessarily change the oscillation about that equilibrium. The pendulum showed that some systems become SHM only approximately, after a small-displacement approximation turns the restoring effect into a linear one. Together these examples turn SHM from a formula into a recognition pattern. The next step is to use energy to connect position, speed, and amplitude during the motion.
