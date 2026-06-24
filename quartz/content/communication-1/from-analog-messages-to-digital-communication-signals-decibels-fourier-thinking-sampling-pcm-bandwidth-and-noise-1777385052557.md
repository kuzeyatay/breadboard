---
title: "From Analog Messages to Digital Communication: Signals, Decibels, Fourier Thinking, Sampling, PCM, Bandwidth, and Noise"
date: "2026-04-28T14:04:12.557Z"
source: "generated-chat"
knowledge_type: "generated-note"
generated_note_type: "chat-node"
generated_by: "chatmock"
related: ["from-analog-messages-to-digital-communication-signals-decibels-fourier-thinking-and-sampling-1777197492003", "fourier-analysis-of-signals-1777190840499", "nyquist-sampling-criterion-1777190840499", "digital-communication-as-analog-to-digital-to-analog-transfer", "bandwidth-and-time-variation-1777190840499", "aliasing-and-nyquist-sampling-criterion"]
tags: ["digital-communication", "analog-signals", "sampling", "pulse-code-modulation", "decibels", "fourier-analysis", "bandwidth", "noise"]
---

# From Analog Messages to Digital Communication: Signals, Decibels, Fourier Thinking, Sampling, PCM, Bandwidth, and Noise

The central problem of communication is deceptively simple: one person, sensor, or machine has some information here, and another person, actuator, or machine needs to recover that information there. The information itself may begin as something physical and continuous: pressure variations in air when someone speaks, light intensity in an optical sensor, a voltage from a microphone, temperature over time, or a video signal. These are analog messages. They vary continuously in time and often continuously in amplitude. Yet modern communication systems very often do not send this analog waveform directly. Instead, they convert it into a sequence of numbers, represent those numbers by bits, transmit those bits through some physical medium, and then reconstruct an approximation of the original waveform at the receiver.

That immediately raises the main tension of the subject. If the original world is analog, why do we go through the trouble of making the signal digital? The answer is not that the physical channel becomes digital. It does not. Wires, optical fibers, antennas, air, amplifiers, filters, and photodiodes all still carry physical waveforms. A “digital” communication system is still built out of analog physics. What becomes digital is the representation of the information. We deliberately force the message into a discrete alphabet, usually bits, because bits can be stored, processed, protected, copied, corrected, and regenerated in ways that continuously varying analog values cannot.

A useful first mental picture is therefore the full communication chain. A microphone converts sound pressure into an electrical waveform. That waveform is sampled: instead of looking at every instant of time, we measure it at selected instants. The sampled values are quantized: instead of allowing every possible amplitude, we round each sample to one of a finite set of levels. Each level is represented by a binary word. The resulting bit stream may be coded for error protection, converted into pulses or line codes, possibly modulated onto a carrier frequency, and sent through a channel such as a cable, radio link, or optical fiber. The channel adds noise, attenuation, distortion, dispersion, interference, and other imperfections. At the receiver, the system detects the transmitted symbols, corrects or at least detects some errors if possible, decodes the bits back into sample values, and reconstructs a time waveform using a digital-to-analog converter and filtering.

This chain is not a collection of arbitrary blocks. Each block exists because of a specific physical or mathematical difficulty. Sampling addresses the question: how can a continuous-time signal be represented by discrete-time measurements? Quantization addresses the question: how can continuously valued samples be represented by a finite number of bits? Line coding and modulation address the question: how can bits be turned into physical waveforms that a real channel can carry? Error correction addresses the question: how can we survive noise and incorrect decisions? Filtering and reconstruction address the question: how can the receiver recover a smooth waveform rather than merely a sequence of numbers? The whole course can be seen as following the message through this chain and asking, at every stage, what is gained, what is lost, and what constraints the physical world imposes.

## Measuring Signal Size: Power, Gain, dB, dBm, and Why Logarithms Appear

Before studying the chain deeply, we need a language for signal strength. Communication systems often involve enormous ranges of power. A transmitter may produce watts, while a receiver may detect signals in microwatts, nanowatts, or even far below that. In radio systems, optical systems, and amplifier chains, multiplying and dividing power ratios appears constantly. For that reason, engineers use decibels.

