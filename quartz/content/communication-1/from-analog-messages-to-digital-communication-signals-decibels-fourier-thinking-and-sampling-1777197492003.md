---
title: "Week 1 Lecture Notes: From Analog Messages to Digital Communication: Signals, Decibels, Fourier Thinking, and Sampling"
date: "2026-04-26T10:14:08.167Z"
source: "generated-chat"
knowledge_type: "generated-note"
generated_note_type: "chat-node"
generated_by: "chatmock"
related: ["from-analog-messages-to-digital-communication-signals-decibels-fourier-thinking-and-sampling-1777192325731", "digital-communication-chain-1777190840499", "digital-communication-chain-1777191198352", "communication-system-block-flow", "time-decoupling-in-digital-communication", "mini-lab-5-2-communication-chain-and-robustness-comparison"]
tags: ["digital-communication", "analog-signals", "sampling", "quantization", "fourier-analysis", "decibels", "signal-to-noise-ratio", "modulation", "week-1"]
flag_color: "#f97316"
---

# From Analog Messages to Digital Communication: Signals, Decibels, Fourier Thinking, and Sampling

The central problem in communication is deceptively simple: a message exists somewhere, and we want that message to appear somewhere else. A person speaks into a microphone, and another person hears the sound from a loudspeaker. A sensor measures a temperature, and a computer receives a number. A phone captures an image, and another device reconstructs it. In each case, something physical and continuous must be represented, transported, protected against imperfections, and then recovered.

The difficulty is that the world does not naturally hand us clean binary data. Sound pressure, voltage, light intensity, and electromagnetic fields vary continuously in time. They are analog signals: at every instant, the signal may have some value, and those values are not automatically restricted to a finite set. Digital communication begins when we decide to represent such analog information using numbers, bits, symbols, and waveforms that can be transmitted through a real channel.

The full communication chain is therefore not one idea but a sequence of transformations. We sample a signal in time. We quantize the sample values. We represent those values in binary. We may add coding for protection. We choose a signaling or modulation method to place the information onto a physical waveform. The waveform travels through a channel such as air, copper, coaxial cable, or optical fiber. Along the way it may be weakened, distorted, delayed, or corrupted by noise. The receiver must detect what was sent, decode it, correct or at least detect errors where possible, and finally reconstruct a waveform or message that resembles the original.

This course of ideas is best understood as a story about what can go wrong and what engineering does in response. Sampling is introduced because we need a finite sequence of values instead of a continuous waveform. Quantization is introduced because computers cannot store infinitely precise amplitudes. Coding is introduced because channels make mistakes. Modulation or signaling is introduced because the physical medium does not necessarily carry arbitrary digital numbers directly; it carries voltages, fields, optical power, or other waveforms. Fourier analysis is introduced because every waveform has both a time-domain behavior and a frequency-domain footprint, and channels care deeply about frequency. Decibels are introduced because communication engineers constantly compare powers, gains, attenuations, and signal-to-noise ratios over enormous ranges, and ordinary linear arithmetic quickly becomes awkward.

Before the mathematics begins, it is worth emphasizing how this subject should be learned. Communication systems are cumulative. A small misunderstanding early on, such as confusing $\mathrm{dB}$ with $\mathrm{dBm}$ or thinking that sampling simply means “taking some points,” will reappear later in line coding, noise analysis, channel bandwidth, modulation, and reconstruction. That is why retrieval practice matters: short quizzes, recap questions, and repeated calculations are not administrative decoration but part of the learning mechanism. A midterm or practice quiz is not only a grade moment; it is a diagnostic moment. It tells you how the instructors ask questions, whether you truly understand the material, and where your reasoning breaks. Past exams can be useful, but only if they are used to test understanding rather than to memorize patterns. The goal is not to recognize an old question. The goal is to understand the system well enough that a new question is still approachable.

