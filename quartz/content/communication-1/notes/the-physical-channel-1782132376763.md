---
title: "The Physical Channel"
date: "2026-06-22T12:46:16.763Z"
source: "user-note"
knowledge_type: "user-note"
---

# The Physical Channel

Until now, the course has mostly treated communication as a sequence of signal-processing choices. An analog waveform can be sampled and quantized. Bits can be represented by line codes. A baseband signal can be moved to a carrier by modulation. These steps explain how information is represented as an electrical waveform. They do not yet answer a more physical question: after the transmitter creates the waveform, how much of it actually reaches the receiver?

That question is the purpose of the physical channel. A channel is the medium between transmitter and receiver. It may be a cable, an optical fiber, air, or free space. The channel is not just an abstract arrow in a block diagram. It attenuates the signal, delays it, may distort it, may reflect it, may block it, and may add interference and noise. The receiver therefore does not observe the transmitted signal perfectly. It observes a changed version of it.

This section appears after modulation because modulation creates the transmitted carrier signal, but the physical channel determines whether that carrier arrives with enough power and with acceptable distortion. In an AM, FM, or digitally modulated system, the mathematical transmitted signal may be correct, but the receiver still fails if the propagation loss is too large or if an obstacle creates too much additional attenuation. The immediate task is therefore to connect geometry and frequency to received power.

[Figure: Communication chain showing message processing, modulation, physical channel, and receiver. The physical channel block should be highlighted as the part that changes signal power, delay, and distortion.]

## Wired and wireless channels

A wired channel guides the signal along a physical structure. Examples are copper wires, coaxial cables, and optical fibers. A wireless channel allows the signal to propagate through space. Examples are WiFi, mobile-phone links, satellite links, and radio broadcasting. Both are communication channels, but their physical behavior is very different.

A wired link is usually stable because the path is fixed. Once a cable or fiber is installed, its length, attenuation, delay, and distortion are mostly time-invariant. The signal can still lose power or be distorted, but those effects are predictable. If a fiber has a known attenuation in dB/km, the received power can be estimated from the fiber length. If a cable has a known bandwidth, the designer can choose a signal whose spectrum fits inside it.

A wireless link is dynamic. The receiver may move, objects may move, and the surrounding environment may reflect the signal. The received power can change even when the transmitter power is constant. A mobile phone may receive a strong signal in one position and a weak signal a few meters away because the direct and reflected waves combine differently.

Capacity is also expanded differently. In a wired network, capacity can often be increased by adding another cable, adding another fiber, or using more wavelengths inside the same fiber. In a wireless network, the available spectrum is limited and shared, so capacity is improved by smaller cell sizes, spectral reuse, better antennas, better signal processing, and more efficient modulation and coding.

Interference behaves differently too. In a wired link, crosstalk from nearby channels may exist, but it is often fixed and can be predicted. In a wireless link, interference is part of the operating environment. Other users may transmit in nearby frequencies or nearby cells. The channel changes with position and time, so interference is not always predictable in advance.

Delay in a wired link is mostly length-dependent. If the cable length is fixed, the propagation delay is fixed. Delay in a wireless mobile channel changes with distance. If multiple reflected paths exist, several delayed copies of the same transmitted signal can arrive at the receiver. This is the physical origin of multipath delay spread.

The bit error behavior is also different in practice. Wired links can often achieve very low error rates because the medium is controlled and predictable. Wireless links are more strongly affected by fading, obstruction, mobility, and interference, so high reliability often requires more advanced processing, diversity, coding, and careful link design.

A quick exam-safe comparison is this: wired channels are stable, fixed, high-fidelity, difficult to intercept, and often power-grid supplied; wireless channels are mobile, time-varying, interference-prone, easier to intercept or jam, battery-limited at the receiver, and strongly affected by multipath and obstacles.

![pasted 1782136043929](/communication-1/assets/pasted-1782136043929.png)

## RF wireless propagation

Radio-frequency propagation concerns electromagnetic waves travelling through space. The carrier frequency determines the wavelength, and the wavelength affects propagation, antenna behavior, and diffraction.

The wavelength is

$$
\lambda=\frac{c}{f}.
$$

Here $\lambda$ is the wavelength in meters, $c\approx 3.0\times10^8\ \text{m/s}$ is the speed of light in air to a good approximation, and $f$ is the carrier frequency in hertz. If $f=300\ \text{MHz}$, then

