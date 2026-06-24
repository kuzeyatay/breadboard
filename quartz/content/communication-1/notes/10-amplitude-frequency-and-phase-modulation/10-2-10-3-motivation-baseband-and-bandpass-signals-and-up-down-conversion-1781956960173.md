---
title: "10.2–10.3 Motivation, Baseband and Bandpass Signals, and Up/Down Conversion"
date: "2026-06-20T12:02:40.173Z"
source: "user-note"
knowledge_type: "user-note"
---

# 10.2–10.3 Motivation, Baseband and Bandpass Signals, and Up/Down Conversion

![pasted 1781957115028](/communication-1/assets/pasted-1781957115028.png)

Up to this point, we have mostly treated communication as if the signal can be transmitted in the same frequency range where it is sampled, quantized, encoded, or line-coded. That was the right simplification for the earlier chapters, because it allowed us to understand spectra, sampling, quantization, bit rate, symbol rate, bandwidth, line codes, noise, and bit-error probability without yet worrying about how a real transmitter places the signal into a physical communication channel.

The next problem is frequency placement. A message signal may be mathematically correct and may have an acceptable bandwidth, but it still has to be placed somewhere in the frequency spectrum where it can be transmitted without overlapping uncontrollably with other users. If many transmitters all used the same low-frequency range, their signals would occupy the same part of the spectrum. A receiver would then see a mixture of several messages, and it would not be able to separate the desired one from the others. Modulation is introduced to solve this immediate problem: it moves information from its original frequency range to a chosen carrier-frequency region.

A **baseband signal** is a signal whose spectrum is centered around $0\ \text{Hz}$. The word “baseband” means that the signal is still in its original low-frequency range. For example, an audio waveform, a sampled analog waveform before radio-frequency transmission, or a digital line-coded signal before carrier modulation can be treated as a baseband signal.

If the message signal is denoted by

$$
m(t),
$$

then $m(t)$ is the message waveform as a function of time $t$, where $t$ is measured in seconds. Its Fourier transform is denoted by

$$
M(f),
$$

where $M(f)$ is the frequency-domain representation of $m(t)$, and $f$ is frequency in hertz. Saying that $m(t)$ is a baseband signal means that the important part of $M(f)$ lies around $f=0$.

![pasted 1781957192216](/communication-1/assets/pasted-1781957192216.png)

If the highest relevant frequency in the message is $B$, then $B$ is called the **baseband bandwidth**. The idealized two-sided baseband spectrum then occupies approximately

$$
-B \leq f \leq B.
$$

Here $f$ is frequency in hertz, and $B$ is the one-sided baseband bandwidth in hertz. The spectrum is drawn on both sides of zero because real-valued time signals have two-sided Fourier spectra. The negative-frequency side is not a separate physical signal travelling “backwards”; it is part of the mathematical representation of a real waveform.

Baseband transmission is not automatically bad. It can be reasonable when the channel is dedicated or shielded from other users. A direct wire connection between two circuits is one example. Optical fiber communication is another important example: the signal is confined inside the fiber, so it does not radiate into a shared open-air electromagnetic spectrum. In such a shielded or dedicated channel, we are less concerned about disturbing other users by occupying frequencies near $0\ \text{Hz}$.

Open-air wireless transmission is different. In free space, many users share the same physical environment. If all of them transmitted baseband signals, they would all occupy the same frequency region and interfere with each other. To avoid this, different users and services are assigned different frequency bands. A transmitter therefore moves the message away from baseband and places it around a designated carrier frequency.

![pasted 1781957218387](/communication-1/assets/pasted-1781957218387.png)

A **bandpass signal** is a signal whose spectrum is centered around a nonzero carrier frequency. The carrier frequency is denoted by

$$
f_c,
$$

where $f_c$ is the carrier frequency in hertz. The corresponding angular carrier frequency is

$$
\omega_c = 2\pi f_c,
$$

where $\omega_c$ is measured in radians per second. A bandpass signal has its positive-frequency content around $+f_c$, and because real signals have two-sided spectra, it has a corresponding negative-frequency part around $-f_c$.

![pasted 1781957238133](/communication-1/assets/pasted-1781957238133.png)

The operation that moves a baseband signal to a band around a carrier frequency is called **upconversion**. The word “up” means that the signal is shifted upward in frequency. If the original message spectrum was centered around $0\ \text{Hz}$, then after upconversion it is centered around $f_c$. This does not mean that the information itself has changed. The same message is now simply located in a different part of the spectrum.