The same applies to learning resources. Lectures, a reader, recordings, podcasts, mini-labs, quizzes, old exams, and discussion channels are all useful, but they should not be treated as an obligation to consume everything. A student can drown in resources just as easily as be helped by them. The right question is: what do I need now? If you attended the lecture and made your own notes, replaying old versions of the same lecture may not be necessary. If a concept is still abstract, a MATLAB mini-lab can make it visible. If a calculation is uncertain, a quiz can expose the weak step. If a question feels too small or too embarrassing to ask, it is probably a question that other students also have. Asking publicly helps the whole room; asking anonymously through a shared channel can also turn private confusion into collective learning. Communication engineering itself is about making hidden information recoverable. Learning the subject works similarly: uncertainty must be transmitted outward before it can be corrected.

## The Communication Chain and the Need for Representation

Begin with an analog message, for example a voice signal from a microphone. The microphone produces a voltage that varies in time according to air pressure. If we want to transmit this signal digitally, the first conceptual step is sampling: choosing values of the signal at discrete instants in time. Instead of keeping the entire continuous waveform, we keep values such as “the signal at this time, then the signal a little later, then the next one,” and so on.

Sampling does not yet make the signal fully digital, because each sample may still have a continuously variable amplitude. A sample value may be an arbitrary real number. Quantization then maps those amplitudes onto a finite set of allowed levels. If a sample is close to a certain level, we represent it by that level. Once the possible levels are finite, each level can be assigned a binary word. For example, a sample may be represented by bits such as $1011$. This is the stage where a continuously varying physical quantity becomes a sequence of bits.

Bits, however, are not magical. They must still be sent through something physical. A wire does not carry an abstract $1$ or $0$; it carries voltage or current. A radio link carries electromagnetic waves. An optical fiber carries light. Therefore the bit sequence must be converted into a transmitted signal. In a simple binary signaling system, one voltage level may represent a $1$ and another may represent a $0$. In a more complex system, each transmitted symbol may represent multiple bits. Later, modulation may shift the signal to a carrier frequency so that it occupies the desired frequency band and can propagate efficiently through the chosen channel.

Once the message is expressed as bits, the system can process it using digital methods. It may compress the representation, add error-detecting or error-correcting codes, group bits into symbols, and choose physical waveforms to carry those symbols through a channel. At the receiver, the process is reversed as much as possible: the incoming waveform is measured, symbols are detected, bits are recovered, codes are decoded, errors may be detected or corrected, the sequence of digital values is turned back into sample amplitudes, and a reconstruction process creates a continuous-time waveform again, such as the voltage that drives a loudspeaker.

This chain matters because every stage introduces a tradeoff. Sampling too slowly loses time variation. Quantizing too coarsely introduces visible or audible distortion. Coding improves reliability but adds redundancy. Modulation allows transmission through a physical channel but must respect bandwidth, power, and noise limits. The goal is not merely to “send data,” but to choose representations that survive the channel well enough for the receiver to recover the intended information.

A key advantage of this digital structure is robustness. In analog transmission, noise directly disturbs the waveform, and the receiver often has no clean way to distinguish intended signal variation from unwanted disturbance. In digital transmission, the receiver usually only needs to decide which symbol or bit was most likely sent. If the noise is not too large, a slightly disturbed waveform still falls on the correct side of a decision threshold, and the recovered bit is exactly right.

Digital systems can also decouple time. Once information is stored as samples and bits, it can be buffered, processed, delayed, interleaved, or multiplexed. Multiple signals can share a channel by taking turns in time, a principle behind time-division multiplexing. This does not make bandwidth or noise disappear, but it gives engineers more control over how information is organized and protected.

## Signals, Channels, and Noise

A signal is a physical quantity used to carry information. It might be a voltage on a wire, an electromagnetic field in the air, light intensity in an optical fiber, or acoustic pressure in a room. A channel is the physical path that carries the signal from transmitter to receiver. Real channels are imperfect. They may attenuate the signal, distort some frequencies more than others, delay different components by different amounts, or add unwanted disturbances.

