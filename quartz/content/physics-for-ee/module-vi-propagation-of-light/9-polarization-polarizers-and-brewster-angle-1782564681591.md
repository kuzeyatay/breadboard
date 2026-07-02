---
title: "9)  Polarization, polarizers, and Brewster angle"
date: "2026-06-27T12:51:21.591Z"
source: "user-note"
knowledge_type: "user-note"
---

## Polarization, polarizers, and Brewster angle

So far, we have mostly described light by asking where it goes: which path a ray follows, how much it bends, and how its path depends on refractive index or wavelength. But a ray diagram leaves out an important part of the wave. A ray tells us the direction of propagation; it does not tell us the direction in which the light wave oscillates. That missing information is described by **polarization**.

The idea is easiest to see first with a transverse mechanical wave. A wave travelling along a rope can move the rope up and down, or it can move the rope left and right, while still travelling forward along the rope. The propagation direction is the same in both cases, but the oscillation direction is different. Light is also transverse, but the oscillating quantity is not a rope displacement. Light is an electromagnetic wave, and its electric field and magnetic field oscillate perpendicular to the direction of propagation. By convention, the **polarization of light** is defined by the direction of the electric field.

So when light is called vertically polarized, this means that its electric field oscillates vertically. When it is called horizontally polarized, its electric field oscillates horizontally. The ray still tells us where the light travels; the polarization tells us the direction of the electric-field oscillation perpendicular to that travel direction. This is why polarization is not visible in an ordinary ray diagram. Two rays can follow the same path while carrying different polarization states.

Natural light from the Sun or from an ordinary lamp is usually **unpolarized**. This does not mean that the electric field is absent. It means that the light contains many electric-field directions with no single preferred direction. A polarizer turns this mixture into linearly polarized light by transmitting one component of the electric field and absorbing the perpendicular component. This selective absorption of one polarization component is called **dichroism**.

For ideal unpolarized light entering one linear polarizer, the transmitted intensity is

$$
I_1=\frac{1}{2}I_0.
$$

Here $I_0$ is the intensity before the polarizer, and $I_1$ is the intensity after the first ideal polarizer. The factor $1/2$ appears because unpolarized light has no preferred transverse direction, so on average only half of its intensity lies along the polarizer’s transmission axis. This rule belongs specifically to unpolarized light passing through the first ideal polarizer. After that first polarizer, the transmitted light is no longer unpolarized; it is linearly polarized along the polarizer’s transmission axis.

That distinction is what makes the second polarizer different. Suppose linearly polarized light reaches another polarizer. Let $\phi$ be the angle between the incoming electric-field direction and the transmission axis of the polarizer. Only the component of the electric field parallel to the transmission axis passes through. If the incoming electric-field amplitude is $E$, then the transmitted amplitude is

$$
E_{\text{trans}}=E\cos\phi.
$$

Intensity is proportional to the square of electric-field amplitude, so the transmitted intensity is proportional to

$$
E_{\text{trans}}^2=E^2\cos^2\phi.
$$

Therefore,

$$
I=I_{\max}\cos^2\phi.
$$

This is **Malus’s law**. Here $I$ is the transmitted intensity, $I_{\max}$ is the intensity transmitted when the incoming polarization is aligned with the polarizer axis, and $\phi$ is the angle between the incoming polarization direction and the polarizer axis. The cosine appears because the electric field is projected onto the transmission axis; the square appears because intensity depends on the square of the field amplitude.
![pasted 1782566514555](/physics-for-ee/assets/pasted-1782566514555.png)

The limiting cases make the law easy to read. If the two directions are aligned, then $\phi=0^\circ$, so

$$
I=I_{\max}\cos^2 0^\circ=I_{\max}.
$$

The second polarizer transmits all of the already-aligned polarized light in the ideal model. If the axes are crossed, then $\phi=90^\circ$, so

$$
I=I_{\max}\cos^2 90^\circ=0.
$$