The simplest mathematical model of upconversion is multiplication by a cosine carrier:

$$
s(t)=m(t)\cos(2\pi f_c t).
$$

Here $s(t)$ is the transmitted bandpass signal, $m(t)$ is the original baseband message signal, $t$ is time in seconds, and $f_c$ is the carrier frequency in hertz. The cosine term $\cos(2\pi f_c t)$ is the carrier waveform. It is not the information; it is the high-frequency waveform used to move the information to the desired frequency region.

The reason multiplication shifts frequencies comes from the trigonometric identity

$$
\cos(\alpha)\cos(\beta)
=
\frac{1}{2}\cos(\alpha+\beta)
+
\frac{1}{2}\cos(\alpha-\beta).
$$

Here $\alpha$ and $\beta$ are phase arguments in radians. The important meaning of this identity is that multiplying two cosines produces two new frequency components: one at the sum of the original frequencies and one at the difference of the original frequencies. This is the basic mathematical mechanism behind a mixer.

For a single-tone message,

$$
m(t)=A_m\cos(2\pi f_m t),
$$

where $A_m$ is the message amplitude and $f_m$ is the message frequency in hertz. If this message is multiplied by a carrier, then

$$
s(t)=A_m\cos(2\pi f_m t)\cos(2\pi f_c t).
$$

Using the identity gives

$$
s(t)
=
\frac{A_m}{2}\cos\left(2\pi(f_c+f_m)t\right)
+
\frac{A_m}{2}\cos\left(2\pi(f_c-f_m)t\right).
$$

Here $f_c+f_m$ is the upper shifted frequency component, and $f_c-f_m$ is the lower shifted frequency component. These are the two side frequencies created around the carrier. For a general message signal, the same idea applies to every frequency component in the message: the baseband spectrum is copied and shifted to a band around the carrier.

A common mistake is to confuse the message frequency with the carrier frequency. The message frequency $f_m$ describes how fast the information waveform changes. The carrier frequency $f_c$ describes where the information is placed in the transmission spectrum. For example, an audio tone may have a frequency of $1\ \text{kHz}$, while the carrier may be $100\ \text{kHz}$, $1\ \text{MHz}$, or much higher. The message frequency determines the spacing of the side components around the carrier; the carrier frequency determines the center of the transmitted band.

![pasted 1781957260681](/communication-1/assets/pasted-1781957260681.png)

The circuit block used for frequency shifting is a **mixer**. In the ideal model used here, a mixer multiplies two signals. One input is the signal we want to shift. The other input comes from a **local oscillator**, abbreviated **LO**. A local oscillator is a circuit that generates a sinusoidal waveform at a chosen frequency.

If the local oscillator is written as

$$
v_{\text{LO}}(t)=A_0\cos(\omega_0 t),
$$

then $v_{\text{LO}}(t)$ is the local oscillator voltage, $A_0$ is its amplitude, $\omega_0$ is its angular frequency in radians per second, and $t$ is time. The corresponding oscillator frequency is

$$
f_0=\frac{\omega_0}{2\pi},
$$

where $f_0$ is measured in hertz.

The mixer output contains shifted spectral components. Because multiplication creates both sum and difference frequencies, the mixer output usually contains more than one frequency band. A **filter** is therefore needed after the mixer. A filter is a circuit or signal-processing operation that keeps a desired frequency range and suppresses unwanted frequency ranges. In upconversion, the filter selects the frequency band that should be transmitted. In downconversion, the filter selects the frequency band that contains the recovered lower-frequency version of the signal.

The reverse operation is **downconversion**. Downconversion shifts a received bandpass signal back toward baseband so that the receiver can process the message. This is necessary because the final information usually has to be recovered as a low-frequency waveform, audio signal, digital baseband signal, or sampled signal. Receivers therefore do not usually keep the desired signal at the original carrier frequency all the way to the final output. They translate it down first.

Suppose the received signal is

$$
r(t)=m(t)\cos(2\pi f_c t).
$$

Here $r(t)$ is the received bandpass signal, $m(t)$ is the message, and $f_c$ is the carrier frequency. If the receiver multiplies this signal by a local oscillator at the same carrier frequency, then

$$
r(t)\cos(2\pi f_c t)
=
m(t)\cos^2(2\pi f_c t).
$$