A decibel value is a logarithmic way to express a ratio. For two powers $P_{\mathrm{out}}$ and $P_{\mathrm{in}}$, the gain or loss in decibels is

$$
G_{\mathrm{dB}} = 10\log_{10}\left(\frac{P_{\mathrm{out}}}{P_{\mathrm{in}}}\right).
$$

This expression is a ratio. Plain dB has no absolute reference power. It only says how many times larger or smaller one power is compared with another. If $P_{\mathrm{out}} = 10P_{\mathrm{in}}$, then

$$
G_{\mathrm{dB}} = 10\log_{10}(10)=10\,\mathrm{dB}.
$$

So a power gain of $10\,\mathrm{dB}$ means a factor of $10$ in power. If the power is doubled, then

$$
10\log_{10}(2)\approx 3\,\mathrm{dB}.
$$

That is why a doubling of power is usually remembered as approximately $3\,\mathrm{dB}$. A halving of power is approximately $-3\,\mathrm{dB}$. Negative dB does not mean “negative power”; it means a ratio smaller than one.

The logarithmic scale is useful because cascaded gains become additions. Suppose a signal passes through an amplifier with $20\,\mathrm{dB}$ gain and then through a cable with $3\,\mathrm{dB}$ loss. In linear power ratios, one would multiply by $100$ and then divide by about $2$. In dB, one simply computes

$$
20\,\mathrm{dB} - 3\,\mathrm{dB} = 17\,\mathrm{dB}.
$$

This is one of the reasons decibel arithmetic is so natural in RF engineering: chains of antennas, amplifiers, filters, cables, and path losses become sums instead of products.

There is a subtle but important distinction between power ratios and voltage ratios. In many electrical systems, power is proportional to voltage squared, assuming the resistance is fixed:

$$
P \propto V^2.
$$

Therefore, when expressing a voltage ratio in decibels, we use

$$
G_{\mathrm{dB}} = 20\log_{10}\left(\frac{V_{\mathrm{out}}}{V_{\mathrm{in}}}\right),
$$

not $10\log_{10}$. The factor $20$ appears because

$$
10\log_{10}\left(\frac{P_{\mathrm{out}}}{P_{\mathrm{in}}}\right)
=
10\log_{10}\left(\frac{V_{\mathrm{out}}^2}{V_{\mathrm{in}}^2}\right)
=
20\log_{10}\left(\frac{V_{\mathrm{out}}}{V_{\mathrm{in}}}\right).
$$

This is not a separate definition invented for voltages; it follows from the square relationship between power and voltage.

The most common mistake is to confuse dB with dBm. Plain dB is a unitless ratio. dBm is an absolute power level referenced to $1\,\mathrm{mW}$. A power $P$ expressed in dBm is

$$
P_{\mathrm{dBm}} = 10\log_{10}\left(\frac{P}{1\,\mathrm{mW}}\right).
$$

Thus,

$$
0\,\mathrm{dBm} = 1\,\mathrm{mW},
$$

because $\log_{10}(1)=0$. Similarly,

$$
10\,\mathrm{dBm}=10\,\mathrm{mW},
$$

and

$$
-10\,\mathrm{dBm}=0.1\,\mathrm{mW}.
$$

A typical weak wireless signal may be around $-70\,\mathrm{dBm}$. That is not “negative power”; it is a very small positive power compared with $1\,\mathrm{mW}$.

Another absolute logarithmic unit is dBW, referenced to $1\,\mathrm{W}$:

$$
P_{\mathrm{dBW}} = 10\log_{10}\left(\frac{P}{1\,\mathrm{W}}\right).
$$

Because $1\,\mathrm{W}=1000\,\mathrm{mW}$, $0\,\mathrm{dBW}$ is the same physical power as $30\,\mathrm{dBm}$. But one cannot convert plain dB into dBm without knowing an absolute reference level. A ratio is not an absolute power.

