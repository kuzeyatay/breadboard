---
title: "10)Superposition and reflection"
date: "2026-06-26T10:32:41.121Z"
source: "user-note"
knowledge_type: "user-note"
---

## Superposition and reflection

So far, a travelling wave has mostly been treated as if it were alone. We described one disturbance moving along a string, found the wave equation that allows it to propagate, and calculated the energy and power it can carry. But real waves often meet other waves or boundaries. A pulse may travel down a string and reach a wall. Two pulses may approach each other from opposite directions. A wave sent along one medium may encounter a new medium. The next question is therefore not only how one wave moves, but what happens when waves overlap or when a wave reaches the end of the region in which it is travelling.

The simplest new idea is **superposition**. In the ideal string model used so far, the wave equation is linear. This means that if one displacement pattern $y_1(x,t)$ is allowed, and another displacement pattern $y_2(x,t)$ is also allowed, then their sum is also allowed. Physically, when two small waves overlap on the same string, the string does not choose one wave and ignore the other. The actual displacement is the algebraic sum of the displacements each wave would have produced separately:

$$
y_{\text{total}}(x,t)=y_1(x,t)+y_2(x,t).
$$

Here $y_{\text{total}}(x,t)$ is the actual displacement of the medium at position $x$ and time $t$, while $y_1$ and $y_2$ are the displacements due to the two individual waves. The word algebraic matters. If one wave displaces the string upward and the other also displaces it upward, the displacements add to make a larger upward displacement. If one wave displaces the string upward while the other displaces it downward, the displacements partially or completely cancel.

![pasted 1782479170332](/physics-for-ee/assets/pasted-1782479170332.png)

This repairs a common misconception about wave collisions. When two pulses meet on a string, they do not bounce off each other like solid objects. During the overlap, the string takes the displacement given by the sum of the two pulse shapes. After they pass through each other, each pulse continues moving as before, provided the medium remains linear and the waves are not so large that the ideal model breaks down. The temporary combined shape during overlap is not a permanent merging of the waves; it is the instantaneous result of adding displacements.

This addition can produce **constructive interference** or **destructive interference**. Constructive interference occurs when overlapping waves displace the medium in the same direction, making the resultant displacement larger in magnitude. Destructive interference occurs when overlapping waves displace the medium in opposite directions, making the resultant displacement smaller in magnitude. Complete cancellation can occur at an instant and location if two equal displacements have opposite signs. But this does not mean the energy has disappeared. The waves continue to propagate, and the motion and energy distribution must be understood over the whole medium and over time, not from one instant alone.

For example, suppose two identical upward pulses approach each other on a string. At the moment they overlap exactly, the displacement is twice as large as either pulse alone. If instead one pulse is upward and the other is downward with the same shape, the string may be momentarily flat where they overlap. That flat shape can be misleading. It does not mean there are no waves anymore. It means the displacement contributions cancel at that instant; the pulses then continue past one another.

The same principle applies to sinusoidal waves. If two sinusoidal waves overlap, their displacements add point by point. Depending on their relative phase, they may reinforce or cancel at different positions and times. This phase-dependent addition is the foundation for the standing-wave patterns studied next, but the essential rule is already here: the medium’s displacement is the sum of the individual wave displacements.

![pasted 1782479663378](/physics-for-ee/assets/pasted-1782479663378.png)

Superposition explains what happens when waves meet other waves. It also prepares us to understand reflection, because a reflected wave does not simply replace the incoming wave. Near a boundary, the incoming and reflected disturbances can occupy the same region of the string, so the actual displacement is again found by adding contributions. The new ingredient is the boundary condition: the end of the string or the change of medium imposes a constraint that the total displacement must satisfy.

A boundary is a place where the conditions for the wave change. The end of a string tied to a wall is a boundary. The end of a string attached to a light ring that can slide vertically is another kind of boundary. The junction between two strings with different mass per unit length is also a boundary. At such a place, the incident wave cannot simply continue as though nothing has changed. A reflected wave appears so that the total motion near the boundary is consistent with the physical constraint there.