Noise is especially important because it limits how reliably a receiver can distinguish what was sent. Even if the transmitter sends perfectly chosen waveforms, the receiver observes the transmitted signal mixed with uncertainty. Communication engineering is therefore not just about producing signals; it is about producing signals that remain distinguishable after passing through a noisy and imperfect channel.

The channel is where reality enters. A channel can attenuate the signal, meaning it reduces its power. It can add noise, meaning random unwanted fluctuations. It can distort the waveform, meaning different frequency components may be affected differently. It can cause bit errors, where a transmitted bit is detected incorrectly. Suppose the word $1011$ is transmitted, but the second bit flips and the receiver obtains $1111$. If the receiver reconstructs a waveform from that wrong word, the reconstructed sample value may be too high. One wrong bit can become one wrong amplitude value, and enough such errors can damage the recovered message.

This is why signal-to-noise ratio is such a central idea. A strong signal in weak noise is easier to detect. A weak signal in strong noise is more likely to be mistaken for something else. Many later topics, including coding, modulation, filtering, and bandwidth limits, can be understood as attempts to manage the relationship between useful signal energy and unwanted disturbance.

## Decibels, Power Ratios, and Reference Levels

Communication systems often involve quantities that vary over enormous ranges. A transmitter may send watts of power, while a receiver may detect microwatts, nanowatts, or less. A cable may reduce power by a large factor, while an amplifier may increase it by another large factor. Working directly with these ratios can become awkward, so engineers commonly use decibels.

A decibel, written $\mathrm{dB}$, is a logarithmic way to express a ratio. For power quantities,

$$
G_{\mathrm{dB}} = 10 \log_{10}\left(\frac{P_{\text{out}}}{P_{\text{in}}}\right),
$$

where $P_{\text{in}}$ is the input power, $P_{\text{out}}$ is the output power, and $G_{\mathrm{dB}}$ is the gain or loss expressed in decibels. The ratio $\frac{P_{\text{out}}}{P_{\text{in}}}$ has no unit. It is simply “how many times larger” the output power is than the input power. Plain $\mathrm{dB}$ therefore expresses a relative factor, not an absolute physical power.

A positive value means gain, a negative value means attenuation, and zero decibels means no change in power. If two powers are equal, the ratio is $1$, and

$$
10\log_{10}(1)=0\,\mathrm{dB}.
$$

A value of $0\,\mathrm{dB}$ does not mean zero power. It means no change relative to the reference quantity. Similarly, a negative decibel value does not mean impossible or negative physical power. It means the ratio is less than $1$. For example, $-10\,\mathrm{dB}$ corresponds to one tenth of the reference power.

Because decibels are logarithmic, cascaded gains and losses add instead of multiply. This makes system calculations much easier: an amplifier with $20\,\mathrm{dB}$ of gain followed by a cable with $3\,\mathrm{dB}$ of loss gives a net change of $17\,\mathrm{dB}$.

Some common values are worth knowing. If an amplifier has a gain of $10\,\mathrm{dB}$, then

$$
10 = 10\log_{10}\left(\frac{P_{\text{out}}}{P_{\text{in}}}\right),
$$

so

$$
\frac{P_{\text{out}}}{P_{\text{in}}}=10.
$$

Thus $10\,\mathrm{dB}$ of power gain means ten times the power, not one hundred times. If the output power is double the input power, then

$$
10\log_{10}(2)\approx 3\,\mathrm{dB}.
$$

This is why engineers often say that a doubling of power is approximately a $3\,\mathrm{dB}$ increase.

Voltage ratios require care. If the same resistance is assumed, electrical power is proportional to the square of voltage:

$$
P \propto V^2.
$$

Therefore a voltage ratio becomes a power ratio by squaring:

$$
\frac{P_{\text{out}}}{P_{\text{in}}}
=
\left(\frac{V_{\text{out}}}{V_{\text{in}}}\right)^2.
$$

Substituting this into the power decibel formula gives

$$
10\log_{10}\left(\left(\frac{V_{\text{out}}}{V_{\text{in}}}\right)^2\right)
=
20\log_{10}\left(\frac{V_{\text{out}}}{V_{\text{in}}}\right).
$$

That is why voltage ratios use $20\log_{10}(\cdot)$ rather than $10\log_{10}(\cdot)$. The factor $20$ is not arbitrary; it appears because power depends on voltage squared. A common mistake is to apply the power-ratio formula to voltages without accounting for this square relationship.

It is also important not to confuse relative and absolute decibel units. Plain $\mathrm{dB}$ expresses a ratio. By contrast, $\mathrm{dBm}$ expresses an absolute power level relative to $1\,\mathrm{mW}$:

$$
P_{\mathrm{dBm}} = 10 \log_{10}\left(\frac{P}{1\,\mathrm{mW}}\right).
$$

Thus, $\mathrm{dB}$ answers “how much bigger or smaller?” while $\mathrm{dBm}$ answers “how much power, measured relative to one milliwatt?” Since $0\,\mathrm{dBm}$ means

$$
10\log_{10}\left(\frac{P}{1\,\mathrm{mW}}\right)=0,
$$

it follows that $P=1\,\mathrm{mW}$. Similarly, $-10\,\mathrm{dBm}$ means $0.1\,\mathrm{mW}$. Low-power wireless signals are often expressed in negative $\mathrm{dBm}$ values; a signal around $-70\,\mathrm{dBm}$ can still be a meaningful received signal. Negative does not mean absent. It means below $1\,\mathrm{mW}$.

Because $\mathrm{dBm}$ is absolute and $\mathrm{dB}$ is relative, they cannot be converted into each other as if they were the same kind of quantity. You cannot take a value in plain $\mathrm{dB}$ and “convert it to $\mathrm{dBm}$” without knowing an absolute reference power. A gain of $10\,\mathrm{dB}$ tells you that output power is ten times input power. It does not tell you whether the output is $10\,\mathrm{mW}$, $10\,\mathrm{W}$, or $10\,\mathrm{nW}$ unless the input power is known.

There is also a unit called $\mathrm{dBW}$, which is an absolute power level relative to $1\,\mathrm{W}$:

$$
P_{\mathrm{dBW}} = 10\log_{10}\left(\frac{P}{1\,\mathrm{W}}\right).
$$

Since $1\,\mathrm{W}=1000\,\mathrm{mW}$,

$$
10\log_{10}(1000)=30.
$$

So $1\,\mathrm{W}$ is $0\,\mathrm{dBW}$ and also $30\,\mathrm{dBm}$. This conversion is valid because both $\mathrm{dBW}$ and $\mathrm{dBm}$ are absolute power units with known references. But this does not mean that plain $\mathrm{dB}$ can be converted to $\mathrm{dBm}$ by adding $30$. That rule would confuse a ratio with an absolute level.

Adding powers in $\mathrm{dBm}$ also requires discipline. Suppose two independent powers are each $0\,\mathrm{dBm}$. Since $0\,\mathrm{dBm}=1\,\mathrm{mW}$, the total power is

$$
1\,\mathrm{mW}+1\,\mathrm{mW}=2\,\mathrm{mW}.
$$

Expressed relative to $1\,\mathrm{mW}$, this is

$$
10\log_{10}\left(\frac{2\,\mathrm{mW}}{1\,\mathrm{mW}}\right)
=
10\log_{10}(2)
\approx 3\,\mathrm{dBm}.
$$

So $0\,\mathrm{dBm}+0\,\mathrm{dBm}$ as powers gives $3\,\mathrm{dBm}$ total, not $0\,\mathrm{dBm}$ and not simply “add the logarithmic numbers.” The correct procedure is to convert each absolute logarithmic power to linear power, add in linear units, and convert back if needed. The doubling itself is a $3\,\mathrm{dB}$ ratio; the resulting absolute total is $3\,\mathrm{dBm}$.