There is also a trap when adding powers expressed in dBm. If two independent signals each have power $0\,\mathrm{dBm}$, it is wrong to say the total is $0\,\mathrm{dBm}+0\,\mathrm{dBm}=0\,\mathrm{dBm}$ or $0\,\mathrm{dBm}$. It is also not meaningful to simply add the logarithmic labels as if they were ordinary powers. The correct procedure is to convert to linear units first. Each $0\,\mathrm{dBm}$ signal is $1\,\mathrm{mW}$. Two such powers give

$$
1\,\mathrm{mW}+1\,\mathrm{mW}=2\,\mathrm{mW}.
$$

Converting back,

$$
10\log_{10}\left(\frac{2\,\mathrm{mW}}{1\,\mathrm{mW}}\right)
=
10\log_{10}(2)
\approx 3\,\mathrm{dBm}.
$$

The increase relative to one signal is $3\,\mathrm{dB}$, while the final absolute level is $3\,\mathrm{dBm}$. That sentence contains the distinction: dB describes the ratio, dBm describes the absolute resulting power.

## Signals in Time and Frequency: Why Fourier Thinking Is Not Optional

Communication signals live in time, but channels are often limited in frequency. This creates the need for a second way of seeing the same waveform. A time-domain plot tells us how a signal changes with time. A frequency-domain representation tells us which sinusoidal components are needed to build that waveform.

The fundamental idea behind Fourier analysis is not mysterious. It is a projection idea. In ordinary geometry, a vector can be decomposed into components along basis directions such as the $x$, $y$, and $z$ axes. If a vector has no component in the $z$ direction, its projection onto the $z$ basis vector is zero. Similarly, a signal can be decomposed into components along basis functions such as sines and cosines. If a signal contains no component that looks like $\cos(\omega_0 t)$, then the projection of the signal onto $\cos(\omega_0 t)$ is zero.

For periodic signals, Fourier series expresses the signal as a sum of harmonically related sinusoids. If the period is $T$, the fundamental frequency is

$$
f_0 = \frac{1}{T},
$$

and the corresponding angular frequency is

$$
\omega_0 = 2\pi f_0.
$$

The harmonics occur at integer multiples of the fundamental frequency:

$$
f_k = kf_0,
$$

where $k$ is an integer. The Fourier coefficients tell us how much of each harmonic is present. These coefficients are found by projecting the signal onto the corresponding basis functions. The key conceptual point is that Fourier coefficients are not arbitrary fitting numbers; they measure how strongly the signal contains each sinusoidal component.

A square wave is the classic example because it shows why bandwidth matters. A square wave switches abruptly between levels. Smooth sinusoids do not switch abruptly, so many harmonics are needed to approximate the sharp edges. If we include only the fundamental, the result is a smooth sinusoid. If we add more odd harmonics, the waveform becomes more square. The even harmonics cancel because of the symmetry of the square wave; the odd harmonics carry the structure. The spectrum is discrete because the signal is periodic, and the amplitudes of the harmonics follow a sinc-like envelope.

This example carries an engineering warning. Sharp changes in time require high-frequency content. If we want to send information faster, we usually need shorter pulses or faster symbol changes. Shorter pulses require more bandwidth. In everyday terms, faster download speeds are not free: they demand either more spectral resources, more efficient use of the available spectrum, or more sophisticated signaling. Frequency resources are limited, especially in wireless communication, so bandwidth is not merely a mathematical detail. It is a physical and regulatory constraint.

The Fourier transform extends the same idea beyond periodic signals. It represents a general time signal in terms of continuous frequency components. The frequency-domain representation $X(f)$ tells us how much of each frequency is present in $x(t)$. A constant signal, for example, has only a zero-frequency or DC component. In the frequency domain, that appears as a delta function at $f=0$. This is physically sensible: a signal that never changes in time has no oscillatory content except zero frequency.

Fourier thinking also reveals a deep duality. Operations that look simple in time may look different in frequency. Multiplication in time corresponds to convolution in frequency. Convolution in time corresponds to multiplication in frequency. Sampling, modulation, filtering, and reconstruction all become much clearer once this time-frequency duality is understood.

## Sampling: How a Continuous-Time Signal Becomes a Sequence Without Losing Its Identity