$$
\lambda=\frac{3.0\times10^8}{300\times10^6}=1\ \text{m}.
$$

A frequent mistake is to insert $300$ instead of $300\times10^6$ for $300\ \text{MHz}$. The unit conversion must be done before using the formula.
![pasted 1782136071447](/communication-1/assets/pasted-1782136071447.png)

The simplest propagation model is free-space spreading. Imagine an ideal transmitter radiating equally in all directions. At distance $d$, the transmitted power is spread over a sphere with surface area

$$
4\pi d^2.
$$

Here $d$ is the transmitter-receiver distance in meters. As $d$ grows, the same power is spread over a larger area, so the power density decreases. This is why received power drops with distance even if there are no buildings, no absorption, and no interference.

A real antenna does not usually radiate equally in every direction. Antenna gain describes how strongly an antenna transmits or receives in a chosen direction compared with an ideal isotropic antenna. Let $G_{\text{Tx}}$ be the transmitter antenna gain and $G_{\text{Rx}}$ be the receiver antenna gain. If gains are used in a linear formula, they must be linear ratios, not dB values.

The free-space received power is given by Friis’ equation:

$$
P_{\text{Rx}}(d)=P_{\text{Tx}}G_{\text{Tx}}G_{\text{Rx}}\left(\frac{\lambda}{4\pi d}\right)^2.
$$

Here $P_{\text{Rx}}(d)$ is the received power in watts, $P_{\text{Tx}}$ is the transmitted power in watts, $G_{\text{Tx}}$ is the transmitter gain as a linear ratio, $G_{\text{Rx}}$ is the receiver gain as a linear ratio, $\lambda$ is the wavelength in meters, and $d$ is the distance in meters.

The formula has a clear meaning. The transmitted power is shaped by the transmitting antenna, spreads through space, and only a small fraction is captured by the receiving antenna. The distance dependence is

$$
P_{\text{Rx}}\propto \frac{1}{d^2}.
$$

Doubling the distance reduces the received power by a factor of $4$. In dB, this is a $6\ \text{dB}$ drop.

The same equation can be written in logarithmic units:

$$
P_{\text{Rx}}[\text{dBm}]=P_{\text{Tx}}[\text{dBm}]+G_{\text{Tx}}[\text{dB}]+G_{\text{Rx}}[\text{dB}]+20\log_{10}\left(\frac{\lambda}{4\pi d}\right).
$$

Here $P_{\text{Rx}}[\text{dBm}]$ and $P_{\text{Tx}}[\text{dBm}]$ are absolute powers in dBm, while $G_{\text{Tx}}[\text{dB}]$ and $G_{\text{Rx}}[\text{dB}]$ are gain ratios in dB. The last term is negative because $\lambda/(4\pi d)$ is usually much smaller than one.

The factor is $20\log_{10}$, not $10\log_{10}$, because the linear equation contains a squared amplitude-like ratio:

$$
\left(\frac{\lambda}{4\pi d}\right)^2.
$$

Taking $10\log_{10}$ of a square produces $20\log_{10}$ of the unsquared quantity.

The units dB, dBm, and dBW must be kept separate. A value in dB is a ratio. A value in dBm is an absolute power relative to $1\ \text{mW}$. A value in dBW is an absolute power relative to $1\ \text{W}$. The conversions are

$$
P[\text{dBW}]=10\log_{10}(P[\text{W}]),
$$

and

$$
P[\text{dBm}]=10\log_{10}\left(\frac{P[\text{W}]}{10^{-3}}\right)=10\log_{10}(P[\text{W}])+30.
$$

Therefore,

$$
1\ \text{W}=0\ \text{dBW}=30\ \text{dBm}.
$$

A 30 dB error appears immediately if dBW and dBm are confused. Another common mistake is using dB gains directly as linear multipliers. For example, $5\ \text{dB}$ is not a linear gain of $5$. Its linear value is

$$
G_{\text{linear}}=10^{5/10}\approx 3.16.
$$

So calculations must be internally consistent. Either use watts and linear gains throughout, or use dBm/dBW and dB gains throughout.

## The two-ray model and the $d^{-4}$ rule

Free-space propagation assumes that only one direct path matters. Terrestrial wireless channels often have a direct path and a reflected path. The most important simple example is ground reflection. A wave can travel directly from transmitter to receiver, while another part reflects from the ground and then reaches the same receiver.