Using

$$
\cos^2(x)=\frac{1}{2}+\frac{1}{2}\cos(2x),
$$

we obtain

$$
r(t)\cos(2\pi f_c t)
=
\frac{1}{2}m(t)
+
\frac{1}{2}m(t)\cos(4\pi f_c t).
$$

The first term,

$$
\frac{1}{2}m(t),
$$

is the desired message shifted back to baseband, except for a scaling factor of $\frac{1}{2}$. The second term,

$$
\frac{1}{2}m(t)\cos(4\pi f_c t),
$$

is a high-frequency term centered around $2f_c$. A low-pass filter removes the high-frequency term and keeps the baseband message. The scaling factor can be corrected by amplification, so the important result is not the factor $\frac{1}{2}$, but the fact that multiplication by the correct oscillator frequency brings the desired signal back to baseband.

This explains why receiver tuning works. Imagine three channels centered around $5.00\ \text{MHz}$, $5.05\ \text{MHz}$, and $5.10\ \text{MHz}$. If the receiver chooses a local oscillator at $5.05\ \text{MHz}$, then the channel at $5.05\ \text{MHz}$ is shifted to baseband. The other two channels are shifted to nonzero offset frequencies. A low-pass filter can then keep the desired channel and reject the others. The local oscillator frequency therefore determines which channel is selected.

This point is important because “removing a carrier” and “selecting a channel” are not the same thing. A product detector uses multiplication by a chosen oscillator and then filtering. Because the oscillator frequency is chosen deliberately, the receiver can decide which passband channel is moved to baseband. By contrast, a simple envelope detector does not perform the same selective frequency translation. If several AM channels are fed directly into an envelope detector without first selecting one channel, the carrier structure of all of them is removed and their messages collapse into the same baseband region. The output becomes a mixture of messages rather than one clean recovered channel. This detector discussion belongs mainly to the later AM detector section, but the distinction already explains why downconversion and filtering are needed before reliable detection.

An important exam warning is the special case

$$
f_c=0.
$$

If the carrier frequency is zero, then

$$
\cos(2\pi f_c t)=\cos(0)=1.
$$

The transmitted signal becomes

$$
s(t)=m(t)\cdot 1=m(t).
$$

So a zero-frequency “carrier” does not shift the signal at all. The output remains at baseband. In a spectrum drawing, the components that would normally appear around $\pm f_c$ collapse back toward $0\ \text{Hz}$. Therefore, if a carrier oscillator accidentally outputs a DC signal instead of a sinusoidal carrier, the modulation no longer places the signal in the intended passband. It is not proper upconversion.

The words **modulation**, **upconversion**, and **bandpass transmission** are related, but they should not be treated as identical. **Modulation** is the broader idea of putting information onto a carrier by changing some property of that carrier. **Upconversion** is the frequency-shifting operation that moves a signal from baseband to a higher frequency region. **Bandpass transmission** describes the result: the transmitted signal occupies a band around a nonzero carrier frequency.

The general form of a bandpass signal can be written as

$$
s(t)=R(t)\cos\left(\omega_c t+\theta(t)\right).
$$

Here $s(t)$ is the bandpass signal, $R(t)$ is the time-varying amplitude or envelope, $\omega_c$ is the angular carrier frequency, $t$ is time, and $\theta(t)$ is the time-varying phase. This formula shows why amplitude, frequency, and phase modulation naturally come next. If the message changes $R(t)$, the result is amplitude modulation. If the message changes $\theta(t)$, the result is phase modulation. If the message changes the rate at which the phase evolves, the result is frequency modulation. The present section does not yet need the detailed formulas for AM, FM, and PM; it establishes the common foundation: information is placed onto a carrier and moved into a passband.

The complete picture is now as follows. A message begins as a baseband signal, with its spectrum centered around $0\ \text{Hz}$. For shared wireless transmission, this is usually not suitable because many users would interfere in the same frequency range. A transmitter therefore uses a carrier, a mixer or modulation circuit, and filtering to place the message around a chosen carrier frequency. The receiver then uses filtering, a local oscillator, and downconversion to bring the desired channel back to baseband. The key distinction is: baseband describes the original low-frequency location of the information, bandpass describes the transmitted frequency location, $f_c$ tells us where the signal is placed, and the local oscillator determines how the signal is shifted and selected.