The first major step in digitizing an analog message is sampling. Sampling means measuring the value of a continuous-time signal at discrete instants. If the sampling period is $T_s$, then the sampling frequency is

$$
f_s = \frac{1}{T_s}.
$$

The sampled sequence consists of values such as

$$
x[n] = x(nT_s),
$$

where $n$ is an integer sample index.

At first, sampling may seem impossible. How can isolated points preserve an entire waveform between those points? If we sample too slowly, they cannot. But if the signal is band-limited, meaning it contains no frequency components above some maximum frequency $B$, then there is a precise condition under which the samples contain all the information needed for perfect reconstruction.

The sampling theorem says that the sampling frequency must be at least twice the highest frequency component:

$$
f_s \ge 2B.
$$

This is the Nyquist sampling criterion. The frequency $2B$ is the Nyquist rate. The reason this condition appears is best understood in the frequency domain. Ideal sampling can be modeled as multiplying the signal $x(t)$ by a train of delta functions spaced by $T_s$:

$$
x_s(t)=x(t)\sum_{n=-\infty}^{\infty}\delta(t-nT_s).
$$

The delta train selects the values of $x(t)$ at the sampling instants. Because multiplication in time corresponds to convolution in frequency, this multiplication produces repeated copies of the original spectrum in the frequency domain. These copies are spaced by the sampling frequency $f_s$.

If $f_s$ is large enough, the repeated spectra do not overlap. Then the original spectrum can be recovered by passing the sampled signal through an ideal low-pass filter that keeps the central copy and removes the replicas. But if $f_s$ is too small, neighboring spectral copies overlap. This overlap is aliasing. Once aliasing occurs, different frequency components become indistinguishable in the sampled data. The original spectrum is deformed, information is lost, and perfect reconstruction is no longer possible.

This is why sampling once per period of the highest-frequency sinusoid is not enough. Suppose the highest component is $100\,\mathrm{Hz}$, with period $10\,\mathrm{ms}$. If we sample only once per period, the receiver sees one point per cycle and may connect the dots in a way that suggests a completely different waveform. Sampling twice per period is the theoretical minimum under ideal conditions. In practice, systems often sample above the minimum to allow realistic filters and tolerances.

Audio gives a familiar example. Human hearing is often modeled as extending up to about $20\,\mathrm{kHz}$. To avoid aliasing, an audio sampling rate must be above $40\,\mathrm{kHz}$. That is why common audio sampling rates such as $44.1\,\mathrm{kHz}$ and $48\,\mathrm{kHz}$ are used. They are not arbitrary numbers; they are tied to the bandwidth of human hearing and the Nyquist criterion.

Sampling can be implemented or modeled in different ways. Ideal sampling uses mathematical impulses, which are infinitely narrow and physically unrealizable. Natural sampling multiplies the signal by a periodic pulse train, so the tops of the pulses follow the shape of the original signal during each pulse interval. Flat-top sampling, also called sample-and-hold, holds each sample value constant for a short time. This is closer to practical electronics, but it introduces the aperture effect: the spectrum is modified by a sinc-shaped factor because the sample is held over a finite duration. The held waveform is easier for circuits to process, but it is not identical to ideal impulse sampling.

Pulse amplitude modulation, or PAM, is closely related to sampling. In PAM, the amplitudes of pulses represent the sampled values of the message. PAM itself may still be analog in amplitude: the pulse heights can vary continuously. To become fully digital, the amplitudes must also be quantized.

## Quantization and PCM: Turning Samples into Bits

Sampling discretizes time but not amplitude. After sampling, each sample value may still be any real number within the signal range. A digital system cannot transmit arbitrary real numbers exactly. It must choose from a finite set of allowed values. This is quantization.

Suppose the input amplitude range is divided into $L$ quantization levels. Each sample is rounded to the nearest level. If $L$ is a power of two, then each quantized sample can be represented by

$$
n=\log_2(L)
$$

bits. Conversely,

$$
L=2^n.
$$

For example, $8$ bits per sample gives $2^8=256$ possible levels. More bits per sample means finer amplitude resolution and less quantization error, but it also means a higher bit rate.