![pasted 1782136112819](/communication-1/assets/pasted-1782136112819.png)

Let $h_{\text{Tx}}$ be the transmitter height, $h_{\text{Rx}}$ the receiver height, and $d$ the horizontal distance between transmitter and receiver. The direct path length is approximately

$$
d_{\text{direct}}=\sqrt{d^2+(h_{\text{Tx}}-h_{\text{Rx}})^2}.
$$

The reflected path can be represented using the mirror-image construction, giving

$$
d_{\text{refl}}=\sqrt{d^2+(h_{\text{Tx}}+h_{\text{Rx}})^2}.
$$

Here $d_{\text{direct}}$ and $d_{\text{refl}}$ are not usually equal. The reflected signal arrives with a different phase because it travelled a different distance. It may also experience a reflection phase change. The receiver sees the sum of electromagnetic fields, not the direct sum of powers.

For large $d$, the path-length difference is approximately

$$
d_{\text{refl}}-d_{\text{direct}}\approx\frac{2h_{\text{Tx}}h_{\text{Rx}}}{d}.
$$

This path-length difference creates a phase difference. If the two fields arrive nearly in phase, the received power is larger. If they arrive nearly out of phase, the received power is smaller. This is one physical explanation of fading.

The transition between the free-space region and the far-distance two-ray region is described by the break distance:

$$
d_{\text{break}}=\frac{4\pi h_{\text{Tx}}h_{\text{Rx}}}{\lambda}.
$$

Here $d_{\text{break}}$ is the break distance in meters, $h_{\text{Tx}}$ is the transmitter height in meters, $h_{\text{Rx}}$ is the receiver height in meters, and $\lambda$ is the wavelength in meters.

The practical use of $d_{\text{break}}$ is to choose the correct received-power formula. If

$$
d<d_{\text{break}},
$$

use the free-space equation:

$$
P_{\text{Rx}}(d)=P_{\text{Tx}}G_{\text{Tx}}G_{\text{Rx}}\left(\frac{\lambda}{4\pi d}\right)^2.
$$

If

$$
d>d_{\text{break}},
$$

use the far-distance two-ray approximation:

$$
P_{\text{Rx}}(d)\approx P_{\text{Tx}}G_{\text{Tx}}G_{\text{Rx}}\left(\frac{h_{\text{Tx}}h_{\text{Rx}}}{d^2}\right)^2.
$$

Here all powers are in watts if the formula is used linearly, all gains are linear ratios, and all distances and heights are in meters. This formula gives

$$
P_{\text{Rx}}\propto \frac{1}{d^4}.
$$

So after the break distance, doubling the distance reduces received power by a factor of $16$, or $12\ \text{dB}$.

The exam-relevant procedure is strict. First calculate $\lambda$. Then calculate $d_{\text{break}}$. Then compare the actual transmitter-receiver distance $d$ with $d_{\text{break}}$. Only then choose either Friis’ $d^{-2}$ formula or the two-ray $d^{-4}$ formula. Do not choose the formula based only on whether the problem “looks wireless” or whether a building exists.

A particularly common mistake is this: using the $d^{-4}$ formula just because the problem contains a ground reflection or an obstacle. That is not correct. The $d^{-4}$ equation is used only when the transmitter-receiver distance is beyond the break distance. An obstacle creates extra knife-edge loss, but it does not by itself decide whether the basic propagation is $d^{-2}$ or $d^{-4}$.

## Narrowband multipath: fields add, not powers

The two-ray model can be used in two different ways. For average received power at large distance, the course often uses the $d^{-4}$ formula. But for a narrowband continuous-wave signal, the phase of each path matters directly. In that case, the received field contributions must be added before calculating power.

![pasted 1782136145454](/communication-1/assets/pasted-1782136145454.png)

Let the direct path contribute a field $E_1$, and let the reflected path contribute a field $E_2$. If the reflected path travels an extra distance $\Delta l$, the phase difference is

$$
\Delta\phi=\frac{2\pi \Delta l}{\lambda}.
$$

Here $\Delta\phi$ is the phase difference in radians, $\Delta l$ is the path-length difference in meters, and $\lambda$ is the wavelength in meters. The total received field can be written as

$$
E_{\text{tot}}=E_1+E_2e^{-j\Delta\phi}.
$$

