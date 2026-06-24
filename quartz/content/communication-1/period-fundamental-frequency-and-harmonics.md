---
title: "Period, Fundamental Frequency, and Harmonics"
date: "2026-04-26T07:08:26.047Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "988929-english-3"
source_file: "988929_English-3.pdf"
locations: ["Page 10", "Page 11"]
related: ["fourier-series-coefficients-from-orthogonal-projection", "bandwidth-and-faster-time-variation", "square-wave-decomposition-and-symmetry"]
tags: ["period", "fundamental-frequency", "omega-0", "harmonics", "kilohertz"]
source_images: ["/communication-1/assets/988929-english-3-page-010.png", "/communication-1/assets/988929-english-3-page-011.png"]
---

## Period, Fundamental Frequency, and Harmonics

Source: [[988929-english-3|Communication 1 Course Introduction and Foundations of Digital Communication]]

Locations: Page 10, Page 11

The lecture emphasizes that the frequencies used in Fourier decomposition are not arbitrary. They are tied to the period of the signal through the fundamental frequency. If a signal has period $T$, then its base frequency is $f_0 = 1/T$, with angular frequency $\omega_0 = 2\pi f_0 = 2\pi/T$. Harmonics then occur at integer multiples of this base frequency, indexed by integer $k$. The instructor gives concrete examples such as a 2 ms period corresponding to 500 Hz, and explains that if the period becomes shorter, the corresponding base frequency increases. This creates the conceptual link between time scale and required spectral content.

### Source snapshots

![988929_English-3 Page 10](/communication-1/assets/988929-english-3-page-010.png)

![988929_English-3 Page 11](/communication-1/assets/988929-english-3-page-011.png)

### Page-grounded details

#### Page 10

is zero if I do that It means that in order to write ft.
I don't need cosines omega zero t. I don't need it It's not there same as when I
multiply the vector 1 2 0 by 0 0 1 I get 0 means There's nothing in the z direction
It's exactly the same. That's why I draw this picture all the time because it it
illustrates very clearly What is the what's the idea of a projection? We project
here a vector on the base three vectors of the XYZ Okay, here we project a function
on a base function and we ask is there any thing in ft? Which looks like cosine
omega zero t the answer is no if the answer to the things right zero It means that
ft does not include cosine omega zero t Is that clear? It's very fundamental very
basic idea about projection very basic idea about how you reconstruct waveforms, so
we need To look for all of these Components we call them Fourier series
coefficients and in the in the textbook we We explain in details how we calculate
them, and I have even here somewhere Calculation it's all in textbook.
We call these values Ck special for them check and then We do this and instead of
having your omega zero we do two pi and ft or K because we need to introduce the
Okay One over T

[Truncated for analysis]

#### Page 11

gonna use the frequency as we want.
Oh, something's burning a fire brigade Yeah, that's a joke Hopefully, I'll do the
term is burning You will tell us, huh? Okay, very good.
Okay, we're safe the rest can burn so if If my my pulses are faster if I want this
information faster shorter pulses because I want the information faster I will need
more frequency There is not Infinite frequency I can use it's for some application
It's actually something you pay for and some application something that it's just
difficult to generate so sometimes difficult but these base frequency this and of
course every in principle every harmonic of that frequency can potentially be part
of the way I Reconstruct the signal not always not for all signals.
They have different symmetries. For example, this wave as I drew it here And this
is the zero is an anti symmetric function It's a function.
It means that if I move the Zero line to here.
It looks like it looks almost like a sine function because it has This behavior
Around this this line, which is just a fixed value It really looks like a sine
function It does mean That if I try to build the series the composition of this I
will not find any cosine functio

[Truncated for analysis]

### Key points

- The basis frequencies in a Fourier series are determined by the signal period.
- The fundamental frequency is $f_0 = 1/T$.
- The angular fundamental frequency is $\omega_0 = 2\pi/T$.
- Harmonics occur at integer multiples $k\omega_0$.
- A shorter period implies a higher base frequency.

### Related topics

- [[fourier-series-coefficients-from-orthogonal-projection|Fourier Series Coefficients from Orthogonal Projection]]
- [[bandwidth-and-faster-time-variation|Bandwidth and Faster Time Variation]]
- [[square-wave-decomposition-and-symmetry|Square-Wave Decomposition and Symmetry]]

### Relationships

- enables: [[bandwidth-and-faster-time-variation|Bandwidth and Faster Time Variation]]