Pulse code modulation, or PCM, is the process in which an analog signal is sampled, quantized, and encoded into binary words. The PCM bit rate is determined by the sampling frequency and the number of bits per sample:

$$
R = n f_s,
$$

where $R$ is the bit rate in bits per second, $n$ is the number of bits per sample, and $f_s$ is the sampling frequency. This formula is simple but important. If we increase the sampling rate to capture a wider-bandwidth signal, the bit rate rises. If we increase the number of quantization bits to improve amplitude accuracy, the bit rate also rises. Higher quality costs transmission capacity.

Quantization introduces error because the quantized value is generally not equal to the original sample. The difference is quantization noise or quantization error. If the quantization step size is small and the signal behaves suitably, this error can often be modeled as a noise-like quantity. More quantization levels reduce the step size and therefore reduce quantization noise. But again, this requires more bits.

This produces a central trade-off. Analog transmission suffers continuously from channel noise and distortion: every small disturbance changes the received waveform. Digital transmission deliberately sacrifices exact amplitude at the quantizer, but then gains robustness. Once a sample has been represented by bits, the receiver does not need to reproduce every small waveform variation. It only needs to decide which symbol or bit was sent. If the noise is not too large, the receiver can regenerate the correct discrete value. This is the source of digital robustness.

However, digital is not magic. If the noise becomes large enough to push a received value across a decision threshold, the receiver makes a bit error. Once a bit is wrong, the decoded sample may be wrong, and the reconstructed waveform may contain distortion. Digital communication replaces gradual analog degradation by a threshold effect: below a certain noise level, performance can be excellent; above it, errors can appear suddenly and severely. Error detection and error correction are introduced because of this.

A simple parity bit can detect some errors by adding one extra bit that makes the total number of ones even or odd. But parity has limitations. It can detect certain odd numbers of bit errors but may miss even numbers of errors. More powerful codes, such as Hamming codes, add structured redundancy. In a Hamming $(7,4)$ code, four data bits are expanded to seven bits by adding parity bits in specific positions. At the receiver, syndrome calculations can indicate the position of a single-bit error, allowing it to be corrected. This illustrates a general principle: redundancy costs bit rate, but it buys reliability.

## Symbols, Line Coding, Bit Rate, Baud Rate, and Bandwidth

After bits are produced, they must be represented by physical waveforms. A bit stream is an abstract sequence; the channel carries voltages, currents, optical intensities, or electromagnetic fields. The mapping from bits to waveform shapes is called signaling or line coding.

A symbol is one transmitted waveform choice from a finite set. In binary signaling, one symbol carries one bit. But in multilevel signaling, one symbol can carry multiple bits. If there are $L$ possible symbol levels, then each symbol can represent

$$
l = \log_2(L)
$$

bits. The symbol rate, also called baud rate, is the number of symbols transmitted per second. If the symbol rate is $D$, then the bit rate is

$$
R = lD = D\log_2(L).
$$

For binary signaling, $L=2$, so $l=1$ and $R=D$. For $8$-level signaling, $L=8$, so $l=3$ and each symbol carries three bits.

This is attractive because a fixed bit rate can be achieved with a lower symbol rate by increasing the number of bits per symbol. Lower symbol rate generally means less required bandwidth. But the price is noise sensitivity. If the same voltage range is divided into more levels, the distance between adjacent levels becomes smaller. A smaller amount of noise can then cause the receiver to choose the wrong level. Multilevel signaling improves spectral efficiency but reduces noise margin.

The relation between symbol rate and bandwidth can be made precise using the dimensionality theorem. A band-limited signal of bandwidth $B$ observed over a time interval $T_0$ has at most

$$
N_D = 2BT_0
$$

orthogonal dimensions. If a communication system uses $N$ dimensions in that interval, then $N \le N_D$. The symbol rate is

$$
D = \frac{N}{T_0}.
$$

Therefore,

$$
D \le 2B,
$$

and so

$$
B \ge \frac{D}{2}.
$$

This result says that the minimum bandwidth required for a symbol rate $D$ is half the symbol rate. The ideal pulse shape that achieves this limiting case is the sinc pulse. Sinc pulses have zero crossings spaced so that, at the sampling instant of one symbol, all neighboring symbols contribute zero. This is the basis of the Nyquist zero-inter-symbol-interference criterion.