Here $j=\sqrt{-1}$, and $e^{-j\Delta\phi}$ represents a phase rotation of the reflected contribution. The received power is proportional to

$$
|E_{\text{tot}}|^2.
$$

This explains why received power can oscillate strongly as a car moves. A small change in position changes the path-length difference, which changes $\Delta\phi$, which changes whether the direct and reflected waves add or cancel. For narrowband continuous-wave questions, do not simply add direct-path power and reflected-path power unless the problem explicitly asks for an incoherent or average power calculation.

There is also an important difference between continuous-wave transmission and short-pulse transmission. A continuous wave can interfere with its delayed copy because the waveform is always present. A very short pulse may produce separated arrivals in time instead. If the reflected copy arrives outside the pulse duration, the receiver may observe two pulses rather than one phasor sum. This is why physical-channel questions sometimes distinguish narrowband CW power from short-pulse received power.

## Knife-edge diffraction

An obstacle between transmitter and receiver may block the direct line of sight. Examples include a building, hill, roof edge, or wall. Even when the straight line is blocked, electromagnetic waves can bend around the obstacle. This bending is called diffraction. Knife-edge diffraction models the obstacle as a sharp edge and estimates the additional attenuation caused by that edge.

![pasted 1782136163800](/communication-1/assets/pasted-1782136163800.png)

![pasted 1782136198230](/communication-1/assets/pasted-1782136198230.png)

Let $h_{\text{Tx}}$ be the transmitter height, $h_{\text{Rx}}$ the receiver height, and $h_{\text{obs}}$ the obstacle height. Let $d_1$ be the distance from transmitter to obstacle, and $d_2$ the distance from obstacle to receiver. The two geometric angles are

$$
\beta=\arctan\left(\frac{h_{\text{obs}}-h_{\text{Tx}}}{d_1}\right),
$$

and

$$
\gamma=\arctan\left(\frac{h_{\text{obs}}-h_{\text{Rx}}}{d_2}\right).
$$

Here $\beta$ and $\gamma$ must be evaluated with the correct signs. If the obstacle is lower than the transmitter, then $h_{\text{obs}}-h_{\text{Tx}}$ is negative and $\beta$ is negative. Do not replace $\beta$ or $\gamma$ by absolute values. The geometry determines the sign.

The total obstruction angle is

$$
\alpha=\beta+\gamma.
$$

Here $\alpha$ is in radians. Calculator mode matters. If the calculator gives degrees and the formula expects radians, the final knife-edge loss will be wrong.

The knife-edge parameter is

$$
v=\alpha\sqrt{\frac{2d_1d_2}{\lambda(d_1+d_2)}}.
$$

Here $v$ is dimensionless, $d_1$ and $d_2$ are in meters, $\lambda$ is the wavelength in meters, and $\alpha$ is in radians. A larger positive $v$ corresponds to stronger obstruction. A negative $v$ can occur when the obstacle lies below the direct path; in that case the additional loss can be small.

The additional knife-edge loss is

$$
A(v)=6.9+20\log_{10}\left(\sqrt{(v-0.1)^2+1}+v-0.1\right)\quad \text{dB}.
$$

Here $A(v)$ is a loss in dB. It is not a received power. It is an extra attenuation caused by the obstacle.

Some versions of the formula are written in the closely related form

$$
A(v)=6.9+20\log_{10}\left(\sqrt{v^2+1}+v-0.1\right)\quad \text{dB}.
$$

For course calculations, use the formula given on the formula sheet or in the question. The important interpretation is the same: $A(v)$ is an additional dB loss that must be subtracted from the received power in dBm or dBW.

If the propagation calculation without the obstacle gives

$$
P_{\text{Rx,prop}}[\text{dBm}],
$$

then the final power including knife-edge loss is

$$
P_{\text{Rx,total}}[\text{dBm}]=P_{\text{Rx,prop}}[\text{dBm}]-A(v).
$$

If using watts, the same operation is

$$
P_{\text{Rx,total}}[\text{W}]=P_{\text{Rx,prop}}[\text{W}]\cdot10^{-A(v)/10}.
$$

Here $10^{-A(v)/10}$ is the linear attenuation factor corresponding to the dB loss $A(v)$.

