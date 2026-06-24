---
title: "Modelling ISI in a baseband pulse transmission system"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 89"]
related: ["inter-symbol-interference-from-bandwidth-limited-channels", "nyquist-zero-isi-criterion-and-ideal-sinc-pulses", "raised-cosine-nyquist-filtering"]
tags: ["isi", "nyquist-first-criterion", "convolution", "impulse-response", "baseband-transmission"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-089-2.png"]
---

## Modelling ISI in a baseband pulse transmission system

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 89

The text models ISI by representing a baseband digital system as a cascade of an input pulse source, transmitter filter, channel filter, and receiver filter. The input signal is written as a sum of pulse-shaped symbols, $$w_{in}(t) = \sum_n a_n h(t-nT_s) = \sum_n a_n\delta(t-nT_s) * h(t).$$ The output is then the convolution of the input with the transmitter, channel, and receiver responses, which can be grouped into an overall equivalent impulse response $h_e(t)$. In the frequency domain, the overall transfer is $$H_e(f)=H(f)H_T(f)H_C(f)H_R(f).$$ This model makes the origin of ISI explicit: even if the transmitted pulse $h(t)$ is rectangular, channel filtering changes the overall pulse shape so that its energy spills into adjacent symbol times. The section then states the condition for zero ISI at the sampling instants: the equivalent pulse must equal a constant at its own symbol time and zero at all other integer multiples of $T_s$. This is Nyquist's first criterion and provides the design goal for transmit and receive filtering.

### Source snapshots

![Communications_1_CourseReader Page 89](/communication-1/assets/communications-1-coursereader-page-089-2.png)

### Page-grounded details

#### Page 89

8.4 Modelling ISI
Transmitting
filter
H T (f )
Channel (filter)
characteristics
H C (f )
Receiver
filter
H R (f ) 	Recovered rounded
pulse (to sampling
and decoding
circuits)
Flat-top
pulses
win(t ) 	wc(t ) 	wout(t )
Figure 61: Base-band pulse-transmission system [2, ch. 3-6, p. 208]
Consider a digital signaling system (baseband) as in Fig. 61. Assume that the input pulses
to this system win(t), are as follows
win(t) = X
n
anh(t - nTs) = X
n
anδ(t - nTs) ∗ h(t) (103)
where h(t) = Q( t
Ts ) represent rectangular pulses. Now wout can be written as the convo-
lution of the input signal win(t) with the overall system transfer characteristic, which is
the convolution between the transmitting filter HT , channel filter characteristics HC and
receiver filter characteristics HR.
wout(t) = win(t) ∗ hT (t) ∗ hC (t) ∗ hR(t) = (X
n
anδ(t - nTs)) ∗ he(t) (104)
where he(t) is the individual impulse response, written as
he(t) = h(t) ∗ hT (t) ∗ hC (t) ∗ hR(t) (105)
And the representation in the frequency domain is
He(f ) = H(f )HT (f )HC (f )HR(f ) (106)
Essentially, Eq. 105, is the overall impulse response of the individual pulses that are trans-
mitted with amplitude an, where the amplitude may

[Truncated for analysis]

### Key points

- The baseband system is modeled with transmit, channel, and receive filters.
- The input waveform is a sum of shifted symbol pulses weighted by amplitudes $a_n$.
- The output waveform is the convolution of the input with the overall system response.
- The equivalent impulse response is $h_e(t) = h(t) * h_T(t) * h_C(t) * h_R(t)$.
- The equivalent frequency response is $H_e(f)=H(f)H_T(f)H_C(f)H_R(f)$.
- Zero ISI requires the equivalent pulse to be nonzero only at its own sampling instant.

### Related topics

- [[inter-symbol-interference-from-bandwidth-limited-channels|Inter-symbol interference from bandwidth-limited channels]]
- [[nyquist-zero-isi-criterion-and-ideal-sinc-pulses|Nyquist zero-ISI criterion and ideal sinc pulses]]
- [[raised-cosine-nyquist-filtering|Raised-cosine Nyquist filtering]]

### Relationships

- depends-on: [[nyquist-zero-isi-criterion-and-ideal-sinc-pulses|Nyquist zero-ISI criterion and ideal sinc pulses]]
