---
title: "Probability Density from the Wave Function"
date: "2026-06-25T06:11:11.299Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "983068-english-1"
source_file: "983068_English-1.pdf"
locations: ["Page 13", "Page 14"]
related: ["complex-wave-functions-and-real-measurements", "normalization-of-quantum-probability", "expected-position-and-uncertainty"]
tags: ["particle-state-is-encoded-by-psi", "absolute-square-removes-imaginary-phase", "probability-over-intervals-uses-density", "wave-function-squared-gives-probability-density"]
source_images: ["/physics-for-ee/assets/983068-english-1-page-013.png", "/physics-for-ee/assets/983068-english-1-page-014.png"]
---

## Probability Density from the Wave Function

Source: [[983068-english-1|Schrodinger Equation, Wave Functions, and Probability Interpretation]]

Locations: Page 13, Page 14

The lecture defines the physical meaning of the wave function through probability density. The wave function $\psi$ describes the state of a particle, and its absolute value squared, $|\psi|^2$, is the probability density function. This density is not itself the probability of a single point; rather, it gives the density used to compute the chance of finding a particle in an interval. For a small interval from $x$ to $x + \Delta x$, the probability is determined from the probability density over that interval at time $t$. Because $\psi$ is complex, the absolute square must be computed from both real and imaginary parts. This topic is central because it translates the abstract complex wave solution of Schrodinger's equation into experimentally meaningful position probabilities.

### Source snapshots

![983068_English-1 Page 13](/physics-for-ee/assets/983068-english-1-page-013.png)

![983068_English-1 Page 14](/physics-for-ee/assets/983068-english-1-page-014.png)

### Page-grounded details

#### Page 13

cosine of that argument and then we see that.
Okay, this does not make sense yet Let's try to make sense of it.
So we do get the factor h bar omega and H bar squared k squared over 2m, which was
the factor we needed to get so we want this to be equal So this on the right hand
side cancels against that on the left hand side if we want that factor to hold And
then we find this expression So we get a cosine Plus B sine equals CA sine minus CB
cosine So this can only hold if C times B Equals minus C times B equals a and if B
equals C times a Only then we get a valid solution, right signs the amplitude in
front of the sign Have to be equal and the amplitudes in front of the cosine have
to be only then this holds So we get a equals minus CB and B equals CA And if we
substitute B into here we get a equals minus C squared times a So C squared equals
minus one So then C should be square root of minus one So plus or minus I
Convention is to choose I here C being the imaginary number.
It's not nice that we got complex numbers, but sorry What your seven is not for you
then? so what we then get is Well, if C equals I then B equals I times a So we can
put that in the solution we have But this so

[Truncated for analysis]

#### Page 14

density of finding a particle at a position if you want to have the Calculate the
chance of finding a particle at say a small interval on X you define X And X plus
Delta X so a small interval on the X axis Then this is the chance of finding that
particle there at time t and We have to bear in mind that psi is complex So the
absolute value squared is the real part squared plus the imaginary part squared. So
that's Well, what you have to take in mind keep in mind when doing these
calculations.
So let's have two slides on probability So probability P on event is always ranging
from 0 to 1 If it's 0, it's not possible if it's 1 it's certain and the chance of
finding a particle at a position Less than X 1 Follows from an integral over the
probability density function up to that point So from minus infinity to X 1 is the
chance of finding a particle at position X 1 So depending on the shape of the
probability density function It's well, it's likely or not likely to find it We
also know that the probability of finding the particle everywhere Should be one
because particle has to be somewhere So if I would integrate from minus infinity to
plus infinity, I would get one this is called norma

[Truncated for analysis]

### Key points

- $\psi$ describes the state of a particle.
- $|\psi|^2$ is defined as the probability density function.
- Probability density describes the density of finding a particle at a position.
- The chance of finding a particle in a small interval uses the density over that interval.
- The example interval is from $x$ to $x + \Delta x$.
- The probability depends on time $t$ because the wave function can change with time.
- For complex $\psi$, $|\psi|^2$ is real part squared plus imaginary part squared.

### Related topics

- [[complex-wave-functions-and-real-measurements|Complex Wave Functions and Real Measurements]]
- [[normalization-of-quantum-probability|Normalization of Quantum Probability]]
- [[expected-position-and-uncertainty|Expected Position and Uncertainty]]

### Relationships

- depends-on: [[normalization-of-quantum-probability|Normalization of Quantum Probability]]
- enables: [[expected-position-and-uncertainty|Expected Position and Uncertainty]]