The calculation order is extremely important. First ignore the knife edge and decide whether the normal propagation is free-space $d^{-2}$ or two-ray $d^{-4}$. That means computing $d_{\text{break}}$ using the transmitter and receiver heights and the total transmitter-receiver distance. Then calculate the propagation received power. Only after that should the knife-edge loss be applied as an extra attenuation.

A special case helps interpret the formula. If the direct line of sight just touches the obstacle, then the obstruction parameter is approximately

$$
v=0.
$$

For $v=0$, the knife-edge loss is approximately

$$
A(0)\approx 6\ \text{dB}.
$$

This means that a just-grazing obstacle is not lossless. Even when the obstacle only touches the line of sight, the model predicts about $6\ \text{dB}$ of extra attenuation.

![pasted 1782136216408](/communication-1/assets/pasted-1782136216408.png)

## Worked propagation and knife-edge procedure

Suppose a transmitter sends $P_{\text{Tx}}=1\ \text{W}$ to a receiver. The transmitter and receiver antenna gains are both $1$, meaning $0\ \text{dB}$. The transmitter height is $h_{\text{Tx}}=50\ \text{m}$, the receiver height is $h_{\text{Rx}}=1\ \text{m}$, the obstacle height is $h_{\text{obs}}=70\ \text{m}$, the distance from transmitter to obstacle is $d_1=2000\ \text{m}$, the distance from obstacle to receiver is $d_2=200\ \text{m}$, and the carrier frequency is $f=1\ \text{GHz}$.

First calculate the wavelength:

$$
\lambda=\frac{c}{f}=\frac{3.0\times10^8}{1.0\times10^9}=0.3\ \text{m}.
$$

The total transmitter-receiver distance is

$$
d=d_1+d_2=2200\ \text{m}.
$$

Now calculate the break distance:

$$
d_{\text{break}}=\frac{4\pi h_{\text{Tx}}h_{\text{Rx}}}{\lambda}=\frac{4\pi(50)(1)}{0.3}\approx2094\ \text{m}.
$$

Since

$$
d=2200\ \text{m}>d_{\text{break}}\approx2094\ \text{m},
$$

the two-ray far-distance formula is used:

$$
P_{\text{Rx,prop}}=P_{\text{Tx}}G_{\text{Tx}}G_{\text{Rx}}\left(\frac{h_{\text{Tx}}h_{\text{Rx}}}{d^2}\right)^2.
$$

Substituting the values gives

$$
P_{\text{Rx,prop}}=1\cdot1\cdot1\left(\frac{50\cdot1}{2200^2}\right)^2\approx1.07\times10^{-10}\ \text{W}.
$$

In dBW,

$$
P_{\text{Rx,prop}}[\text{dBW}]=10\log_{10}(1.07\times10^{-10})\approx-99.7\ \text{dBW}.
$$

In dBm,

$$
P_{\text{Rx,prop}}[\text{dBm}]=-99.7+30=-69.7\ \text{dBm}.
$$

Now calculate the knife-edge angles:

$$
\beta=\arctan\left(\frac{70-50}{2000}\right),
$$

$$
\gamma=\arctan\left(\frac{70-1}{200}\right).
$$

Thus

$$
\alpha=\beta+\gamma.
$$

After computing $v$ using

$$
v=\alpha\sqrt{\frac{2d_1d_2}{\lambda(d_1+d_2)}},
$$

the corresponding $A(v)$ is found from the knife-edge formula or graph. If, for example, this gives

$$
A(v)=34.4\ \text{dB},
$$

then the final received power is

$$
P_{\text{Rx,total}}[\text{dBm}]=-69.7-34.4=-104.1\ \text{dBm}.
$$

This example shows the structure of almost every exam-style physical-channel power calculation: compute wavelength, compute $d_{\text{break}}$, choose the correct propagation model, calculate received power without the obstacle, calculate knife-edge loss, and subtract the loss in dB.

## Received power and SNR

Received power alone is not the final communication-performance quantity. The receiver must compare signal power with noise power. The signal-to-noise ratio at the receiver input is

$$
\text{SNR}_{\text{in}}=\frac{P_{\text{signal}}}{P_{\text{noise}}}.
$$

Here $P_{\text{signal}}$ is usually the received signal power $P_{\text{Rx}}$, and $P_{\text{noise}}$ is the noise power in the receiver bandwidth. In dB,