Inter-symbol interference, or ISI, occurs when pulses spread in time so that one symbol interferes with the sampling instant of another. Real channels are bandwidth-limited, so they smear sharp pulses. Rectangular pulses, while simple in time, have broad spectra and are poorly suited to strictly band-limited channels. Raised-cosine filtering is introduced to produce pulses that satisfy the zero-ISI condition while having more practical bandwidth behavior than ideal sinc pulses. The roll-off factor controls the excess bandwidth: a smaller roll-off is more bandwidth-efficient but more demanding in time-domain behavior and filtering precision; a larger roll-off uses more bandwidth but is easier to implement robustly.

Line codes also have spectral properties. Unipolar non-return-to-zero, polar non-return-to-zero, return-to-zero, and Manchester coding distribute power differently over frequency. Some have DC components; some avoid DC; some require more bandwidth because they force transitions. These choices matter because channels may not pass low frequencies well, may have bandwidth constraints, or may require clock recovery from transitions.

## Noise, AWGN, Detection, SNR, and Bit Error Probability

Every physical channel adds noise. One of the most important noise models is additive white Gaussian noise, abbreviated AWGN. Each word matters.

“Additive” means the received signal is the transmitted signal plus noise:

$$
r(t)=s(t)+n(t),
$$

where $s(t)$ is the transmitted signal and $n(t)$ is the noise. The receiver observes their sum.

“White” means the noise has constant power spectral density across frequency. In a two-sided frequency representation, the noise power spectral density is often written as

$$
\frac{N_0}{2}.
$$

The factor of $2$ appears because the two-sided model includes both positive and negative frequencies.

“Gaussian” means the noise amplitude follows a normal probability distribution. Typically, the mean is zero:

$$
\mu = 0.
$$

The variance $\sigma^2$ measures the average noise power in the relevant bandwidth.

A receiver never admits infinite bandwidth; it filters the incoming signal. If the receiver bandwidth is $B$, then the total noise power is obtained by integrating the constant two-sided spectral density over the interval from $-B$ to $B$:

$$
N = \sigma^2 = \left(\frac{N_0}{2}\right)(2B)=N_0B.
$$

This equation connects the frequency-domain view of noise to the probability-domain view. The same noise has a flat power spectral density and a Gaussian amplitude distribution. The variance of that Gaussian distribution equals the noise power in the receiver bandwidth.

Now consider binary detection. Suppose bit $0$ is represented by voltage $V_0$ and bit $1$ by voltage $V_1$. The receiver chooses a threshold voltage $V_T$. If the received voltage is above $V_T$, it decides $1$; if it is below $V_T$, it decides $0$. Without noise, this is easy. With noise, the received voltage for each transmitted bit becomes a random variable. If $0$ was sent, the received voltage is distributed around $V_0$. If $1$ was sent, it is distributed around $V_1$. Errors occur in the tails of these distributions: a transmitted $0$ may be pushed above the threshold, or a transmitted $1$ may be pulled below it.

The probability of bit error is therefore

$$
P_e
=
\Pr(0)\Pr(x>V_T\mid 0)
+
\Pr(1)\Pr(x<V_T\mid 1).
$$

If zeros and ones are equally likely, this becomes

$$
P_e
=
\frac{1}{2}Q\left(\frac{V_T-V_0}{\sigma}\right)
+
\frac{1}{2}Q\left(\frac{V_1-V_T}{\sigma}\right),
$$

where $Q(\cdot)$ is the Gaussian tail probability function. The $Q$-function gives the probability that a standard normal random variable exceeds a given value. A larger distance between the signal level and the threshold, measured in units of the noise standard deviation $\sigma$, gives a smaller error probability.

A simplified relation often used to connect detection performance to signal-to-noise ratio is

$$
P_e = Q\left(\sqrt{\left(\frac{S}{N}\right)_{\mathrm{in}}}\right),
$$