These calculations are simple only if the logarithms are familiar. A calculator is part of the engineering toolchain. You must know how to compute base-ten logarithms, such as $\log_{10}(2)$, on the calculator you will actually use. Conceptual understanding and calculator fluency are not separate. If an exam or design problem requires $10\log_{10}(2)$, the reasoning should not be blocked by not knowing which key computes the logarithm.

## Fourier Thinking and Frequency Content

A signal can be described in the time domain by asking how it changes over time. The same signal can also be described in the frequency domain by asking which frequencies are present and how strongly they contribute. These are not two different signals; they are two different ways of representing the same signal. Fourier analysis provides the bridge between these views.

The intuition begins with vectors. In ordinary three-dimensional space, a vector can be decomposed into components along three orthogonal directions, such as the $x$, $y$, and $z$ axes. If a vector has no component in the $z$ direction, then its projection onto the $z$ axis is zero. Fourier analysis uses the same idea, but the “directions” are functions instead of arrows. Sines, cosines, or complex exponentials form a kind of basis for signals. We ask: how much of this signal points in the direction of a cosine at this frequency? How much points in the direction of a sine at that frequency? If the projection is zero, then that frequency component is absent.

For a periodic signal with period $T$, the fundamental angular frequency is

$$
\omega_0 = \frac{2\pi}{T}.
$$

The fundamental frequency is the lowest repetition frequency associated with the period. Harmonics occur at integer multiples of this fundamental frequency: $\omega_0$, $2\omega_0$, $3\omega_0$, and so on. A periodic signal can be represented as a sum of these harmonic components. In complex Fourier-series form,

$$
x(t)=\sum_{k=-\infty}^{\infty} c_k e^{jk\omega_0 t},
$$

where $x(t)$ is the time-domain signal, $t$ is time, $k$ is an integer harmonic index, $e^{jk\omega_0 t}$ is a complex exponential basis function, and $c_k$ is the Fourier-series coefficient that tells us how much of that harmonic is present. The coefficient is found by projection:

$$
c_k = \frac{1}{T}\int_T x(t)e^{-jk\omega_0 t}\,dt.
$$

The integral is taken over one full period. The factor $\frac{1}{T}$ normalizes the projection. The exponential with the negative sign plays the role of “looking in the direction” of the $k$th basis function. This is the mathematical version of asking whether the signal contains that frequency component.

This projection viewpoint prevents Fourier analysis from becoming a list of formulas. A coefficient is not just a number produced by an integral. It is the amount of a particular oscillatory pattern inside the signal. If the coefficient is large, that frequency matters strongly. If it is zero, that frequency is not needed for reconstruction. If many high-frequency coefficients are needed, the signal changes rapidly or sharply in time.

This matters because channels do not treat all frequencies equally. A cable may pass low frequencies well but weaken high frequencies. An antenna may work only over a certain band. A filter may intentionally remove unwanted frequency components. A waveform that looks simple in time may require many frequencies to reproduce accurately, while a bandwidth-limited channel may remove some of those frequencies and distort the result.

A square wave is the classic example. A perfect square wave switches abruptly between levels. To reconstruct that sharp transition using smooth sine and cosine waves, many harmonics are needed. The more harmonics we include, the sharper the reconstructed edge becomes. Because of the symmetry of a square wave, certain harmonics cancel. In the common symmetric square-wave case, even harmonics vanish and odd harmonics remain. This is not a coincidence but a consequence of the waveform’s symmetry. Symmetry in time imposes structure in frequency.

