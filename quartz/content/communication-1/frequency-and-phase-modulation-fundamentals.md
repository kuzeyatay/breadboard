---
title: "Frequency and Phase Modulation Fundamentals"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 121", "Page 122", "Page 123"]
related: ["fm-and-pm-modulation-indices-and-carsons-rule", "fm-and-pm-frequency-spectrum-via-bessel-functions", "amplitude-modulation-fundamentals"]
tags: ["frequency-modulation", "phase-modulation", "instantaneous-frequency", "complex-envelope", "phase-deviation"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-121-2.png", "/communication-1/assets/communications-1-coursereader-page-122-2.png"]
---

## Frequency and Phase Modulation Fundamentals

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 121, Page 122, Page 123

Frequency modulation (FM) and phase modulation (PM) are introduced as constant-amplitude modulation methods in which information is carried by angle variations rather than amplitude changes. The complex envelope is written as $g(t)=A_c e^{j\theta(t)}$, giving the real transmitted signal $s(t)=\Re\{g(t)e^{j\omega_c t}\}=A_c\cos(\omega_c t+\theta(t))$. In FM, the phase term depends on the time integral of the message, $\theta(t)=D_f\int_{-\infty}^{t} m(\tau)\,d\tau$, and the instantaneous frequency deviation is $f_d(t)=\frac{1}{2\pi}\frac{d\theta(t)}{dt}=\frac{D_f}{2\pi}m(t)$. In PM, the phase is directly proportional to the message: $\theta(t)=D_p m(t)$. Because the amplitude remains constant in both schemes, amplitude noise has less impact than in AM. The chapter motivates FM and PM as methods that can improve fidelity and noise resistance in modern communication systems.

### Source snapshots

![Communications_1_CourseReader Page 121](/communication-1/assets/communications-1-coursereader-page-121-2.png)

![Communications_1_CourseReader Page 122](/communication-1/assets/communications-1-coursereader-page-122-2.png)

### Page-grounded details

#### Page 121

Minilab exercise 11.1
This mini-lab exercise requires you to use Mini-lab 6 - AM/FM on MATLAB.
Please firstly try to figure out the modulation index from the details given in the
figure. Furthermore, use that information to obtain the modulation efficiency as
well. What are your findings?
To verify this, play around with both the "Message" and "AM Transmitter" options
within the Mini-lab. Provided you match the right input information, you should
receive the correct values which you can then transform into modulation efficiency.
- 1) Think about what type of detector one could use to decode the information.
- 2) Now set the carrier amplitude to 0V. What do you observe in the transmit-
ted signal? Can you still use the same method for detecting your transmission? [overlay,anchor=w
.
Minilab exercise 11.2
This mini-lab exercise requires you to use Mini-lab 6 - AM/FM on MATLAB.
Now we will analyze the effect of noise on the system. Firstly, select the frequency
of your message ton in the 'Message' tab. Furthermore, in the 'AM transmitter'
tab select an fc of 8kHz and Ac of 4V. Finally, go to the 'Channel' tab and enter a
value of 0.0005 for N0 and click on 'Add noise AM'. In the 'AM R

[Truncated for analysis]

#### Page 122

and enhanced resistance to noise, modern communication systems often employ frequency
modulation (FM) or phase modulation (PM). In both FM and PM the amplitude of the
transmitted signal remains constant, while the information is carried in the variations of
frequency or phase, respectively.
(a) Sinusoidal Modulating Signal
m(t )
Vp
f c
Ac
fc +∆F
fc 	∆F
0
t
fi (t )
s(t )
(b) Instantaneous Frequency of the Corresponding FM Signal
(c) Corresponding FM Signal
t
t
-
Figure 89: FM with a sinusoidal baseband modulating signal [2]
In frequency modulation (FM), the instantaneous frequency of the carrier is varied in
proportion to the baseband message signal. In other words, the carrier frequency deviates
from its nominal value depending on the amplitude of the modulating signal. This technique
provides improved noise immunity and a higher quality of signal reproduction. The complex
envelope of an FM signal is given by:
g(t) = Ac ejθ(t), (144)
so that the real, transmitted bandpass signal can be written as:
s(t) = ℜ{g(t)ejωct} = Ac cos

ωct + θ(t)

, (145)
where Ac is the constant carrier amplitude and θ(t) is a time-varying phase term that
encodes the information.
118

#### Page 123

In contrast, phase modulation (PM) directly varies the phase of the carrier in proportion
to the modulating signal. Although both FM and PM maintain a constant amplitude, they
differ in how the modulating signal m(t) influences the phase term θ(t). In FM the phase
is determined by the time integral of the message signal, while in PM the phase is directly
proportional to the modulating signal.
For FM the phase is given by:
θ(t) = Df
Z t
-∞
m(τ ) dτ, (146)
and the instantaneous frequency deviation can be expressed as:
fd(t) = 1
2π
dθ(t)
dt = Df
2π m(t), (147)
where Df is the frequency deviation constant. For PM the relationship is even simpler:
θ(t) = Dp m(t), (148)
with Dp representing the phase sensitivity. In both cases the carrier amplitude Ac is main-
tained constant, which minimizes the effect of amplitude noise.
10.7.1 Frequency and phase modulation index
We begin by defining the peak frequency deviation, which represents the maximum change
in the instantaneous frequency of the carrier signal due to modulation. In frequency modu-
lation (FM), the instantaneous frequency is determined by the time derivative of the phase,
θ(t), divided by 2π. Thus, the peak frequency deviation i

[Truncated for analysis]

### Key points

- FM and PM keep carrier amplitude constant.
- Information is encoded in phase or frequency variation.
- The complex envelope is $g(t)=A_c e^{j\theta(t)}$.
- The real transmitted signal is $s(t)=A_c\cos(\omega_c t+\theta(t))$.
- In FM, phase is proportional to the integral of the message.
- In PM, phase is directly proportional to the message.
- Constant amplitude reduces sensitivity to amplitude noise.

### Related topics

- [[fm-and-pm-modulation-indices-and-carsons-rule|FM and PM Modulation Indices and Carson's Rule]]
- [[fm-and-pm-frequency-spectrum-via-bessel-functions|FM and PM Frequency Spectrum via Bessel Functions]]
- [[amplitude-modulation-fundamentals|Amplitude Modulation Fundamentals]]

### Relationships

- contrasts-with: [[amplitude-modulation-fundamentals|Amplitude Modulation Fundamentals]]
