---
title: "Square-Wave Decomposition and Symmetry"
date: "2026-04-26T07:08:26.047Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "988929-english-3"
source_file: "988929_English-3.pdf"
locations: ["Page 9", "Page 10", "Page 11"]
related: ["vector-projection-analogy-for-signal-decomposition", "fourier-series-coefficients-from-orthogonal-projection", "discrete-spectrum-and-sinc-envelope-for-periodic-signals", "period-fundamental-frequency-and-harmonics"]
tags: ["square-wave", "symmetry", "cosine", "sine", "week-1", "week-5"]
source_images: ["/communication-1/assets/988929-english-3-page-009.png", "/communication-1/assets/988929-english-3-page-010.png"]
---

## Square-Wave Decomposition and Symmetry

Source: [[988929-english-3|Communication 1 Course Introduction and Foundations of Digital Communication]]

Locations: Page 9, Page 10, Page 11

The lecture uses the square wave as a worked conceptual example for Fourier decomposition. A square wave can be reconstructed by adding sinusoidal components with carefully chosen amplitudes. The instructor emphasizes that not all harmonics are necessarily present, and that signal symmetry determines which basis functions appear. For an antisymmetric waveform, cosine terms vanish while sine terms remain, because cosine is symmetric but the centered square-like waveform is antisymmetric. This example shows how Fourier analysis is not only about calculating coefficients, but also about using waveform symmetry to predict structure in the spectrum.

### Source snapshots

![988929_English-3 Page 9](/communication-1/assets/988929-english-3-page-009.png)

![988929_English-3 Page 10](/communication-1/assets/988929-english-3-page-010.png)

### Page-grounded details

#### Page 9

We had we had two very dedicated teaching assistants and They went out of their way
to create amazing Matlab content for you which illustrates the basic principles
behind the topic we discuss We we call these things mini labs, and they're still
available There are apps for Matlab, which you can download and Run on your Matlab
code which you all have installed in your laptops And They will really take you
through the basic Functionality of something so the mini lab number one for example
is about Fourier series you get a an interface where you can look at the different
harmonics of a signal and Change their strength and try to reconstruct the script a
square wave or a triangular wave for example. This is what we are Talking about so
this is an example of the mini labs every week. There will be different mini labs
again And not part of the you don't have to do them if you want to go deeper You
can use them to to do and they'll be probably every week a few more additional
practices because over the years we accumulate a lot of canvas quizzes and They are
for practicing, so why not give them all of just can practice. It's good for you
That was that yes Okay, so we were we were busy wit

[Truncated for analysis]

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

- A square wave can be represented as a sum of sinusoidal components.
- Each component must have the correct amplitude to reconstruct the waveform.
- Not all harmonic components are present in every waveform.
- Signal symmetry determines whether cosine or sine terms appear.
- An antisymmetric waveform leads to sine-only behavior in the decomposition.

### Related topics

- [[vector-projection-analogy-for-signal-decomposition|Vector Projection Analogy for Signal Decomposition]]
- [[fourier-series-coefficients-from-orthogonal-projection|Fourier Series Coefficients from Orthogonal Projection]]
- [[discrete-spectrum-and-sinc-envelope-for-periodic-signals|Discrete Spectrum and Sinc Envelope for Periodic Signals]]
- [[period-fundamental-frequency-and-harmonics|Period, Fundamental Frequency, and Harmonics]]

### Relationships

- example-of: [[fourier-series-coefficients-from-orthogonal-projection|Fourier Series Coefficients from Orthogonal Projection]]
- depends-on: [[period-fundamental-frequency-and-harmonics|Period, Fundamental Frequency, and Harmonics]]

## Added from [[997203-english|Decibels, Fourier Representation, Digital Sampling, and Nyquist Reconstruction]]

Source label: upload

Locations: Page 4, Page 5

The lecture explains harmonic decomposition of a square wave using the orthogonality principle. To determine whether a harmonic contributes to the square wave, one multiplies the square wave by a sine or cosine function and integrates over a period. For some harmonics, positive and negative areas cancel, producing no contribution. The lecturer specifically says the second harmonic does not contribute because its positive part is canceled by its negative part, and the same behavior holds for all even harmonics, including the fourth harmonic. Odd harmonics do contribute, with the first harmonic being the largest and higher odd harmonics, such as the third, contributing smaller amounts. This example shows how Fourier coefficients arise from integrals and why a square wave spectrum has a structured harmonic content.

### Source snapshots

![997203_English Page 4](/communication-1/assets/997203-english-page-004.png)

![997203_English Page 5](/communication-1/assets/997203-english-page-005.png)

### New key points

- A square wave can be decomposed into harmonic sine or cosine components.
- Contribution is determined by multiplying the waveform by a harmonic and integrating over a period.
- The second harmonic cancels because positive and negative areas cancel.
- All even harmonics have the same cancellation behavior.
- Odd harmonics contribute to the square wave representation.
- The first harmonic has the largest contribution, while higher odd harmonics contribute less.