The square wave also teaches a practical lesson: fast changes in time require high-frequency content. Sharp edges, narrow pulses, and sudden transitions require high-frequency components. If a communication system wants to send shorter pulses, sharper transitions, or a higher bitrate, the signal must occupy more bandwidth. Bandwidth is the range of frequencies needed or used by a signal. Frequency resources are limited. Wireless systems, for example, cannot all use arbitrary frequency ranges at arbitrary bandwidths. Faster communication is not free; it asks for more frequency-domain resources or a more clever use of the resources available.

The Fourier transform extends the same idea beyond periodic signals. Instead of representing a signal only at discrete harmonics of a fundamental frequency, the Fourier transform represents general signals over a continuous frequency axis. The time-domain signal $x(t)$ has a frequency-domain representation $X(f)$, where $f$ is frequency in hertz. A constant signal is an important limiting example. If a signal does not change in time, it contains only zero-frequency content, also called a DC component. Its Fourier transform is concentrated at $f=0$, represented mathematically by a delta function. This makes physical sense: a constant has no oscillation at any nonzero frequency.

Sines and cosines have especially simple frequency-domain representations. A cosine at a frequency appears as two symmetric components, one at the positive frequency and one at the negative frequency. This follows from Euler’s identity, because a cosine can be written as the sum of two complex exponentials rotating in opposite directions. A sine also has positive- and negative-frequency components, but with opposite signs or phases. For real time-domain signals, the spectrum has symmetry: the negative-frequency side is not independent in the same way it would be for a fully complex signal. These facts become important when we analyze sampling, because sampling creates shifted copies of the spectrum on both sides of the frequency axis.

When drawing signals, the axes matter. A time-domain plot should make clear what the horizontal axis represents, usually time, and what the vertical axis represents, usually amplitude. A frequency-domain plot should make clear what the horizontal frequency axis represents and what the vertical coefficient, magnitude, or spectral amplitude represents. This is not cosmetic. Mislabeling axes often reveals that the representation itself is not understood.

## Sampling and Reconstruction

Sampling is the act of measuring a continuous-time signal at discrete moments. Instead of storing every value of a waveform at every instant, we store a sequence of sample values. This is the first major step from analog behavior toward digital representation. But the central question is not simply “Can we take samples?” Of course we can. The real question is: under what conditions do the samples contain enough information to reconstruct the original signal?

Let the original analog signal be $x(t)$, where $t$ is continuous time. We choose a sampling period $T_s$, meaning we take one sample every $T_s$ seconds. The corresponding sampling frequency is

$$
f_s = \frac{1}{T_s}.
$$

The sample values are $x(nT_s)$, where $n$ is an integer. An ideal mathematical model of sampling uses a train of delta functions. Define the sampling impulse train

$$
p(t)=\sum_{n=-\infty}^{\infty}\delta(t-nT_s),
$$

where $\delta(t)$ is the Dirac delta function. The sampled signal is modeled as

$$
x_s(t)=x(t)p(t)
=
\sum_{n=-\infty}^{\infty}x(nT_s)\delta(t-nT_s).
$$

This equation is worth reading slowly. The sampled signal is not a smooth curve. It is a sequence of impulses located at the sampling instants. Each impulse has a weight equal to the original signal value at that instant. This is an idealization, but a powerful one, because it lets us analyze sampling exactly in the frequency domain.

The key issue is whether the samples preserve enough information to reconstruct the original signal. If you plot a few samples and connect them with straight lines, you may believe you see the original waveform. But the receiver does not know the original curve between the samples. It only knows the transmitted sample values. If the samples are too far apart, many different continuous-time signals could pass through the same points. The receiver may reconstruct the wrong one.

The frequency-domain view reveals the condition for avoiding this ambiguity. Multiplication in the time domain corresponds to convolution in the frequency domain. Since ideal sampling multiplies $x(t)$ by $p(t)$, the spectrum of the sampled signal is the convolution of the original spectrum $X(f)$ with the spectrum of the impulse train. The impulse train has a spectrum that is itself a train of impulses spaced by $f_s$. Consequently, sampling creates repeated copies of the original spectrum at integer multiples of the sampling frequency. In a common Fourier-transform convention,