$$
\text{SNR}_{\text{in}}[\text{dB}]=P_{\text{signal}}[\text{dBm}]-P_{\text{noise}}[\text{dBm}].
$$

The units cancel because SNR is a ratio. If signal power and noise power are both expressed in dBm, subtracting them gives dB.

If a noise spectral density is given per hertz or per kilohertz, the total noise power is found by multiplying by the receiver bandwidth in linear units. If the receiver has a rectangular frequency response from $-B$ to $+B$, the total bandwidth is

$$
2B.
$$

This factor of two is a frequent source of mistakes. If the analog signal bandwidth is described as $B$ and the receiver passes from $-B$ to $+B$, the noise is collected over $2B$, not $B$.

## Channel sounding and RMS delay spread

Wireless channels can be measured by sending a short pulse and observing the received copies. This is called channel sounding. If there is only one path, the receiver observes one pulse. If there are reflections, the receiver may observe delayed echoes. The delays reveal the geometry of the multipath channel.

[Figure: A short transmitted pulse arriving as one direct pulse and one delayed reflected pulse. Label path powers $P_0$, $P_1$, delays $\tau_0$, $\tau_1$, and delay difference $\Delta\tau$.]

The delay of a path is

$$
\tau_i=\frac{d_i}{c}.
$$

Here $\tau_i$ is the delay of path $i$, $d_i$ is the path length in meters, and $c$ is the propagation speed. If a reflected path requires the wave to travel to a building and back, the extra path length is a round trip. Forgetting this factor of two gives a delay that is half the correct value.

If several components arrive with powers $P_i$ and delays $\tau_i$, the mean delay is

$$
\bar{\tau}=\frac{\sum_i P_i\tau_i}{\sum_i P_i}.
$$

Here $\bar{\tau}$ is the power-weighted average arrival time. The RMS delay spread is

$$
\tau_{\text{rms}}=\sqrt{\frac{\sum_i P_i(\tau_i-\bar{\tau})^2}{\sum_i P_i}}.
$$

Here $\tau_{\text{rms}}$ measures how spread out the received energy is in time. If there is only one path, then all energy arrives at one delay and

$$
\tau_{\text{rms}}=0.
$$

If there is a delayed reflection, $\tau_{\text{rms}}$ becomes nonzero.

RMS delay spread matters because symbols have finite duration. If delayed copies from one symbol arrive during the next symbol, the channel can create inter-symbol interference. A simple design rule is to keep the RMS delay spread much smaller than the symbol time. If the allowed delay spread is at most 10% of the symbol time, then

$$
\tau_{\text{rms}}\le 0.1T_s.
$$

Here $T_s$ is the symbol time. This gives

$$
T_s\ge 10\tau_{\text{rms}},
$$

and therefore

$$
D_{\max}=\frac{1}{T_s}\le\frac{1}{10\tau_{\text{rms}}}.
$$

Here $D_{\max}$ is the maximum symbol rate in symbols per second under that rule. This is not a replacement for Nyquist pulse shaping. It is a physical-channel timing limit caused by multipath.

## Practical SDR interpretation

In an SDR experiment, the transmitter and receiver are real radio devices. The transmitted file is converted into a radio signal, sent over the air, and received by another SDR. The receiver does not simply obtain the original waveform. The received signal depends on transmitter power, receiver gain, distance, channel attenuation, reflections, and noise.

Increasing transmitter power may improve the received signal, but only up to the point where the system saturates or clips. Increasing receiver gain may help weak signals, but too much gain can also distort the received waveform. Moving from a near transmitter to a far transmitter changes the received power and spectrum. These observations are practical versions of the propagation equations: physical distance, gain, and channel conditions determine the signal that actually arrives.

The SDR setting also clarifies why received power is not the only issue. A signal can be strong but distorted, or weak but still decodable if the receiver and modulation are robust. Physical-layer design therefore always combines link budget, bandwidth, noise, distortion, and receiver behavior.

## Bridge: optical fiber as the wired physical channel

The wireless part of the chapter focuses on RF propagation. The corresponding wired example is optical fiber. Optical fiber is a guided channel for light. Instead of sending an RF wave freely through space, the transmitter sends optical power into a glass fiber, and the fiber guides the light toward the receiver.

![pasted 1782136250867](/communication-1/assets/pasted-1782136250867.png)

