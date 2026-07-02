---
title: "5) Forced oscillations and resonance"
date: "2026-06-25T15:49:43.504Z"
source: "user-note"
knowledge_type: "user-note"
---

## Forced oscillations and resonance

A damped oscillator left alone eventually loses its motion. The restoring force may keep pulling it back toward equilibrium, but damping continuously removes mechanical energy, so the amplitude shrinks. This raises a natural question: how can real oscillations persist? A child on a swing can keep swinging if someone pushes at the right moments. A bridge can keep vibrating if wind repeatedly supplies energy. A mechanical system can be kept in motion if energy is added from outside while damping removes energy. This is the setting of **forced oscillation**.

A forced oscillator is not simply an oscillator with less damping. Damping removes energy; forcing supplies energy. To model this, return to the damped mass-spring system. Without forcing, its equation was

$$
m\frac{d^2x}{dt^2}+b\frac{dx}{dt}+kx=0,
$$

where $m$ is the mass, $b$ is the damping constant, $k$ is the spring constant, and $x$ is displacement from equilibrium. The zero on the right means the oscillator is left alone after being displaced or given an initial velocity. If an external force keeps acting on the system, the right-hand side is no longer zero. A common and important case is a sinusoidal driving force,

$$
F_{\text{ext}}(t)=F_{\max}\cos(\omega_d t).
$$

Here $F_{\max}$ is the maximum size of the external force, and $\omega_d$ is the **driving angular frequency**. The subscript $d$ reminds us that this frequency belongs to the driver, not necessarily to the oscillator itself. The equation becomes

$$
m\frac{d^2x}{dt^2}
+b\frac{dx}{dt}
+kx
=
F_{\max}\cos(\omega_d t).
$$

This equation contains three competing effects. The spring term $kx$ represents the restoring tendency, the damping term $b\,dx/dt$ represents energy loss, and the right-hand side represents energy supplied from outside. The motion that results depends not only on how large the force is, but also on how often the force is applied.

![pasted 1782410370001](/physics-for-ee/assets/pasted-1782410370001.png)

At the moment the driving force is first applied, the motion can be complicated. The oscillator may still contain a **free response**, caused by its initial displacement or initial velocity, while also beginning to respond to the external force. But the free response is the same kind of motion studied in damping: because of the damping term, it gradually dies away. The driven part is different. It is continually recreated by the external force, so it remains after the initial motion has faded.

After enough time, the motion is therefore dominated by the driver. This long-term motion is called the **steady-state response**. In steady state, the oscillator moves with the driving angular frequency $\omega_d$, because that is the rhythm imposed from outside. However, the size of that motion is not fixed by $F_{\max}$ alone. The amplitude depends strongly on how well the driving frequency matches the oscillator’s own natural timing.

The natural angular frequency of the undamped mass-spring oscillator is

$$
\omega_0=\sqrt{\frac{k}{m}}.
$$

This is the frequency the system would have if it were displaced and released with no damping and no external forcing. The driving angular frequency $\omega_d$, however, is chosen by the outside agent. These two frequencies answer different questions. The natural frequency belongs to the oscillator’s internal restoring-force-and-inertia balance. The driving frequency belongs to the external force. Forced motion becomes especially interesting when these two frequencies are close.

To see why, imagine pushing a swing. If the pushes come at random times, some pushes help the motion, some oppose it, and little amplitude builds up. If the pushes are much too slow, the swing has already moved away from the useful part of the cycle before the next push arrives. If the pushes are much too fast, they alternate too quickly for the swing to respond effectively. But if each push is timed so that it adds energy in step with the motion, the amplitude can grow. This is the physical idea behind **resonance**.

To understand this dependence more carefully, imagine repeating the same experiment many times. Each time, use the same oscillator, the same damping, and the same driving-force amplitude $F_{\max}$, but choose a different driving angular frequency $\omega_d$. For each choice, wait until the transient free motion has died away, then measure the steady-state amplitude. The result is an amplitude response curve: it shows how strongly the oscillator responds to each driving frequency.

[Interactive visual: Resonance curve — sweep the driving frequency $\omega_d$ and observe how the steady-state amplitude changes, with the largest response near the natural frequency]

If $\omega_d$ is much smaller than the natural angular frequency $\omega_0$, the force changes slowly and the mass can follow it without building a dramatic oscillation. If $\omega_d$ is much larger than $\omega_0$, the force reverses too quickly for the mass to follow; inertia prevents a large displacement from developing. Between these limits, near the natural frequency, the timing is favorable. The external force tends to do positive work over many cycles, so energy accumulates in the oscillation until damping removes energy at the same average rate.

This is why resonance should not be defined simply as “large amplitude.” A large amplitude could be produced by applying a very large force. Resonance is more specific: it is the strong response that occurs because the driving frequency is near the system’s natural frequency, so the external force is timed to transfer energy efficiently into the motion. The amplitude becomes large not merely because the force exists, but because the force repeatedly adds energy at the right part of the cycle.

Damping then decides how far this buildup can go. With weak damping, little energy is removed each cycle, so the resonance peak is high and sharp. With stronger damping, energy is removed more quickly, so the peak is lower and broader. In steady state, the amplitude no longer grows because the average energy supplied by the driver is balanced by the average energy removed by damping.

![pasted 1782410410288](/physics-for-ee/assets/pasted-1782410410288.png)

This explains why resonance can be useful or dangerous depending on the system. In many devices, resonance is deliberately used to obtain a strong response at a chosen frequency. But in mechanical structures, a repeated external influence near a natural frequency can produce unexpectedly large motion. A bridge excited by wind, a glass driven by sound, or a mechanical part exposed to periodic vibration can respond strongly if the driving frequency is close to one of its natural frequencies. The important point is not that the external force is necessarily large; it may be modest. The danger comes from repeated energy input at the right timing.

This also shows why damping is often protective. If a system has enough damping, energy supplied by the driver is removed before a very large amplitude can develop. This does not eliminate the restoring force or the natural frequency, but it changes the amplitude response. The system may still respond most strongly near resonance, but the maximum response is reduced. In engineering terms, damping can be used to prevent small repeated forces from building into large oscillations.

It is useful to keep the roles of the three frequencies separate. The undamped natural frequency $\omega_0=\sqrt{k/m}$ belongs to the ideal oscillator. The damped free-oscillation frequency $\omega'$ describes how the system oscillates when released and then left alone with damping. The driving frequency $\omega_d$ belongs to the external force. Resonance concerns the relationship between the driving frequency and the system’s natural tendency to oscillate. The oscillator does not resonate simply because it is moving; it resonates when the external forcing is timed to feed energy into the motion efficiently.

We started from the fact that damped oscillations die away, which required a new ingredient: an external force that can supply energy. Writing that force as $F_{\max}\cos(\omega_d t)$ led to the forced damped oscillator equation. The initial free response is damped away, but the driven response remains, and its amplitude depends on the match between the driving frequency and the oscillator’s natural frequency. Resonance is the special case where this timing makes energy transfer especially efficient, while damping limits the final amplitude. This completes the single-oscillator picture and prepares the transition to mechanical waves, where oscillatory motion is carried from one part of a medium to the next.
