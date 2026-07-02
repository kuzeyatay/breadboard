---
title: "11) Standing waves, modes, harmonics, and resonance on strings"
date: "2026-06-26T13:36:38.300Z"
source: "user-note"
knowledge_type: "user-note"
---

## Standing waves, modes, harmonics, and resonance on strings

The previous subsection showed that reflection brings waves back into the region where the original wave is still travelling. Once that happens, superposition becomes unavoidable: the displacement of the string is the sum of the incident wave and the reflected wave. Usually, when two pulses overlap, the combined shape changes for a moment and then the pulses continue. But if the wave is periodic and the reflection happens repeatedly, the overlap can become organized into a stable-looking pattern. That pattern is called a **standing wave**.

A standing wave is not a wave that has stopped moving in the sense that the string is motionless. The string elements still oscillate up and down. What has stopped travelling is the overall pattern of nodes and antinodes. Some points remain permanently at rest, while other points oscillate with large amplitude. The result looks as if the wave pattern is standing in place rather than moving along the string.

The cleanest ideal model of this situation is a string on which a sinusoidal wave travels in one direction while an equal sinusoidal wave travels back in the opposite direction after reflection. This does not describe every possible reflection in full detail, but it captures the central mechanism of standing-wave formation: two waves with the same frequency and wavelength overlap while travelling in opposite directions.

Let the right-moving wave be

$$
y_1(x,t)=A\sin(kx-\omega t),
$$

and let the left-moving wave be

$$
y_2(x,t)=A\sin(kx+\omega t).
$$

Here $A$ is the amplitude of each travelling wave, $k$ is the wave number, $\omega$ is the angular frequency, $x$ is position along the string, and $t$ is time. These two waves have the same shape and timing, but their signs in the phase show that they move in opposite directions. By superposition, the actual displacement of the string is

$$
y(x,t)=y_1(x,t)+y_2(x,t).
$$

Using the trigonometric identity

$$
\sin \alpha+\sin \beta
=2\sin\left(\frac{\alpha+\beta}{2}\right)
\cos\left(\frac{\alpha-\beta}{2}\right),
$$

we get

$$
y(x,t)=2A\sin(kx)\cos(\omega t).
$$

This equation is the mathematical signature of a standing wave. It is no longer written as a single travelling phase such as $kx-\omega t$. Instead, the expression separates into a spatial factor and a time factor:

$$
y(x,t)=\bigl[2A\sin(kx)\bigr]\cos(\omega t).
$$

The factor $2A\sin(kx)$ tells how large the oscillation can be at each position. The factor $\cos(\omega t)$ tells how all those positions oscillate in time. This separation is why the pattern does not travel to the right or left. Each point has its own amplitude, fixed by position.

![pasted 1782481361806](/physics-for-ee/assets/pasted-1782481361806.png)

The places where the spatial factor is zero are called **nodes**. At a node,

$$
\sin(kx)=0,
$$

so

$$
y(x,t)=0
$$

for all times. A node is therefore a point of the string that never moves. The places where the spatial factor has maximum magnitude are called **antinodes**. At an antinode, the string oscillates with the largest possible amplitude in that standing-wave pattern. The distance between neighboring nodes is half a wavelength, $\lambda/2$, and the distance between a node and the nearest antinode is $\lambda/4$.

This repairs an important misconception. In a travelling wave, crests and troughs move along the string. In a standing wave, nodes and antinodes do not travel along the string. The string still moves, but the pattern of where motion is zero and where motion is largest stays fixed. A standing wave is therefore not “no motion”; it is organized oscillation with fixed spatial locations of zero and maximum amplitude.

Nodes and antinodes are not just visual features of the pattern; they determine which standing waves can fit on a real string. If a string is fixed at both ends, such as an idealized guitar string, the endpoints cannot move. That means the endpoints must be nodes. If the string has length $L$, the boundary conditions are

$$
y(0,t)=0
$$

and

$$
y(L,t)=0
$$

for all times. The first condition is already satisfied by

$$
y(x,t)=2A\sin(kx)\cos(\omega t),
$$

because $\sin(0)=0$. The second endpoint can be a node only if

$$
\sin(kL)=0.
$$

This is the moment where the continuous freedom of travelling waves becomes restricted. A travelling wave can have many wavelengths, but a standing wave on a finite fixed string must place nodes exactly at the endpoints.

The condition

$$
\sin(kL)=0
$$

is satisfied only when

$$
kL=n\pi,
$$

where

$$
n=1,2,3,\ldots
$$

is a positive integer. Since the wave number is related to wavelength by

$$
k=\frac{2\pi}{\lambda},
$$

the condition $kL=n\pi$ becomes

$$
\frac{2\pi}{\lambda}L=n\pi.
$$

Cancelling $\pi$ gives

$$
\frac{2L}{\lambda}=n,
$$

so the allowed wavelengths are

$$
\lambda_n=\frac{2L}{n}.
$$

Equivalently,

$$
L=\frac{n\lambda_n}{2}.
$$

This equation has a simple physical meaning: a string fixed at both ends must contain an integer number of half-wavelengths. The endpoints are nodes, so the string length must fit node-to-node segments exactly. If a wavelength does not fit this condition, the reflected waves do not reinforce into a stable standing-wave pattern.

![pasted 1782481452016](/physics-for-ee/assets/pasted-1782481452016.png)

Each allowed standing-wave pattern is called a **mode** or **normal mode**. The integer $n$ labels the mode. The first mode, $n=1$, has one half-wavelength on the string:

$$
L=\frac{\lambda_1}{2},
\qquad
\lambda_1=2L.
$$

This is the **fundamental mode**. It has nodes at the two fixed ends and one antinode in the middle. The second mode, $n=2$, has two half-wavelengths on the string, so

$$
\lambda_2=L.
$$

It has a node at the middle as well as at the ends. The third mode, $n=3$, has three half-wavelengths, and so on. Higher modes contain more nodes and antinodes, so their spatial patterns are more finely divided along the same length of string.

The allowed frequencies follow from the travelling-wave relation

$$
v=\lambda f,
$$

where $v$ is the wave speed on the string and $f$ is the ordinary frequency. For the $n$-th allowed mode,

$$
f_n=\frac{v}{\lambda_n}.
$$

Substituting

$$
\lambda_n=\frac{2L}{n}
$$

gives

$$
f_n=\frac{nv}{2L}.
$$

For a stretched string,

$$
v=\sqrt{\frac{F}{\mu}},
$$

where $F$ is the tension and $\mu$ is the mass per unit length. Therefore the allowed frequencies can also be written as

$$
f_n=\frac{n}{2L}\sqrt{\frac{F}{\mu}}.
$$

This formula is the central result for standing waves on a string fixed at both ends. It shows that the allowed frequencies are not arbitrary. They are selected by the string length, the wave speed, and the boundary conditions.

The lowest allowed frequency is

$$
f_1=\frac{v}{2L}.
$$

This is the **fundamental frequency**, also called the **first harmonic**. The higher allowed frequencies are

$$
f_2=2f_1,
\qquad
f_3=3f_1,
\qquad
\ldots
$$

so in general,

$$
f_n=nf_1.
$$

These higher frequencies are called **harmonics**. The second harmonic is twice the fundamental frequency, the third harmonic is three times the fundamental frequency, and so on. On an ideal string fixed at both ends, the harmonics form integer multiples of the fundamental frequency.
![pasted 1782481738707](/physics-for-ee/assets/pasted-1782481738707.png)
This is also where resonance reappears in a richer form. Earlier, resonance meant that a single oscillator responds strongly when driven near its natural frequency. A fixed string behaves like a system with many natural frequencies, one for each allowed standing-wave mode:

$$
f_1,\ f_2,\ f_3,\ldots
$$

If the string is driven at one of these frequencies, the reflected waves return with the right phase to reinforce the motion, so the corresponding standing-wave pattern can build up. If the driving frequency does not match one of the allowed frequencies, the reflections do not consistently reinforce the pattern, and the response is weaker. Resonance on a string is therefore not a single frequency condition; it is a set of frequency conditions selected by the boundaries.

This is why a string instrument can produce distinct tones. Changing the length $L$, the tension $F$, or the mass per unit length $\mu$ changes the allowed frequencies. Increasing the tension increases the wave speed and raises the frequencies. Increasing the length lowers the frequencies. Increasing the mass per unit length lowers the wave speed and lowers the frequencies. The formula

$$
f_n=\frac{n}{2L}\sqrt{\frac{F}{\mu}}
$$

makes these dependencies explicit.

Resonance on a string should not be confused with the claim that only one frequency is possible. A string can support many modes. Which modes are actually present depends on how the string is disturbed or driven. Plucking a string near the middle, bowing it, or driving it at a particular frequency can excite different mixtures of modes. The allowed frequencies tell us which standing-wave patterns are compatible with the boundary conditions; they do not by themselves tell us the exact mixture of amplitudes in a real vibration.

Another common confusion is to think that the wave speed changes from one harmonic to another because the frequency changes. For an ideal string with fixed $F$ and $\mu$, the wave speed

$$
v=\sqrt{\frac{F}{\mu}}
$$

is the same for all harmonics. Higher harmonics have higher frequencies because they have shorter wavelengths. The relation

$$
v=\lambda_n f_n
$$

still holds. As $n$ increases, $\lambda_n$ decreases and $f_n$ increases in exactly the way needed to keep $v$ fixed.

Standing waves also clarify why boundary conditions matter so much. The same wave equation can allow many travelling waves, but a finite string with fixed endpoints only supports standing-wave patterns that fit the endpoints. The wave equation describes how disturbances propagate; the boundary conditions select the allowed modes. This is the reason the integer $n$ appears. It does not come from the wave speed formula alone. It comes from the requirement that the string have nodes at both fixed ends.

The discussion here has focused on a string fixed at both ends because that is the central case for this subsection. Other boundary conditions, such as one fixed end and one free end, lead to different allowed patterns. Those variants are useful later, but the essential mechanism is already visible here: reflection plus superposition creates a standing pattern, and boundary conditions decide which patterns survive as modes.

We started from the overlap of incident and reflected waves. Superposition showed that two opposite-travelling sinusoidal waves can combine into a standing wave with fixed nodes and antinodes. The fixed endpoints then forced the endpoints to be nodes, which allowed only wavelengths satisfying

$$
L=\frac{n\lambda_n}{2}.
$$

Those allowed wavelengths led directly to the allowed frequencies

$$
f_n=\frac{nv}{2L}
=\frac{n}{2L}\sqrt{\frac{F}{\mu}}.
$$

The conceptual result is that boundaries turn travelling-wave motion into discrete resonant patterns. Standing waves are therefore not separate from travelling waves; they are what travelling waves become when reflection, superposition, and boundary conditions repeatedly act together.
