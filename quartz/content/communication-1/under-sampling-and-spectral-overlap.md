---
title: "Under-Sampling and Spectral Overlap"
date: "2026-04-26T07:24:06.018Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "997203-english"
source_file: "997203_English.pdf"
locations: ["Page 8", "Page 10"]
related: ["aliasing-and-nyquist-sampling-criterion", "spectral-replication-from-sampling", "ideal-low-pass-reconstruction"]
tags: ["under-sampling", "nyquist-criteria", "spectral-overlap", "a-f", "s-f"]
source_images: ["/communication-1/assets/997203-english-page-008.png", "/communication-1/assets/997203-english-page-010.png"]
---

## Under-Sampling and Spectral Overlap

Source: [[997203-english|Decibels, Fourier Representation, Digital Sampling, and Nyquist Reconstruction]]

Locations: Page 8, Page 10

The lecture explains under-sampling first in the time domain and then in the frequency domain. In the time domain, if there are too few samples per cycle, the receiver can connect the dots in a way that represents a different waveform from the original. In the frequency domain, the repeated spectral copies created by sampling become too close together when the sampling frequency is below the Nyquist condition. If $f_s$ is less than $2B$, where $B$ is the maximum signal bandwidth or highest frequency extent, adjacent copies of $A(f)$ overlap. The lecturer gives an example where $f_s$ is only $1.5B$, causing overlap between the central copy and the neighboring copy. Because the sampled spectrum is the sum of all copies, the overlapping region merges contributions and loses information about the original spectrum. This loss prevents perfect reconstruction.

### Source snapshots

![997203_English Page 8](/communication-1/assets/997203-english-page-008.png)

![997203_English Page 10](/communication-1/assets/997203-english-page-010.png)

### Page-grounded details

#### Page 8

If I want to sample a signal, I'm gonna sample it. I'll get the samples. And the
first question is, how close do I need to put these sampling points? Yes. We said
sampling frequency needs to be at least twice the highest frequency of the wave.
Thank you. So this is something you've learned. It's called the Nyquist criteria,
right? If you want to sample a signal, you need to sample at least twice the
frequency of the signal. So this signal, let's assume for the sake of the
discussion that the highest frequency in this wave is 100 hertz. So somewhere, if
I'll do a Fourier transform, because this is a not periodic signal, if I do Fourier
transform of the signal and I look at the spectrum I get, I will see that spectrum,
there's a spectrum for this. So if I draw A of F, this is the A of F is the Fourier
transform of this. I will see something. And here, this is 100 hertz. It ends.
There's nothing more. Okay, that's the spectrum of A of T. It's called A of F and
it has a finite spectrum. So there is a somewhere, a wave at 100 hertz, which is
included in this. It needs to be represented. It's part of the signal, this is 100
hertz, so this will be 10 milliseconds. So what does it mean sam

[Truncated for analysis]

#### Page 10

f zero. How best to do it? I don't know how best to do it. It's a mathematical fact
that when you convolute something with a displaced delta function, you get the
function centered around that new frequency. You can look at it from how you
integrate this and what does it mean to do the integration. I don't wanna spend too
much time on it. It's just pure mathematics, but this is an important outcome of
this calculation because it means, and that's important. So I apologize if I skip
the math here, but it is the result of convoluting with the delta function, this is
the space. And if you take my word for it for a minute, it means that what we have
here is an infinite sum. So this is the spectrum of the sample signal. So the
spectrum of the sample signals is an infinite sum of the original spectra of our
signal, repeated again and again and again in the spectral domain. Basically we're
occupying, for a better word, the entire spectrum from minus infinity to plus
infinity with copies of the original signal. You can also draw this and for drawing
it, I will dramatically simplify the spectrum A of F because it's difficult to draw
these wiggly lines every time. So if A of F spectrum looks

[Truncated for analysis]

### Key points

- Under-sampling occurs when the sampling frequency is below the Nyquist requirement.
- Too few time-domain samples can make the receiver infer the wrong waveform.
- Sampling produces repeated spectral copies of the original spectrum.
- If $f_s<2B$, adjacent spectral copies overlap.
- The lecture illustrates overlap with $f_s=1.5B$.
- Overlapping spectra add together, causing information loss.

### Related topics

- [[aliasing-and-nyquist-sampling-criterion|Nyquist Criterion]]
- [[spectral-replication-from-sampling|Spectral Replication from Sampling]]
- [[ideal-low-pass-reconstruction|Ideal Low-Pass Reconstruction]]

### Relationships

- depends-on: [[spectral-replication-from-sampling|Spectral Replication from Sampling]]
- contrasts-with: [[aliasing-and-nyquist-sampling-criterion|Nyquist Criterion]]
