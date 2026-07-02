---
title: "3) Energy in simple harmonic motion"
date: "2026-06-25T13:38:28.062Z"
source: "user-note"
knowledge_type: "user-note"
tags: ["amplitude-marks-oscillator-turning-points", "turning-points-store-all-oscillator-energy", "velocity-direction-is-not-determined-by-energy", "restoring-force-points-toward-equilibrium", "amplitude-fixes-total-oscillator-energy", "damping-removes-mechanical-energy-from-oscillators", "equilibrium-gives-maximum-oscillator-speed", "mechanical-energy-stays-constant-without-damping", "spring-energy-grows-with-displacement-squared", "energy-links-position-and-speed"]
---

## Energy in simple harmonic motion

So far, simple harmonic motion has mainly been explained through force. That view tells us why the object turns around: whenever it is displaced from equilibrium, the restoring force points back. But it does not yet give the most natural explanation of the changing speed. A mass on a spring is momentarily at rest at an extreme position, then speeds up as it approaches equilibrium, then slows down again as it climbs toward the opposite extreme. The force picture can describe this through acceleration, but the energy picture explains where the speed comes from and where it goes.

For that reason, we return to the ideal horizontal mass-spring oscillator. The mass is $m$, the spring constant is $k$, and the displacement from equilibrium is $x$. This system is the cleanest place to study energy in SHM because the stored energy in an ideal spring has a simple form. When the spring is stretched or compressed, it stores elastic potential energy,

$$
U=\frac{1}{2}kx^2.
$$

The square is important: stretching to the right and compressing to the left both store energy, so the sign of $x$ cannot matter. The factor $1/2$ reflects the fact that the spring force does not have its full value immediately; it grows linearly from zero as the spring is stretched or compressed.

The moving mass also has kinetic energy,

$$
K=\frac{1}{2}mv^2,
$$

where $v$ is the velocity of the mass. In the ideal undamped oscillator, there is no friction and no external driving force, so mechanical energy is conserved. That means the sum of kinetic energy and spring potential energy stays constant:

$$
E=K+U=\frac{1}{2}mv^2+\frac{1}{2}kx^2.
$$

This equation describes the same motion as the SHM equation, but from a different viewpoint. The force equation tells us how acceleration changes. The energy equation tells us how speed and position are linked.

![pasted 1782395515791](/physics-for-ee/assets/pasted-1782395515791.png)

The energy picture becomes clearest at the two special locations in the motion. At an extreme position, the displacement has maximum magnitude:

$$
x=+A \quad \text{or} \quad x=-A,
$$

where $A$ is the amplitude. At either extreme, the mass is momentarily at rest, so $v=0$. Therefore all the mechanical energy is stored as spring potential energy:

$$
E=\frac{1}{2}kA^2.
$$

This formula connects the amplitude of the motion to the total mechanical energy. A larger amplitude means more stored energy. More precisely, the energy grows with the square of the amplitude, so doubling the amplitude requires four times as much energy.

As the mass moves back toward equilibrium, the spring becomes less stretched or less compressed, so the spring potential energy decreases. Since the total energy is conserved, that lost potential energy must appear as kinetic energy. This is why the mass speeds up as it approaches equilibrium. At equilibrium, $x=0$, the spring potential energy is zero:

$$
U=\frac{1}{2}k(0)^2=0.
$$

At that instant, all the mechanical energy is kinetic:

$$
E=\frac{1}{2}mv_{\max}^2.
$$

But the same total energy was also equal to $\frac{1}{2}kA^2$ at the extreme position. Therefore,

$$
\frac{1}{2}mv_{\max}^2=\frac{1}{2}kA^2.
$$

Solving for the maximum speed gives

$$
v_{\max}=A\sqrt{\frac{k}{m}}.
$$

Since the angular frequency of the mass-spring oscillator is

$$
\omega=\sqrt{\frac{k}{m}},
$$

this can also be written as

$$
v_{\max}=\omega A.
$$

This result agrees with the derivative of $x(t)=A\cos(\omega t+\phi)$, but now it has a physical meaning. The object is fastest at equilibrium because all the energy is kinetic there. It is slowest at the extreme points because all the energy is stored in the spring there.