The cleanest case is a pulse reaching a fixed end. A fixed end is a point of the string that cannot move. If the end is at $x=0$, the boundary condition is

$$
y(0,t)=0
$$

for all times $t$. This equation says that the endpoint must remain at equilibrium no matter what wave reaches it. But an incoming pulse alone would try to move the endpoint. The only way to satisfy the fixed-end condition is for a reflected pulse to appear so that, at the endpoint, the incoming and reflected displacements cancel. Therefore a pulse reflected from a fixed end is inverted.

This inversion is not a separate rule added by hand. It follows from superposition plus the boundary condition. The incoming wave tries to give the endpoint some displacement; the reflected wave must provide the opposite displacement at that endpoint so that the sum remains zero. If an upward pulse reaches a fixed end, the reflected pulse is downward.

![pasted 1782479799480](/physics-for-ee/assets/pasted-1782479799480.png)

![pasted 1782479817297](/physics-for-ee/assets/pasted-1782479817297.png)

A free end behaves differently because it is allowed to move transversely. It is not required to remain at $y=0$. In the ideal string model, the free end also cannot be pulled by a transverse support force from a clamp. The boundary condition is therefore not zero displacement, but zero transverse force at the end. For a string under tension, that corresponds to the string having zero slope at the endpoint:

$$
\left.\frac{\partial y}{\partial x}\right|_{\text{end}}=0.
$$

The reflected pulse must now combine with the incoming pulse so that this slope condition is satisfied. That happens without inverting the displacement. An upward pulse reflects as an upward pulse. The endpoint moves with the arriving disturbance rather than forcing the displacement to cancel.

The contrast between fixed and free ends shows that reflection is controlled by the boundary condition, not by the word “end” alone. A fixed end imposes zero displacement and produces inversion. A free end imposes zero transverse force, or zero slope in the ideal model, and produces reflection without inversion.

[Interactive visual: Fixed versus free reflection — switch the endpoint between clamped and free, then compare the phase of the reflected pulse]

A boundary between two different strings is the more general version of the same idea. If a wave travelling on one string reaches a second string with a different mass per unit length, the wave speed changes because

$$
v=\sqrt{\frac{F}{\mu}}.
$$

If the tension $F$ is the same but $\mu$ changes, the second string cannot support the same travelling wave in exactly the same way as the first. The boundary must connect the motion of the two strings, and the result is generally a combination of a reflected wave travelling back into the first string and a transmitted wave travelling into the second string. The exact amplitudes are not needed here. The important point is that a boundary can divide the wave’s energy: some may return, and some may continue.

This also connects reflection to energy. Reflection does not mean that the wave has been destroyed. The boundary redirects part or all of the wave’s energy. At a fixed or free end, the wave is reflected back along the string. At a boundary between different media, energy can be divided between reflected and transmitted waves. Superposition still governs the displacement wherever waves overlap, including near the boundary where incident and reflected waves occupy the same region.

Once reflection is possible, superposition becomes unavoidable again. The incident and reflected waves occupy the same string, so their displacements add. If a single pulse reflects, the overlap is temporary. If a periodic wave reflects repeatedly, the overlap can become organized into a pattern that no longer appears to travel in one direction. That special pattern is a standing wave. The next subsection develops nodes, antinodes, allowed wavelengths, and harmonics, but the mechanism is already in place: standing waves arise from the superposition of waves travelling in opposite directions.

We started from the question of what happens when waves are no longer alone. In a linear medium, overlapping waves obey superposition: the actual displacement is the algebraic sum

$$
y_{\text{total}}(x,t)=y_1(x,t)+y_2(x,t).
$$

That explains constructive and destructive interference and shows why pulses can pass through one another rather than collide like objects. When a wave reaches a boundary, the boundary condition determines the reflected wave: a fixed end requires zero displacement and gives an inverted reflection, while a free end requires zero transverse force and reflects without inversion. When reflection makes opposite-travelling waves overlap, superposition becomes the mechanism that prepares standing-wave patterns, which are the next step.
