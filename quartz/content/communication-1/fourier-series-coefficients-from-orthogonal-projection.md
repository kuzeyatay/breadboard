---
title: "Fourier Series Coefficients from Orthogonal Projection"
date: "2026-04-26T07:08:26.047Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "988929-english-3"
source_file: "988929_English-3.pdf"
locations: ["Page 9", "Page 10"]
related: ["vector-projection-analogy-for-signal-decomposition", "period-fundamental-frequency-and-harmonics", "square-wave-decomposition-and-symmetry"]
tags: ["fourier-series-coefficients", "cosine", "sine", "integral", "period", "week-1"]
source_images: ["/communication-1/assets/988929-english-3-page-009.png", "/communication-1/assets/988929-english-3-page-010.png"]
---

## Fourier Series Coefficients from Orthogonal Projection

Source: [[988929-english-3|Communication 1 Course Introduction and Foundations of Digital Communication]]

Locations: Page 9, Page 10

The lecture introduces Fourier series coefficients as the signal-analysis counterpart of vector projections. To determine how much of a basis function is present in a periodic signal $f(t)$, one multiplies $f(t)$ by the basis function and integrates over a period. If the result is zero, that frequency component is absent. The lecture writes this idea first in cosine terms and then in complex-exponential form, naming the resulting coefficients $C_k$. In this framework, the coefficients quantify how much of each harmonic is present in the original function. This topic is the mathematical bridge between the vector analogy and practical frequency-domain analysis of periodic signals.

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

### Key points

- Projection onto basis functions is performed by multiplication and integration over a period.
- If the projection result is zero, the corresponding basis component is absent.
- The lecture first explains the idea using cosine basis functions.
- Fourier series coefficients are denoted by $C_k$.
- The complex exponential basis is used to represent both cosine and sine behavior.

### Related topics

- [[vector-projection-analogy-for-signal-decomposition|Vector Projection Analogy for Signal Decomposition]]
- [[period-fundamental-frequency-and-harmonics|Period, Fundamental Frequency, and Harmonics]]
- [[square-wave-decomposition-and-symmetry|Square-Wave Decomposition and Symmetry]]

### Relationships

- depends-on: [[period-fundamental-frequency-and-harmonics|Period, Fundamental Frequency, and Harmonics]]