An optical fiber has a core and cladding. The core is the central region through which light mainly travels. The cladding surrounds the core and has a different refractive index. Because of this refractive-index difference, light can be guided along the fiber instead of escaping immediately. The physical mechanism is commonly described as total internal reflection in ray terms, although a full wave description is needed for exact fiber modes.

The optical carrier frequency is extremely high because optical wavelengths are very short. The same wavelength relation applies:

$$
c=f\lambda.
$$

Here $c$ is the speed of light, $f$ is optical frequency, and $\lambda$ is optical wavelength. If $\lambda$ is around $1.55\ \mu\text{m}$, then the corresponding frequency is on the order of hundreds of terahertz. In practice, optical communication usually describes carriers by wavelength rather than frequency.

Fiber loss is usually given as attenuation in dB per kilometer. If the attenuation coefficient is $a\ \text{dB/km}$ and the fiber length is $L\ \text{km}$, then the total loss is

$$
A_{\text{fiber}}=aL\ \text{dB}.
$$

Here $A_{\text{fiber}}$ is the total fiber attenuation in dB. If the transmitted optical power is $P_{\text{Tx}}[\text{dBm}]$, the received optical power after fiber attenuation is

$$
P_{\text{Rx}}[\text{dBm}]=P_{\text{Tx}}[\text{dBm}]-A_{\text{fiber}}.
$$

For example, if $a=0.2\ \text{dB/km}$ and $L=50\ \text{km}$, then

$$
A_{\text{fiber}}=0.2\cdot50=10\ \text{dB}.
$$

If $P_{\text{Tx}}=0\ \text{dBm}$, then

$$
P_{\text{Rx}}=-10\ \text{dBm}.
$$

The key distinction from wireless propagation is that this loss is not a spherical spreading loss. The fiber guides the light, so the signal does not spread over a sphere of area $4\pi d^2$. Instead, power decreases mainly due to absorption, scattering, bending loss, coupling loss, and other fiber/device imperfections.

Optical fibers are commonly classified as multimode or single-mode. A multimode fiber allows several propagation paths or modes. These modes travel different effective distances and arrive at different times. This causes modal dispersion: a short optical pulse broadens as it travels. If pulses broaden too much, neighboring pulses overlap, producing inter-symbol interference.

A single-mode fiber supports essentially one propagation mode. Because there are not multiple spatial modes arriving at different times, modal dispersion is much smaller. This allows much higher bit rates and longer links than multimode fiber, although other dispersion mechanisms can still exist.

A simple model for mode dispersion is based on pulse broadening. If the difference between the earliest and latest significant arrivals after a fiber length $L$ is $\Delta T$, then the symbol time must be larger than this broadening to avoid severe overlap. A rough maximum symbol rate is therefore

$$
D_{\max}\approx \frac{1}{\Delta T}.
$$

Here $D_{\max}$ is the maximum symbol rate and $\Delta T$ is the pulse spreading time. If a more conservative rule is used, the allowed symbol rate is lower. The physical meaning is the same as in wireless delay spread: the channel spreads pulses in time, and symbol duration must be long enough that pulses remain distinguishable.

The fiber bridge completes the physical-channel picture. Wireless channels lose power through spreading, fading, obstruction, and interference. Optical fiber channels lose power through guided-medium attenuation and suffer from dispersion if different components of the signal arrive at different times. Both are physical channels, but the correct model depends entirely on the medium.

## Synthesis

The physical channel determines what the receiver actually gets. In RF wireless propagation, wavelength comes from $\lambda=c/f$, free-space received power follows Friis’ $d^{-2}$ law, and terrestrial two-ray propagation can change the far-distance behavior to $d^{-4}$ beyond

$$
d_{\text{break}}=\frac{4\pi h_{\text{Tx}}h_{\text{Rx}}}{\lambda}.
$$

When an obstacle blocks the line of sight, knife-edge diffraction adds an extra loss $A(v)$, which must be subtracted after the ordinary propagation power has been calculated. In multipath, delayed copies can either interfere as fields for narrowband continuous waves or appear as delayed pulses in channel sounding. The resulting delay spread limits how fast symbols can be transmitted without severe overlap. In optical fiber, the signal is guided rather than radiated freely, so the main calculations involve attenuation in dB/km and pulse broadening due to dispersion. The common lesson is that the waveform designed by the transmitter is only the beginning; the physical channel decides the power, timing, and distortion conditions under which the receiver must recover the information.