$$
X_s(f)=f_s\sum_{k=-\infty}^{\infty}X(f-kf_s),
$$

where $X_s(f)$ is the spectrum of the sampled signal, $X(f)$ is the spectrum of the original signal, and $k$ indexes the shifted copies.

This equation is the heart of sampling theory. Sampling does not merely “pick points.” In frequency, it replicates the spectrum. If the original signal is band-limited, meaning it contains no frequency components above some maximum frequency $B$, then $X(f)$ is nonzero only within a finite band. If the sampling frequency $f_s$ is large enough, the repeated spectral copies remain separated. If they remain separated, an ideal low-pass filter can select the central copy and remove the others. The original signal can then be reconstructed perfectly in the ideal mathematical sense.

If the sampling frequency is too low, the shifted copies overlap. This overlap is called aliasing. Once aliasing occurs, different parts of the spectrum add together in the same frequency region. The original spectrum is deformed. Information is lost in a way that cannot be undone by later filtering, because the overlapped components are no longer distinguishable. This is why aliasing is not just “a little distortion” that can always be fixed afterward. It is a failure of representation.

The condition that prevents this overlap is the Nyquist sampling criterion:

$$
f_s \ge 2B,
$$

where $B$ is the highest frequency component, or bandwidth, of the signal being sampled. The sampling frequency must be at least twice the highest frequency present. This required rate is called the Nyquist rate.

The time-domain intuition matches this frequency-domain result. Suppose the highest frequency in a signal is $100\,\mathrm{Hz}$. Its period is

$$
T = \frac{1}{100\,\mathrm{Hz}} = 10\,\mathrm{ms}.
$$

Sampling once per period is not enough. If we sample only once during each cycle of the fastest sinusoidal component, the receiver receives too little information to determine the oscillation reliably. Sampling twice per period is the limiting ideal condition for representing that highest sinusoidal frequency. Thus the sampling frequency must be at least $200\,\mathrm{Hz}$ for a signal whose highest component is $100\,\mathrm{Hz}$.

The audio example makes the criterion concrete. Human hearing is often considered to extend roughly up to $20\,\mathrm{kHz}$. To represent audio without audible aliasing, the sampling rate must be somewhat above twice that value. This is why familiar audio sampling rates such as $44.1\,\mathrm{kHz}$ or $48\,\mathrm{kHz}$ make sense: they are just above $2\cdot 20\,\mathrm{kHz}$, with practical room for filtering.

Under-sampling means sampling below the Nyquist rate. In the time domain, under-sampling may make a high-frequency signal appear as a lower-frequency signal. In the frequency domain, this is exactly spectral overlap. The high-frequency content folds into another part of the spectrum and masquerades as something else. The receiver cannot know from the samples alone which original signal was intended.

Anti-aliasing filters are therefore used before sampling to remove frequency components that the chosen sampling rate cannot represent safely. Ideal reconstruction is the clean counterpart to ideal sampling. If the original spectrum copies do not overlap, reconstruction can be performed by an ideal low-pass filter that keeps the original baseband copy and rejects all shifted copies. “Low-pass” means it passes low frequencies near zero and suppresses high frequencies. The cutoff must be chosen so that the desired original spectrum is retained while the replicas centered at $\pm f_s$, $\pm 2f_s$, and so on are removed.

In practice, filters are not perfectly ideal, and real sampling circuits do not create mathematical delta impulses. But the ideal theory establishes the design principle: sample fast enough that the information is not destroyed, then filter appropriately to reconstruct. Sampling is therefore not an isolated operation. It is tied directly to bandwidth, Fourier representation, and channel design. If a signal has more high-frequency content, it must be sampled faster. If we want sharper pulses or faster changes, the required bandwidth grows. If bandwidth is limited, the waveform must be shaped carefully, the data rate must be reduced, or more efficient signaling must be used.