where $\left(S/N\right)_{\mathrm{in}}$ is the signal-to-noise ratio at the receiver input. This expresses an essential truth: bit errors are controlled by how clearly separated the received signal levels are compared with the noise.

In a digital communication system, one must distinguish input SNR and output SNR. The input SNR is mainly determined by the physical channel and its AWGN. The output SNR after PCM decoding depends not only on channel noise and bit errors but also on quantization. More quantization levels improve quantization SNR, while lower bit error probability improves the reliability of the received bit stream. Thus, the final reconstructed signal quality depends on both analog front-end conditions and digital representation choices.

Shannon’s channel capacity theorem gives the ultimate theoretical connection among bandwidth, power, and reliable information rate. For a channel of bandwidth $B$ and signal-to-noise ratio $S/N$, the capacity is

$$
C = B\log_2\left(1+\frac{S}{N}\right).
$$

This formula expresses a profound trade-off. Higher bandwidth increases capacity. Higher SNR also increases capacity, but only logarithmically. A system can be power-limited, bandwidth-limited, or both. If bandwidth is scarce, more sophisticated modulation and coding may be needed. If power is scarce, coding and low-noise receiver design become critical. Communication engineering is largely the art of operating close to these limits without violating physical, economic, and regulatory constraints.

## Modulation, Passband Transmission, and Physical Channels

So far, the signal may be imagined as occupying baseband, meaning its spectrum is centered near $0\,\mathrm{Hz}$. Baseband transmission can be practical in shielded or guided media such as some wired links or optical systems. But open-air radio transmission cannot allow every system to transmit around the same low-frequency region. Spectrum is shared, regulated, and allocated. Different services occupy different frequency bands. Therefore, signals are often shifted from baseband to passband by modulation.

A passband signal is centered around a carrier frequency $f_c$. Upconversion moves a baseband signal to a band around $f_c$; downconversion moves it back toward baseband at the receiver. A mixer accomplishes frequency translation by multiplying the signal by a sinusoid. Because multiplication in time corresponds to convolution in frequency, multiplying by a carrier shifts spectra.

Amplitude modulation is one of the simplest modulation schemes. In AM, the amplitude of a high-frequency carrier is varied according to a lower-frequency message signal $m(t)$. If $A_c$ is the carrier amplitude and $\omega_c$ is the carrier angular frequency, the envelope can be written as

$$
g(t)=A_c[1+m(t)],
$$

and the transmitted signal is

$$
s(t)=g(t)\cos(\omega_c t).
$$

The message is visible in the envelope: as $m(t)$ increases, the carrier amplitude grows; as $m(t)$ decreases, it shrinks. The maximum and minimum envelope values are

$$
A_c\left(1+\max[m(t)]\right)
$$

and

$$
A_c\left(1+\min[m(t)]\right).
$$

The percentage of modulation measures how strongly the carrier amplitude is varied:

$$
\%\mathrm{mod}
=
\frac{\max(m(t))-\min(m(t))}{2}\times 100\%.
$$

In ordinary AM with an unsuppressed carrier, not all transmitted power carries information. The sidebands contain the message; the carrier itself consumes power but does not carry new message content. The modulation efficiency is

$$
\eta_{\mathrm{mod}}
=
\frac{\langle m^2(t)\rangle}{1+\langle m^2(t)\rangle}\times 100\%,
$$

where $\langle m^2(t)\rangle$ is the mean-squared value of the modulating signal. For a sinusoidal message,

$$
\langle m^2(t)\rangle=\frac{1}{2}.
$$

Peak envelope power matters because transmitters must handle the largest instantaneous power demanded by the signal. With load resistance $R$, the normalized peak envelope power is

$$
P_{\mathrm{PEP,norm}}
=
\frac{1}{2R}[\max(|g(t)|)]^2
=
\frac{A_c^2}{2R}[1+\max(m(t))]^2.
$$

Envelope detection can demodulate ordinary AM when the envelope remains well behaved, but overmodulation causes distortion. If the modulation percentage exceeds $100\%$, the envelope crosses or folds in a way that a simple envelope detector cannot correctly follow. Distortion-free demodulation may then require coherent detection, where the receiver uses a properly synchronized carrier reference.