No electric-field component lies along the second polarizer’s transmission axis. If $\phi=45^\circ$, then

$$
\cos^2 45^\circ=\frac{1}{2},
$$

so the second polarizer transmits half of the already-polarized intensity incident on it.

This repairs a common confusion. The rule for the first polarizer and the rule for a later polarizer are not usually the same. For unpolarized incoming light, the first ideal polarizer gives

$$
I_1=\frac{1}{2}I_0.
$$

For a second polarizer after that, the incoming light is already linearly polarized, so Malus’s law applies. If unpolarized light of intensity $I_0$ passes through two ideal polarizers whose axes differ by an angle $\phi$, the final intensity is therefore

$$
I=\frac{I_0}{2}\cos^2\phi.
$$

A polarizer is not the only way to select polarization. Reflection from a surface can also favor one electric-field direction over another. This is why polarization now reconnects with ray optics. When light reflects from an interface, the amount of reflected light depends on the angle of incidence and on the orientation of the electric field relative to the plane of incidence. At one special angle, one reflected polarization component disappears. The reflected light is then linearly polarized. This special angle is called the **Brewster angle** or **polarizing angle**.

To find this angle, consider light incident from medium $a$, with refractive index $n_a$, onto medium $b$, with refractive index $n_b$. The Brewster angle is written $\theta_p$. At this angle, the reflected ray and refracted ray are perpendicular to each other. Since the reflected angle equals the incident angle, the reflected ray also makes an angle $\theta_p$ with the normal. Therefore the refracted angle must be

$$
\theta_b=90^\circ-\theta_p.
$$

Now apply Snell’s law:

$$
n_a\sin\theta_p=n_b\sin\theta_b.
$$

Substituting $\theta_b=90^\circ-\theta_p$ gives

$$
n_a\sin\theta_p=n_b\sin(90^\circ-\theta_p).
$$

Since

$$
\sin(90^\circ-\theta_p)=\cos\theta_p,
$$

we get

$$
n_a\sin\theta_p=n_b\cos\theta_p.
$$

Dividing by $n_a\cos\theta_p$ gives Brewster’s law:

$$
\tan\theta_p=\frac{n_b}{n_a}.
$$

This is the key quantitative result for polarization by reflection. It gives the incident angle at which the reflected light becomes linearly polarized. It is not a threshold like the critical angle for total internal reflection. The Brewster angle is one specific angle at which the reflected ray is missing one polarization component.

![pasted 1782566685079](/physics-for-ee/assets/pasted-1782566685079.png)

A subtle misconception is worth fixing immediately. Brewster’s angle mainly describes the **reflected** light. It does not say that the transmitted or refracted light becomes completely polarized. At $\theta_p$, both reflected and refracted rays can exist, but the reflected ray is missing one polarization component. The transmitted ray may have a changed balance of polarization components, but Brewster’s law is not a rule that makes the transmitted beam perfectly polarized.

This is the principle behind the reduction of glare by polarized sunglasses. Light reflected from horizontal surfaces such as water, roads, or tables is often strongly polarized, especially when the reflection occurs near the Brewster angle. For a mostly horizontal reflecting surface, the glare is dominated by a horizontal electric-field direction. Polarized sunglasses transmit mostly vertical polarization and absorb much of the horizontal component. They do not merely dim all light equally; they preferentially remove a common polarization direction of reflected glare.

So polarization adds information that ray diagrams alone did not contain. We started with paths of light, then noticed that a transverse light wave also has an electric-field direction. A polarizer selects one component of that electric field: unpolarized light gives $I_1=I_0/2$ after one ideal polarizer, while already-polarized light obeys Malus’s law $I=I_{\max}\cos^2\phi$. Reflection can also select polarization: at the Brewster angle, $\tan\theta_p=n_b/n_a$, the reflected light loses one polarization component. This prepares the next step, where light is redirected not by smooth interfaces or polarizing filters, but by scattering from small particles and molecules.