## Quantization and Binary Representation

After sampling, each sample still has an amplitude that may vary continuously. Quantization replaces that continuous range with a finite set of allowed levels. Each sample is rounded or assigned to one of these levels, and each level can be represented by a binary code.

Quantization makes digital storage and processing possible, but it also introduces error. The quantized value is usually not exactly equal to the original sample value. The difference is quantization error, and in many systems it behaves like an additional noise source. More quantization levels reduce this error but require more bits per sample. Fewer levels save bits but produce more distortion.

This creates another central tradeoff: digital representations are robust and convenient because they use finite symbols, but the act of forcing continuous values into finite categories necessarily loses some detail. The engineering question is how many bits are enough for the intended application.

## Coding, Signaling, and Modulation

Once information is represented as bits, those bits still cannot travel through a physical medium by themselves. They must be mapped onto signals. In a wireline system, this may mean choosing voltage levels or pulse shapes. In a radio system, it may mean changing the amplitude, frequency, or phase of a carrier wave. In an optical system, it may mean varying light intensity.

Coding is introduced because channels make mistakes. Error-detecting codes allow the receiver to notice that something has gone wrong. Error-correcting codes add enough structured redundancy that some errors can be fixed without retransmission. This redundancy costs extra bits or bandwidth, but it improves reliability.

Error detection and error correction are powerful because communication systems almost always include some protection against errors. Even everyday systems such as USB links and wireless networks use mechanisms that detect or correct corrupted bits. The basic idea is to add structured redundancy before transmission so that the receiver can notice when something impossible or unlikely has occurred. Error correction does not mean the channel becomes perfect; it means we design the transmitted representation so that some channel mistakes can be identified and repaired.

Signaling and modulation determine how the information is placed onto the physical waveform. Different choices use power and bandwidth differently, tolerate noise differently, and interact with the channel in different ways. The receiver’s job is to infer which symbol or waveform was most likely sent, even though the observed waveform has been altered by the channel.

## Learning the System as a Whole

The topics in digital communication are tightly connected. Sampling depends on frequency content. Frequency content determines bandwidth needs. Bandwidth interacts with modulation and channel limitations. Noise affects detection. Detection errors motivate coding. Decibels provide a practical language for comparing signal power, attenuation, gain, and signal-to-noise ratio across the system.

For that reason, the subject is best learned as an interconnected chain rather than a list of isolated formulas. Each concept answers a problem created by the previous one. We sample because continuous signals are hard to store directly. We quantize because computers need finite values. We code because channels are unreliable. We modulate because physical media carry waveforms rather than abstract bits. We use Fourier analysis because waveforms occupy frequency space. We use decibels because communication systems involve very large and very small ratios.

The deeper theme is representation. A vector can be represented by projections onto basis directions. A signal can be represented by Fourier coefficients. An analog waveform can be represented by samples. A sample can be represented by bits. Bits can be represented by transmitted symbols. A received distorted waveform can be interpreted as the most likely transmitted message. At each step, the representation is useful only if the rules are respected. Sample too slowly and information is lost. Confuse ratios with absolute powers and calculations lose meaning. Ignore bandwidth and a pulse cannot fit through the channel. Ignore errors and reconstructed values become wrong.

The goal is not to memorize disconnected facts such as “doubling is $3\,\mathrm{dB}$” or “sample at twice the bandwidth.” The goal is to see why they are true and where they are used. Communication engineering is the art of preserving meaning while changing form: analog to digital, time to frequency, bits to waveforms, transmitted energy to received decisions, and received samples back to a message. Each mathematical tool is introduced because some part of that preservation problem demands it.

A strong understanding comes from repeatedly moving between the physical picture and the mathematical description: what is the signal, what is the channel doing to it, what representation are we using, what errors can occur, and how does the receiver recover the message? When those questions become familiar, new problems in communication systems become much easier to approach.
