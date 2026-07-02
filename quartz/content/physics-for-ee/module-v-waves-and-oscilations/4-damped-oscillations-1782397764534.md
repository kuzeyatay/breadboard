---
title: "4) Damped oscillations"
date: "2026-06-25T14:29:24.534Z"
source: "user-note"
knowledge_type: "user-note"
tags: ["energy-loss-is-greatest-near-equilibrium", "damping-force-opposes-oscillator-velocity", "restoring-force-depends-on-displacement", "turning-points-can-have-zero-damping-force", "critical-damping-returns-fastest-without-overshoot", "damped-amplitude-decays-exponentially-over-time", "damping-and-forcing-exchange-energy-oppositely", "damping-removes-mechanical-energy-from-motion", "overdamping-slows-nonoscillatory-return", "weak-damping-preserves-oscillatory-motion", "damping-lowers-oscillator-angular-frequency"]
---

## Damped oscillations

The undamped oscillator is an ideal starting point: energy moves back and forth between kinetic energy and stored potential energy, and the total mechanical energy stays constant. That is why the amplitude remains the same from cycle to cycle. But real oscillators rarely behave this way forever. A vibrating ruler gradually comes to rest, a swinging pendulum slowly loses height, and a mass on a spring eventually stops moving. The restoring force still tries to bring the system back toward equilibrium, but now there is another effect: mechanical energy is being removed from the motion.

This is the idea of **damping**. Damping is not the same thing as the restoring force. The restoring force depends on displacement and points toward equilibrium. Damping depends on motion and opposes the velocity. For many systems moving slowly through air or another resistive environment, a useful model is that the damping force is proportional to velocity:

$$
F_d = -bv.
$$

Here $F_d$ is the damping force, $v = dx/dt$ is the velocity of the oscillator, and $b$ is the damping constant. The minus sign means that the damping force always points opposite to the direction of motion. If the mass moves to the right, damping acts left. If the mass moves to the left, damping acts right. This is why damping removes energy: it always acts against the motion rather than helping it.

For a mass-spring oscillator, the spring force is still

$$
F_s = -kx,
$$

where $k$ is the spring constant and $x$ is displacement from equilibrium. With damping included, the net force is the sum of the spring force and the damping force:

$$
F_{\text{net}} = -kx - bv.
$$

Using Newton’s second law, $F_{\text{net}} = ma$, with $a = d^2x/dt^2$, gives

$$
m\frac{d^2x}{dt^2} = -b\frac{dx}{dt} - kx.
$$

Rearranging,

$$
m\frac{d^2x}{dt^2} + b\frac{dx}{dt} + kx = 0.
$$

This is the equation of a damped oscillator. Compared with the undamped SHM equation,

$$
m\frac{d^2x}{dt^2} + kx = 0,
$$

there is one new term:

$$
b\frac{dx}{dt}.
$$

That extra term is what breaks the ideal conservation of mechanical energy. The oscillator still has a restoring force, but each motion through the surrounding medium removes some of the mechanical energy.

![pasted 1782398272435](/physics-for-ee/assets/pasted-1782398272435.png)

For weak damping, we should expect two things to be true at the same time. The spring is still trying to pull the mass back toward equilibrium, so the motion should still have a back-and-forth oscillatory character. But damping is continuously removing mechanical energy, so the amplitude should not stay fixed. The mathematical solution therefore has the structure “oscillation multiplied by a decaying amplitude”:

$$
x(t) = A e^{-bt/2m}\cos(\omega' t + \phi).
$$

Here $A$ is the initial amplitude factor, $e^{-bt/2m}$ is the exponential decay envelope, $\phi$ is the phase constant, and $\omega'$ is the damped angular frequency. The cosine describes the repeated motion through equilibrium. The exponential factor describes the gradual loss of amplitude from one cycle to the next. This is why a damped oscillator is not simply an undamped oscillator with a smaller amplitude; its amplitude is changing continuously with time.

The damped angular frequency is

$$
\omega' = \sqrt{\frac{k}{m} - \frac{b^2}{4m^2}}.
$$

The first term, $k/m$, is the same quantity that gave the undamped angular frequency:

$$
\omega = \sqrt{\frac{k}{m}}.
$$

The second term, $b^2/(4m^2)$, shows the effect of damping. As damping increases, the oscillation becomes slower. For weak damping, $\omega'$ is only slightly smaller than $\omega$, so the oscillator still behaves almost like the ideal SHM oscillator, except that the amplitude decays.

![pasted 1782398382359](/physics-for-ee/assets/pasted-1782398382359.png)

The envelope is important because it prevents a common misreading of damped motion. A damped oscillator is not simply an undamped oscillator with a smaller fixed amplitude. Its amplitude is changing with time. At early times the oscillation may be large; later it is smaller. The factor $e^{-bt/2m}$ tells us that the amplitude decreases exponentially, not linearly. Equal time intervals reduce the amplitude by equal factors, not by equal absolute amounts.

The energy view explains why the envelope shrinks. The damping force does work against the motion. The rate at which damping removes mechanical energy is the power delivered by the damping force:

$$
\frac{dE}{dt} = F_d v.
$$

Since

$$
F_d = -bv,
$$

we get

$$
\frac{dE}{dt} = -bv^2.
$$

This equation says that the mechanical energy decreases with time, because $v^2$ is always nonnegative. The minus sign means energy is leaving the oscillator. It also shows that energy loss is not equally strong at every point in the cycle. The loss is greatest when the speed is greatest, which happens near equilibrium. At the turning points, the velocity is momentarily zero, so the instantaneous rate of energy loss due to this velocity-dependent damping is zero.

This is another useful place to separate displacement, velocity, and energy. At a turning point, the oscillator is farthest from equilibrium, so the spring force is largest. But the speed is zero, so the damping force is zero at that instant. Near equilibrium, the spring force is small or zero, but the speed is largest, so the damping force and energy loss are largest. Damping is therefore not strongest where displacement is largest; it is strongest where speed is largest.

As the damping constant $b$ increases, the oscillator does not merely keep the same kind of motion with a smaller amplitude. Its whole character changes. With small damping, the restoring force is still strong enough to carry the mass through equilibrium and to the other side, so the system oscillates while the amplitude decays. This case is called **underdamped** motion.

If damping is increased, each passage through equilibrium removes more energy, and eventually the system no longer has enough motion to overshoot. It returns to equilibrium without crossing back and forth. The boundary between “still oscillates” and “no longer oscillates” is called **critical damping**. For the mass-spring system with damping force $-bv$, critical damping occurs when

$$
b = 2\sqrt{km}.
$$

At this value, the system returns to equilibrium as quickly as possible without overshooting. If $b$ is made even larger, the system is **overdamped**. It still returns without oscillating, but now the damping is so strong that the return is slower.

[Interactive visual: Underdamped, critically damped, and overdamped motion — adjust the damping constant $b$ and observe the transition from decaying oscillation to fastest non-oscillatory return to slow non-oscillatory return]

This distinction matters because damping does not always mean “a smaller oscillation.” Sometimes damping still allows oscillation, with a gradually shrinking amplitude. Sometimes damping prevents oscillation altogether. What decides the behaviour is the size of the damping compared with the spring stiffness $k$ and mass $m$. Stronger stiffness tends to restore the system more aggressively. Larger mass tends to make the system harder to change. Damping competes with both effects by removing energy and opposing velocity.

Damping should also not be confused with forcing. Damping removes mechanical energy from the oscillator; forcing supplies energy from outside. A damped oscillator left alone eventually loses its motion. A forced oscillator, treated next, may maintain motion because an external periodic force keeps feeding energy into the system.

We started from the failure of the undamped model: real oscillators do not keep the same amplitude forever. That required adding a new kind of force, one that opposes velocity rather than displacement. Combining this damping force with the spring restoring force produced the damped oscillator equation. Its solution shows two simultaneous effects: the system may still oscillate, but the oscillation is trapped inside a shrinking envelope. The energy view explains why the envelope shrinks: damping creates a one-way leak of mechanical energy, strongest when the speed is largest. This prepares the next subsection, where the question changes from how oscillations die away to how an external periodic force can sustain or amplify them.