This also repairs a common misunderstanding about equilibrium. Equilibrium is not a place where the object must stop. It is the place where the net force and acceleration are zero. In SHM, the object usually passes through equilibrium with maximum speed. The object stops at the extreme positions, not at equilibrium, because only there has all its kinetic energy been converted back into spring potential energy.

Knowing the maximum speed is useful, but it only describes one point in the motion: equilibrium. The energy equation can do more. It can tell us the speed at any displacement $x$ between the two turning points. This is exactly the kind of question where the energy view is more direct than trying to track the time-dependent cosine.

At any instant, the total energy is divided between kinetic energy and spring potential energy:

$$
E=\frac{1}{2}mv^2+\frac{1}{2}kx^2.
$$

But the total energy was already fixed by the amplitude:

$$
E=\frac{1}{2}kA^2.
$$

Equating these two expressions gives

$$
\frac{1}{2}mv^2+\frac{1}{2}kx^2=\frac{1}{2}kA^2.
$$

The term $\frac{1}{2}kx^2$ is the part of the energy currently stored in the spring. Whatever remains must be kinetic energy:

$$
\frac{1}{2}mv^2=\frac{1}{2}k(A^2-x^2).
$$

So

$$
v^2=\frac{k}{m}(A^2-x^2).
$$

Using $\omega^2=k/m$, this becomes

$$
v=\pm\omega\sqrt{A^2-x^2}.
$$

The $\pm$ sign is not a mathematical nuisance; it has physical meaning. Energy determines the speed magnitude, but the same position can be reached while moving in either direction. A mass can pass through $x=A/2$ on the way toward equilibrium, and later pass through the same point on the way back toward the turning point. The kinetic energy is the same at that position in both cases, but the velocity direction is different.

![pasted 1782395968953](/physics-for-ee/assets/pasted-1782395968953.png)

This formula also shows why the speed cannot be real outside the interval $-A\le x\le A$. If $|x|>A$, then $A^2-x^2$ would be negative, which would make $v^2$ negative. That is physically impossible. The amplitude is therefore not just a decorative parameter in the cosine formula; it marks the turning points of the motion. The oscillator cannot pass beyond $\pm A$ unless its total energy is changed.

The energy view also helps distinguish amplitude from distance travelled. The amplitude $A$ is the maximum displacement from equilibrium, and it fixes the total energy through

$$
E=\frac{1}{2}kA^2.
$$

It is not the distance travelled in a full cycle. During one full oscillation, the mass travels from $+A$ to $-A$ and back to $+A$, a total distance $4A$. Energy is connected to the maximum displacement from equilibrium, not to the total path length covered during a cycle.

Although the algebra above was written for a mass-spring oscillator, the underlying energy story is broader. The spring is special because its potential energy is exactly $\frac{1}{2}kx^2$, which makes the formulas especially clean. But the pattern is not limited to springs. In any undamped simple harmonic oscillator, energy repeatedly shifts between stored potential energy and kinetic energy while the total remains constant. Far from equilibrium, more of the energy is stored. Near equilibrium, more of it is kinetic. That is why oscillators slow down near turning points and move fastest as they pass through equilibrium.

A small-angle pendulum shows the same pattern in a different form. Near the ends of its swing, it is momentarily at rest and its energy is stored gravitationally. Near the bottom, its speed is greatest and its energy is mostly kinetic. The details of the potential energy are different, but the exchange idea is the same: in the undamped model, the system does not need a continuous push to keep moving. It keeps moving because energy is continually converted from one form to the other.

This statement depends on the word **undamped**. In the ideal SHM model, no friction or resistance removes mechanical energy, so the total energy and amplitude remain constant. If energy is gradually removed, the amplitude no longer stays fixed. That is the next modification of the model.

We began with a question that the force view alone does not make fully satisfying: why does an oscillator speed up near equilibrium and slow down near the extremes? Energy answers this by showing that the motion is an exchange between kinetic energy and stored potential energy. At the turning points, the energy is stored and the speed is zero. At equilibrium, the stored spring energy is minimal and the speed is maximal. Between those points, conservation of energy links position and speed directly. This prepares the next subsection, where the ideal assumption of constant mechanical energy is relaxed and damping is introduced as energy loss.