Double-sideband suppressed-carrier modulation removes the carrier and transmits only the sidebands, improving power efficiency but requiring coherent detection. Frequency modulation and phase modulation take a different approach: instead of varying carrier amplitude, they vary instantaneous frequency or phase. For FM, the modulation index and frequency deviation determine the spectrum. FM and PM spectra involve sidebands whose amplitudes can be described using Bessel functions. Carson’s rule gives a practical estimate of FM bandwidth. These schemes illustrate a recurring theme: modulation choices trade bandwidth, power efficiency, receiver complexity, and noise robustness.

The physical channel itself imposes further constraints. In free-space wireless propagation, power spreads over the surface of an expanding sphere, so received power decreases with distance. The Friis equation relates received power to transmitted power, antenna gains, wavelength, and distance. In more realistic ground-reflection conditions, received power may decrease approximately as $1/d^4$ rather than $1/d^2$ over some ranges. Obstacles create diffraction losses, such as knife-edge diffraction. Optical fiber has its own physical limits: attenuation, modal propagation, dispersion, and the distinction between single-mode and multi-mode operation. Wired, wireless, and optical channels differ, but they all force the same kind of engineering question: how can we preserve enough distinguishable structure in the received signal to recover the message?

## Reconstruction and the Meaning of “Digital”

At the receiver, successful communication is not finished when bits are detected. If the original message was analog, the receiver must turn the recovered samples back into a waveform. A digital-to-analog converter produces a staircase-like or pulse-based signal from the decoded sample values. A reconstruction low-pass filter then smooths the waveform and removes unwanted high-frequency components introduced by the sampling and holding process.

In the ideal sampling theory picture, reconstruction is possible because the sampled spectrum contains separated replicas of the original spectrum. An ideal low-pass filter selects the central replica and rejects the others. In reality, no filter is perfectly ideal. Practical systems therefore include guard bands, oversampling, pulse shaping, and anti-aliasing filters to make reconstruction feasible.

This completes the conceptual loop. The analog message is sampled under the Nyquist condition so that time discretization does not destroy information. The samples are quantized, accepting controlled amplitude error in exchange for a finite binary representation. The bits are coded and signaled through a physical channel, whose bandwidth, noise, and propagation properties constrain what is possible. The receiver detects symbols in noise, possibly corrects errors, decodes the bit stream, and reconstructs the waveform.

The deepest lesson is that digital communication is not a denial of analog reality. It is a disciplined way of managing analog reality. Every bit is carried by a waveform. Every waveform occupies bandwidth. Every channel adds noise. Every receiver makes decisions under uncertainty. Fourier analysis tells us what frequencies are required. Decibels let us track power through enormous dynamic ranges. Sampling theory tells us when discrete-time representation is faithful. Quantization tells us the cost of finite precision. Coding and detection tell us how to survive noise. Modulation tells us how to place signals into usable frequency bands. Bandwidth and SNR tell us the ultimate limits.

A communication system is therefore not just a pipeline of blocks. It is a sequence of negotiated compromises: time resolution against bandwidth, amplitude precision against bit rate, spectral efficiency against noise margin, power against error probability, simplicity against robustness, and ideal mathematical reconstruction against practical hardware. Understanding the system means seeing how each compromise is introduced, why it is necessary, and how it affects every later stage of the chain.

## Related notes

- [[from-analog-messages-to-digital-communication-signals-decibels-fourier-thinking-and-sampling-1777197492003|Week 1 Lecture Notes: From Analog Messages to Digital Communication: Signals, Decibels, Fourier Thinking, and Sampling]]
- [[fourier-analysis-of-signals-1777190840499|Fourier Analysis of Signals]]
- [[nyquist-sampling-criterion-1777190840499|Nyquist Sampling Criterion]]
- [[digital-communication-as-analog-to-digital-to-analog-transfer|Digital Communication as Analog-to-Digital-to-Analog Transfer]]
- [[bandwidth-and-time-variation-1777190840499|Bandwidth and Time Variation]]
- [[aliasing-and-nyquist-sampling-criterion|Aliasing and Nyquist Sampling Criterion]]
