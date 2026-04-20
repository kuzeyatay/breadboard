---
title: "986217_English"
date: "2026-04-20T07:28:03.411Z"
source: "upload"
knowledge_type: "source-document"
source_type: "pdf"
source_file: "986217_English.pdf"
generated_by: "chatmock"
topics: []
tags: ["english", "there", "you", "birthday-treat", "there-birthday", "there-more", "treat-break", "day-there", "see-you", "wave-functions"]
source_images: ["/test-2/assets/986217-english-page-001.png", "/test-2/assets/986217-english-page-002.png", "/test-2/assets/986217-english-page-003.png", "/test-2/assets/986217-english-page-004.png", "/test-2/assets/986217-english-page-005.png", "/test-2/assets/986217-english-page-006.png", "/test-2/assets/986217-english-page-007.png", "/test-2/assets/986217-english-page-008.png", "/test-2/assets/986217-english-page-009.png", "/test-2/assets/986217-english-page-010.png", "/test-2/assets/986217-english-page-011.png", "/test-2/assets/986217-english-page-012.png", "/test-2/assets/986217-english-page-013.png", "/test-2/assets/986217-english-page-014.png", "/test-2/assets/986217-english-page-015.png"]
source_pdf: "/test-2/assets/986217-english-source.pdf"
---

## Summary

Please take your seats. I'm going to start Welcome to this special day There will
be a birthday treat in the break. There will be a birthday treat in the break so No
need no need and there's more special things today. I'm wearing my Korskizak
sweater, which I like And there's more but I Will not dis

## Knowledge tree

- No knowledge topics were extracted.

## Source material

# Lecture Notes: Quantum Mechanics, Wave Functions, and Entanglement

## Opening Remarks

- **Welcome:** Please take your seats. I'm going to start.
- **Special day:** There will be a birthday treat in the break, so no need to worry.
- **More special things:** I'm wearing my Korskizak sweater, which I like, and there are more special things today, but I will not disclose all of them.
- **Plan:** Let's start with a quiz question to see if you understand the topic of the previous lecture. Let's see if you're ready to vote.

---

## Quiz Review: Interpreting Energy Formulas

There was discussion going on, which is good. These are things you could answer from your formula sheet. You have to interpret the formulas there.

- **Options:** Who would go for A, B, C, D, or E?
- **Most voted:** Most voted C, and that's indeed correct.

### Key interpretation

- **Kinetic energy:** Proportional to `1 / n^2`
  - Higher `n` means lower kinetic energy.
- **Total energy:** Proportional to `-1 / n^2`
  - Higher `n` means less negative, so higher energy.

You should be able to interpret these formulas.

---

## Program for Next Week

### Monday: Guest Lecture

On Monday, we will have a guest lecture by a colleague of ours-well, not of yours, of mine.

- **Guest lecturer:** Yasmina
- **Topic:** Space applications

She will cover two topics:

- **Observational astronomy:** How the properties of light across the spectrum can help identify what happens in the universe.
- **Space applications:** Likely in that order.

This will be:

- **Duration:** Two times 45 minutes

This is a very nice outlook on what you can do as an electrical engineer after your studies.

### Hours 3 and 4

- **Exam training:** I will go in detail through exams that are listed on Canvas.

### Midterm results

You are probably quite curious about how you scored on the midterm test.

- **Availability:** These results should be available by tomorrow at the end of the day.
- **Official grading window:** We officially have ten working days to grade these, and we have needed those.
- **Fairness:** I try to have two pairs of eyes look at all problems, which makes for the most fair assessment.
- **Release:** We will release them by the end of tomorrow.

### Next week

- **No lecture / no instructions:** There is no lecture nor instructions.
- **Use of time:** You can use that to prepare for your exam week already.
- **Exam timing:** Our exam is in the second week on Monday afternoon.

---

## Recap of Previous Lecture

Previously, on Monday, I discussed:

- **Bohr model of the atom**
- **The laser**
- **Blackbody radiation**
- **Derivation of Schrödinger's equation** for a 1D case

We also looked at:

- **Interpretation of wave functions**

Today, I will start a bit earlier than where I left off last Monday.

### Today's focus

- **Wave functions:** How they are formed
- **Superposition:** How superposition of wave functions can generate wave packets

This was covered a bit too quickly last Monday, so I will repair that now.

### Chapter coverage

- **Chapter 40:** Most of today's material
- **Chapter 41:** One section on entanglement

Entanglement is a relevant topic in quantum computing.

---

## Wave Functions and the Free Particle

We had Schrödinger's equation for a free particle.

### Important point

- **Imaginary unit:** This equation contains the imaginary number `i`

Still, we are going to describe wave-like things, namely wave functions. So it makes sense that there is some argument in there, some function that captures the periodic nature of wave functions.

That is captured in the exponential term here, which has both:

- **Spatial part**
- **Temporal part**

But the world around us is real-valued, so we have to somehow make sense of that.

### Probability density

For that, we need:

- **Absolute value squared of the wave function:** `|ψ|^2`

I'll come back to what that means in a second.

---

## Momentum and Energy of a Free Particle

For the free particle:

- **Momentum:** `ħk`
- **Energy:** `hf` or `ħω`

If you would plot that as a snapshot of the exponential, for example at:

- **Time:** `t = 0`

then you could draw its spatial behavior:

- **Real part**
- **Imaginary part**

if you have multiple wave functions.

---

## Why a Single Free-Particle Wave Function Is Not Localized

This wave function, as given here, describes a particle that is **not localized**.

- **Extent in space:** It is everywhere in space.
- **At one instant:** The cosine continues indefinitely for the whole x-axis.

To look at the probability density, we have to do a calculation.

- **We square the probability amplitude**
- **We examine what comes out**

If you have a complex-valued function, then the square of the magnitude is:

- **Complex conjugate times the function itself**

For example, if you have `A + iB`, then the length squared is:

- `A^2 + B^2`

You get that by multiplying:

- `(A - iB)(A + iB)`

because `-i^2 = +1`.

### Application to wave functions

So we need the **complex conjugate** of the wave function.

That means:

- Everywhere there is an `i`, we replace it with `-i`.

So the complex conjugate has:

- `-ikx`
- `+iωt`

Then we can calculate the result.

### Result

- **Probability density:** A constant
- **Reason:** Amplitude conjugate times amplitude = amplitude squared
- **Meaning:** It is constant throughout space

So this does **not** locate the particle anywhere on the x-axis.

---

## Superposition of Two Wave Functions

If you have two wave functions, so a superposition of:

- one with subscript 1
- one with subscript 2

then we can also calculate the probability density.

Again, we need the complex conjugate, which is the same but with minus signs in front of the `i`s.

After some lengthy trigonometry, the resulting probability density has a shape that varies in space.

If we look at a fixed time, for example:

- `t = 0`

then the plotted result varies between:

- **0**
- **`4a^2`**

along space.

### Interpretation

This already says the probability is **not constant** over space.

- **Constant part:** Present
- **Spatially varying part:** Also present

So:

- At certain points in space, there is almost zero probability of finding the particle.
- At certain points in space, there is a maximum probability of finding the particle.

---

## Toward the Wave Packet

We are still talking about ideal cases here.

In reality, what you have is:

- **A wave packet**

That is the next step. Then the particle is localized in space.

In the examples today, we will apply Schrödinger's equation to three examples where you will see that the particle has to be localized somewhere.

### Key point

- **Ideal case:** Extends infinitely
- **Practical use:** Limited
- **Main idea:** If you have multiple wave functions together, you can get localizing effects

So this is the step toward the wave packet.

### What happens

You superimpose more of these wave functions to really find something that is confined in space, such that the probability density function is also confined in space.

This is what I talked about on Monday, but I think these two slides in front of it help explain why this is possible.

---

## Wave Packets and Fourier Ideas

You make a sum of several pulses, several wave functions, and together this results in:

- **An average wavelength**
- **An average `Δx`** over which the pulse spans

Then the probability can be written in terms of a range of wave numbers.

### Two-component case

With only two components, you have:

- `k1`, `ω1`
- `k2`, `ω2`

### General case

You can have a range of wave numbers that describe the spatial behavior, and for each wave number you can have a different amplitude.

In this way:

- **Superposition of signals** generates wave packets

This is also how:

- **Fourier integrals** work
- **Fourier series** as well, but then with discrete wave numbers

### Probability density of a wave packet

The resulting probability density then has:

- **One maximum**

This is the real part squared plus the imaginary part squared, and it gives a probability density function confined in space.

It spans a range `Δx`, which would be the range in which you could find the particle.

- **Most likely position:** Around zero, because there the probability density is highest
- **Also possible:** You can find it elsewhere in the packet, because probabilities are distributed

### Wave-particle character

This localized pulse:

- **Has wave-like nature:** Because it consists of wave components
- **Has particle-like nature:** Because it is localized in space

There is a finite interval `Δx` in space in which you can find the particle.

If you integrate over the whole probability density function, then you have seen the particle because it has to be somewhere in that range.

---

## Width in Position and Width in Wave Number

You can have:

- **A wide probability density function**
- **A narrow probability density function**

So:

- A **large span in `Δx`**
- Or a **small span in `Δx`**

This relates to:

- **A small range of wave numbers**
- Or a **large range of wave numbers**

contributing to the wave pulse.

### Practical integration

In practice, what you do is integrate only over the region where there are values.

Mathematically, it is often written as:

- from `-∞` to `+∞`

but in practice you integrate only where the function is nonzero or significant.

### Fourier analogy

If you have:

- **A wideband signal in frequency domain:** You get a narrow pulse in time domain
- **A narrow frequency content:** You get a broad pulse

For now, it is enough to understand that:

- **Wave packets are a way to localize particles**

---

## Link to Heisenberg's Uncertainty Principle

Indeed, this `Δx` is the `Δx` from Heisenberg's uncertainty principle.

- **Uncertainty relation:** `Δx Δp = ħ/2`

So:

- **Uncertainty in position:** Relates to the width of the wave function
- **Uncertainty in momentum:** Relates to the width in k-space

You cannot choose these independently.

- If you choose one infinitely small, the other becomes infinitely wide.
- And vice versa.

That is exactly what Heisenberg said:

- **There is a fundamental lower limit**

This is also a property of Fourier integrals.

You have had one signals course so far, and I think there is a Signals 2 course next year that goes more into detail. For now, it is enough if you can follow the main line.

---

## Important Conceptual Remark

This is a tough subject.

It is mainly for illustration purposes in the course.

### Cases

- **One line in k-space:** One wave function, extending infinitely in space
- **Two lines in k-space:** Still extends infinitely in space
- **A discrete number of lines:** Still extends infinitely in space
- **A continuous spectrum in k-space:** Gives a localized effect in real space

That localized effect is called:

- **A wave packet**

There will be follow-up courses on this. For now, if you understand this concept, that is sufficient.

---

# Time-Independent Schrödinger Equation

I now want to start working with Schrödinger's equation in a somewhat easier setting.

I will make two steps:

1. **Include a potential energy function**
2. **Look at stationary situations**, so not the time behavior

Previously, Schrödinger's equation was shown in black. If we add potential energy, then experimentally the correct form is to include:

- **A potential function `U(x)`**

This gives something comparable to what you have in mechanics:

- **Kinetic energy + potential energy = total energy**

This has been proven experimentally, even though it is difficult to derive from first principles.

### Special case

If you put:

- `U(x) = 0`

then you recover the free-particle case.

---

## Separation of Variables

A way to solve this is by **separation of variables**.

We consider the wave function to be the product of two functions:

- One depending only on `x`
- One depending only on `t`

So:

- `ψ(x,t) = f(x) g(t)`

This is similar to what we do in harmonic motion, where we assume time behavior like:

- `e^{jωt}`
- or sine / cosine

and then look at what the amplitude does.

### Same idea here

We separate:

- **Temporal part:** `g(t)`
- **Spatial part:** `f(x)`

and assume the temporal part behaves like:

- `e^{jωt}`

where `ω` can be written in terms of the energy of the particle:

- `E = hf = ħω`

So the time behavior of the solution looks like an exponential involving:

- `E / ħ`

Since we know what the time behavior looks like, we can remove it from the Schrödinger equation.

You can see this as a Fourier transformation with respect to time.

### Stationary state

The spatial part is then called:

- **A stationary state**

This corresponds to a certain oscillation frequency or total energy.

### Probability density in this case

To calculate the probability density over space, we only need:

- `|ψ(x)|^2`

This gives the **time-independent Schrödinger equation**.

### Notational simplification

Because it depends on only one variable, we can use ordinary derivatives:

- `d/dx`
- instead of partial derivatives

---

# Example 1: Particle in an Infinite Potential Well

Let's do a thought experiment.

We have a particle in an **infinite potential well**, which already contains the energy that confines the particle inside a region in space.

Typically, we look at:

- **A particle of mass `m`**
- **A one-dimensional box**
- **Ideal walls**

The particle cannot escape, because the energy needed to get out is infinite.

So the particle is confined inside the box.

---

## Physical Picture

Inside the potential well:

- **No potential energy**
- `U(x) = 0`

Outside:

- **Infinite potential energy**

So the particle should remain inside the box.

You can think of this as:

- **An electron moving along a perfectly conducting wire**
- You know it is on the wire, but not where

We want to describe the probability of finding that electron along that piece of wire.

Another example:

- **An electron moving along a long straight molecule**

In classical mechanics, the particle is locked inside. But as we will later see, if the walls are not ideal, then in quantum mechanics the particle can be found outside, which is weird.

---

## Solutions Inside and Outside the Well

We look only at **spatial solutions**, because we are using the time-independent Schrödinger equation.

### Inside the well

The solutions are sums of:

- **Sines**
- **Cosines**

Depending on the boundary conditions at the wall, we choose one or a combination.

### Outside the well

Since the potential is infinite outside, the only valid solution is:

- **`ψ = 0`**

Therefore, the function inside has to connect to zero outside.

So the wave function must satisfy:

- `ψ = 0` at the left wall
- `ψ = 0` at the right wall

---

## Boundary Conditions and Allowed Wave Functions

Which functions remain?

- **Sine functions**

because sine starts at zero when the argument is zero.

If I tune `k` properly, I can make the sine zero at the other wall as well.

### Allowed wave numbers

The wave number must be:

- **Integer multiples of `π / L`**

So the solutions are standing-wave-like sine functions.

Over half a period, a sine goes:

- zero -> maximum -> zero

That is the lowest function that fits in the box.

Higher modes fit as well, just like standing waves on a string.

### Quantization

`n` has to be an integer.

This means there are only **discrete values of `k`** possible.

This is called:

- **Quantization**

which is a basic property of quantum mechanics.

---

## Quantized Energy Levels

What are the corresponding energy levels?

These also quantize.

The energy is given by:

- `E = ħ^2 k^2 / 2m`

If I substitute the allowed `k` values, I get energy levels that scale with:

- **`n^2`**

So:

- For `n = 1`, some base energy
- For `n = 2`, four times as much energy
- and so on

---

## Summary of the Infinite Well Solutions

The allowed solutions are:

- **`n = 1`:** One half sine fitting the box
- **`n = 2`:** One full sine
- **`n = 3`:** One and a half sine
- **`n = 4`:** Two full sines
- etc.

The energy levels scale with:

- **`n^2`**

These look like waves on a string, but now they are associated with the discrete energy levels the particle can have.

---

## Normalization

Because these are probability-density-related functions, we can normalize them.

If you integrate the probability density over the whole allowed region, namely:

- from `0` to `L`

then you must get:

- **1**

because then you have found the particle somewhere in the box.

This allows us to find the amplitude factor, which turns out to be:

- **`√(2/L)`**

So the normalized wave functions include that factor.

---

## Interpretation of Probability Densities

Think of the well as an electric wire with one extra electron moving freely on it.

If the electron has more energy, it moves faster on the wire.

But in quantum mechanics, the key point is the spatial probability distribution.

### For low energy

There is a high probability of finding the electron in the middle.

### For higher energy

There are more points where the electron is likely to be found.

More precisely:

- There are points on the wire where the probability is high
- and points where the probability is zero

The probability densities are:

- `|ψ(x)|^2`

A sine function gives a probability density with peaks and nodes.

### Important feature

For certain energy levels:

- The probability of finding the particle in the middle is zero
- It is more likely to find it elsewhere

---

## No `n = 0` Solution

The `n = 0` solution is not possible.

Why?

- It would give a probability density of zero everywhere
- That is nonsense, because the particle has to be somewhere

So the particle always has energy.

Electrons always move; zero probability everywhere is not physically meaningful.

---

## Conceptual Link to Standing Waves

This is a lot to take in, but I hope I could relate it to:

- **A wave on a string fixed at both ends**

except that now we are looking at a particle on that line.

Try to summarize this in your own words.

---

## Quiz: Probability in the Infinite Well

We looked at the first five wave functions for the particle in an infinite well.

### Question

What can you say about the probability of finding the particle?

- Many voted
- The correct interpretation was about the cases `n = 2` and `n = 4`

### Key point

For `n = 2` and `n = 4`:

- There is a zero in the wave function at the center
- Therefore, there is also a zero in the probability density there

So:

- **Low probability in the center**
- especially for those even modes

---

# Example 2: Finite Square Well

The infinite well is idealized.

In practice, you do not have an infinite potential well. Instead, you have a:

- **Finite potential well**
- also called a **square well potential**

This is a better approximation to real physical systems.

---

## Physical Meaning

Now:

- **Inside the well:** `U = 0`
- **Outside the well:** `U = U0`

In classical mechanics:

- If the particle has energy below `U0`, it must stay inside the well

because it cannot gain enough kinetic energy to escape.

### Quantum mechanics

In quantum mechanics, however, escape is still possible in the sense that:

- There is a nonzero probability of finding the particle outside the well

This can model, for example:

- **An electron in a metallic sheet along the thickness direction**
- **An electron escaping from a metal**

Even if it does not have enough energy classically, Schrödinger's equation still allows a nonzero probability outside.

---

## Solutions Inside and Outside

### Inside the well

We again have the standard solution with `U = 0`, so we get sinusoidal solutions.

But now the wave function does **not** have to be zero at the walls, because the potential is finite, not infinite.

### Outside the well

The equation changes because now `U = U0`.

Solving the differential equation gives:

- **Exponential solutions**

Solutions to differential equations commonly contain exponentials.

We are not deriving this here; the mathematics is too involved for this course.

---

## Selecting Physical Solutions

The general solutions outside can grow or decay exponentially.

To keep them physical, we choose only the decaying ones:

- On the **left**, choose the one that goes to zero as `x -> -∞`
- On the **right**, choose the one that goes to zero as `x -> +∞`

Otherwise, the solutions would blow up.

### Result

The wave function is continuous across the boundary, but now there is:

- **An exponential tail extending outside the well**

That means:

- There is a nonzero chance of finding the particle outside the potential well

This is a strikingly quantum effect.

---

## Shape of the Solutions

The `n = 1` solution still looks roughly like a sine function inside the well, but shifted or modified so it connects smoothly to the exponential tails.

Similarly:

- `n = 2`: Two bumps plus tails
- Higher `n`: More structure, still with tails

### Main conclusion

For **all these energy levels**, there is some chance of finding the particle outside the well.

---

## Energy Levels in the Finite Well

If you plot the energy levels relative to the finite well potential, then you find a limited number of bound states below the top of the well.

For example:

- `n = 1`
- `n = 2`
- `n = 3`

For reference, the infinite-well energy levels can also be plotted.

### Important observation

Already at lower energies than in the infinite-well case, you get solutions with nonzero probability outside the well.

That is one of the weird and essential features of quantum mechanics.

---

## Probability Density for the Finite Well

The probability densities `|ψ(x)|^2` look as follows:

- For `n = 1`: Highest probability near the middle
- But still a nonzero probability outside the well
- For higher `n`: The outside probability increases

Not all positions are equally likely.

There are also local zeros where finding the particle is unlikely.

For `n = 2`, for example:

- The middle can be a low-probability region

For `n = 3`:

- There are multiple likely regions

---

## Break Announcement

This is a nice moment for a break.

Since it is almost Easter anyway, I brought:

- **Chocolate Easter eggs**
  - white
  - milk
  - dark

Please grab a treat. Please also take another one later so I do not have to bring these home, otherwise my wife will eat them all.

---

## Important Reminder About Time Dependence

Let me emphasize one more point:

Everything shown so far is only the **spatial part** of the wave function.

There is always also the time-dependent factor:

- `e^{iωt}`
- or equivalently involving `E/ħ`

This describes the fact that the state is still a wave.

So you can think of the `n = 1` solution as an electron oscillating back and forth on the wire, and due to the tails it can extend a bit outside the wire over time.

If you take a snapshot at the right moment, you may find it outside.

---

## Quiz: Finite Well Concept

I will not ask you in the exam to do detailed calculations on this. Think of **conceptual questions** like these.

It is not a math test; it is a physics test.

### Important note

The green plots are shown on a relative scale. If you integrate them properly, you should get 1.

### Key answer

You can find the particle in the wall or outside the well, and for the lowest state `n = 1`, the amplitude outside the wall is the smallest.

For higher energy levels:

- The tails become larger
- It becomes more likely to find the particle outside

---

# Example 3: Potential Barrier and Tunneling

We have now looked at a dip in potential. You can also flip that around and obtain:

- **A potential barrier**

Then we are talking about:

- **Tunneling**

---

## Classical vs Quantum Picture

### Classical mechanics

If the particle has energy below the barrier height, then it does not have enough energy to get over the barrier.

So you cannot find it on the other side.

### Quantum mechanics

Quantum mechanically, there is still a chance to find the particle beyond the barrier.

That is called:

- **Tunneling**

---

## Wave-Function Picture

The wave functions look like this conceptually:

- **Before the barrier:** Free-space wave function
- **Inside the barrier:** Exponential decay
- **After the barrier:** Wave function continues again

So:

- There is a chance to find the particle in the barrier
- and also outside the barrier

### Why exponential inside the barrier?

That follows from the mathematics of the Schrödinger equation. In the barrier region, the differential equation only allows exponential-type solutions.

### Boundary conditions

The wave function has to be continuous across the barrier.

That is why the outside and inside parts connect smoothly.

---

## Width and Height of the Barrier

You can imagine:

- If the barrier is **wider**
- or **higher**

then the exponential decays more strongly, and there is less chance of finding the particle outside.

---

## Applications of Tunneling

Examples include:

- **Transistors**
- **Josephson junctions**
- **Nuclear fusion**
- **Tunnel diodes**
- **Scanning tunneling microscope (STM)**

### Scanning tunneling microscope

This microscope creates images at the atomic scale and is based on electrons tunneling through the very small gap between:

- the specimen
- the probe

You bring the probe extremely close-on the order of one nanometer-to the surface.

By measuring the tunneling electrons, you map the local profile of the specimen.

The resulting images are usually color-coded:

- not because color is measured directly
- but because intensity represents the measured electron signal

---

## Alpha Decay as a Tunneling Example

Recall Rutherford's experiment with alpha particles shot at a gold sheet.

The alpha particle itself comes from the decay of a radium atom. It is essentially:

- **A helium nucleus**

Inside the radium nucleus, the alpha particle is confined by a barrier. If it has a certain energy, it can tunnel through that barrier and escape.

Outside the nucleus, the electric potential has a `1/r` dependence, so the barrier is not a square one, but the tunneling concept still applies.

### Main idea

There is a nonzero chance of finding the alpha particle outside the barrier, and this is how it escapes the radium atom.

---

# Quantum Harmonic Oscillator

One last topic before moving to lighter material is the **harmonic oscillator**.

This is similar to the simple harmonic motion you saw in module 5, but now in a quantum sense.

It is similar, but not quite the same.

---

## Classical Mass-Spring System

Consider a simple mass-spring system with restoring force:

- **`-k' x`**

I use `k'` for the spring constant because `k` is already used for wave number.

So:

- **`k'`:** Spring constant in `N/m`
- **`k`:** Wave number in `1/m`

You know the differential equation for simple harmonic motion, and you can define a natural frequency:

- **`ω = sqrt(k'/m)`**

This system also has a potential energy:

- **`(1/2) k' x^2`**

which is quadratic and zero in the middle.

### Classical motion

If the particle has energy `E`, then classically it can oscillate between:

- `-a`
- `+a`

but not farther.

That is the classical amplitude range.

---

## Quantum Harmonic Oscillator Setup

In quantum mechanics, of course, there is a catch:

- You can find the particle outside the classical range

So there can be amplitude beyond `-a` and `+a`.

If an object oscillates with angular frequency `ω`, then it would emit electromagnetic radiation at that frequency, so the particle energy should relate to that frequency.

Thus:

- **`E = hf = ħω`**

We put the potential energy function:

- **`(1/2) k' x^2`**

into Schrödinger's equation in place of `U(x)`.

---

## Boundary Conditions

As always, we need boundary conditions.

We require that the wave function goes to zero as:

- `x -> ∞`

So it should not be everywhere in space if a confining potential acts on the particle, though it can extend somewhat beyond the classical amplitude range.

---

## Energy Levels of the Quantum Harmonic Oscillator

The result, without deriving all the mathematics, is that there are discrete energy levels:

- **`E_n = (n + 1/2) ħω`**

So:

- Lowest level: `n = 0` gives `(1/2) ħω`
- Then you go up in steps of `ħω`

### Important properties

- There are **infinitely many energy levels**
- The spacing between successive levels is constant: `ħω`
- Even the lowest energy is **not zero**

This lowest level is called the:

- **Ground state**

---

## Why the Lowest Energy Is Not Zero

The mathematics, together with the boundary conditions, leads to the factor `1/2`.

This is not derived in the book in full detail, and I am not deriving it here either.

For this course, it is enough to know the result and recognize the form of the wave functions.

---

## Classical vs Quantum Probability Distributions

For each energy level, there is a corresponding classical turning range `-a` to `+a`.

Classically, the particle cannot go beyond that amplitude.

Quantum mechanically, it can.

### Ground-state wave function

For `n = 0`, the quantum probability density has:

- **A single maximum in the middle**
- **Exponential tails outside the classical range**

This is very different from the classical oscillator.

### Classical probability density

Classically, the particle spends more time near the turning points because the velocity is lower there.

So the classical probability density is higher near the edges.

### Quantum probability density

Quantum mechanically, especially for the lowest mode:

- The particle is most likely found in the middle

For higher modes, the shapes start to resemble the classical distribution more, but they still have:

- **Exponential tails outside the classical range**

---

## Hermite Functions

These quantum harmonic oscillator wave functions are related to:

- **Hermite functions**

This is advanced mathematics and not covered in this course or in the book in detail.

What matters here is the conceptual difference:

- The quantum oscillator behaves differently from the Newtonian oscillator
- Especially in the lowest mode
- And the wave function extends beyond the classical amplitude limits

---

# Sketch of the 3D Schrödinger Equation

What comes next is covered in the book but is not part of this course.

If you extend Schrödinger's equation to 3D, the mathematics becomes much more complicated.

If you understand the 1D concepts, that is enough.

---

## General 3D Idea

For a non-relativistic particle moving much slower than the speed of light, Schrödinger's equation in 3D uses:

- a position vector `(x, y, z)`
- a **Hamiltonian operator**

The Hamiltonian contains:

- **Kinetic energy**
- **Potential energy**
- **Spin**
- and other forms of energy and spatial dependence

I am not going to write that out in detail.

---

## Quantum Numbers in 3D

In 1D, you have one quantum number.

In 3D, for a particle in a box, you have three quantum numbers corresponding to the three orthogonal directions:

- `x`
- `y`
- `z`

For atomic systems, there are additional quantum numbers:

- **Principal quantum number:** Related to energy
- **Angular momentum quantum number**
- **Magnetic quantum number:** Related to orientation of angular momentum

The energy levels remain similar in spirit to what Bohr derived for hydrogen.

For each principal quantum number `n`, there are multiple possible states.

---

## Orbital Shapes and Probability Clouds

Instead of simple sine waves, the probability distributions in 3D become:

- **Fuzzy clouds**

These describe where the particle is likely to be found.

The stronger the color or intensity, the higher the probability.

Examples include:

- **`n = 1` state**
- **`n = 2` state**
- Higher-order states with more structure

Think of these as spherical or angular probability distributions.

This is only to sketch the main idea. Please focus on the content of this course, not on this advanced 3D material.

---

# Quantum Entanglement

The last topic is **quantum entanglement**, one of the fundamental principles of quantum computing.

This is what Einstein called:

- **"Spooky action at a distance"**

---

## What Entanglement Means

Entanglement occurs when multiple objects share a single quantum state.

Suppose you have:

- a pair of electrons
- or a pair of photons

For electrons, one can be:

- **spin up**
- and the other **spin down**

But you do not know which is which until you make a measurement.

That is the key idea.

---

## Historical Background

In 1935, Einstein, Podolsky, and Rosen wrote the famous:

- **EPR paper**

This expressed anxiety about the implications of quantum mechanics.

Einstein in particular was unhappy about the apparent lack of locality. He did not like the idea that there were no hidden variables determining what was happening.

He called it:

- **Spukhafte Fernwirkung**
- or **spooky action at a distance**

Later, John Stuart Bell showed that nature really does behave this way.

---

## Bell's Sock Analogy

Bell explained this with a nice story about **Professor Bertlmann**, who wears mismatched socks.

### Classical socks

Suppose one sock is pink and the other is blue.

If Alice sees that one sock is blue, then Bob instantly knows the other must be pink.

This is not mysterious, because:

- The socks already had definite colors
- The result was predetermined
- The two socks were correlated

These are:

- **Real**
- **Deterministic**
- **Local**

You do not know which sock is which beforehand, but each sock does have a definite color.

---

## Quantum Socks

Now imagine **quantum socks**.

In that case:

- The socks do not have definite colors before measurement
- Only when Alice measures one sock does the color become defined
- Instantly, the other sock must then be the opposite color

These socks are:

- **Unreal:** No definite color before measurement
- **Non-deterministic:** 50% chance pink, 50% chance blue
- **Non-local:** The two are linked in a way not explained by local hidden properties

### Crucial point

Before the measurement, you do **not** know which sock has which color because that is not yet determined.

Only after measurement does the pair resolve into definite outcomes.

---

## Does This Transmit Information Faster Than Light?

This was one of Einstein's objections.

It may seem that information is transferred instantaneously.

But in fact:

- You do not know beforehand what the result will be
- So no usable information is transmitted faster than light

What is instantaneous is the **correlation**, not a controllable message.

That is why relativity is not violated in the usual information-transfer sense.

---

## Distant Entangled Objects

Even if the two entangled objects are far apart, the same thing happens.

If one is measured to be pink, the other is instantly determined to be blue, and vice versa.

This is what puzzled scientists:

- How do they always choose opposite outcomes?
- Does one somehow "know" what happened to the other?

This led to the idea of hidden variables.

---

## Hidden Variables vs Genuine Entanglement

Scientists first thought there might be hidden variables that predetermined the results. In that case, entanglement would just be an illusion.

Bell devised a correlation experiment to test this.

### Bell's inequality

He showed that if hidden-variable theories were correct, then certain measured correlations had to stay below a specific limit.

If experiments exceed that limit, then hidden variables cannot explain the results.

### Experimental outcome

Experiments repeatedly show violations of Bell's inequality.

Therefore:

- **Entanglement is real**
- **Hidden-variable explanations of the simple local type do not work**

This is one of the deepest results in quantum mechanics.

---

## Wave Function Collapse

This connects to another phrase you may have heard:

- **Wave function collapse**

If a system is in a superposition of two states, then when you perform a measurement, the wave function collapses to one of the allowed outcomes.

That is also at the heart of entanglement.

---

## Entanglement and Quantum Computing

Entanglement is central to:

- **Quantum computing**

Qubits use superposition and entanglement, for example through electron spin states.

That means the computer memory can be in a superposition of multiple states simultaneously.

This allows certain calculations to become much faster.

Not all calculations benefit, but some benefit enormously.

There is a lot of research on this, including on the TU/e campus, and there are master-level specializations related to quantum computing.

---

## More Realistic Example: Two Electrons

Suppose two electrons originate from the same atom.

The net spin has to be zero, so:

- one must be spin up
- one must be spin down

But before measurement, you do not know which electron is in which state.

If you label them as particle 1 and particle 2, then the pair is in an entangled state.

### Measurement outcomes

- If you measure particle 1 and find **spin up**, then particle 2 will always be **spin down**
- If you measure particle 1 and find **spin down**, then particle 2 will always be **spin up**

That is how the entanglement appears in practice.

---

## Closing Joke

It might be a nice experiment for the final test to make entangled pairs of students:

- one fails the exam
- one passes the exam

and I determine it only by rolling the dice.

Who is in favor?

No-let's not do that.

But this illustrates the basic idea of paired outcomes.

---

# Lecture Summary

This concludes the lecture.

I hope I gave you a glimpse of:

- **What wave functions mean**
- **How they can be used**

We looked at:

- **Solutions to the 1D Schrödinger equation**
- especially the **time-independent** version
- **The infinite well**
- **The finite square well**
- **Tunneling**
- **The quantum harmonic oscillator**
- **Entanglement**

These all show the strange and powerful features of quantum mechanics.

---

## Final Remarks

- **Thank you:** Thank you for attending and for your attention.
- **Teaching note:** I enjoyed teaching this course a lot.
- **Exam wish:** I wish you good luck with the exam.
- **Appreciation:** Thank you for staying here from start to end.
- **See you next Monday:** I will see you next Monday, but already-good luck with the exam.

## Source snapshots

![986217_English Page 1](/test-2/assets/986217-english-page-001.png)

![986217_English Page 2](/test-2/assets/986217-english-page-002.png)

![986217_English Page 3](/test-2/assets/986217-english-page-003.png)

![986217_English Page 4](/test-2/assets/986217-english-page-004.png)

![986217_English Page 5](/test-2/assets/986217-english-page-005.png)

![986217_English Page 6](/test-2/assets/986217-english-page-006.png)

![986217_English Page 7](/test-2/assets/986217-english-page-007.png)

![986217_English Page 8](/test-2/assets/986217-english-page-008.png)

![986217_English Page 9](/test-2/assets/986217-english-page-009.png)

![986217_English Page 10](/test-2/assets/986217-english-page-010.png)

![986217_English Page 11](/test-2/assets/986217-english-page-011.png)

![986217_English Page 12](/test-2/assets/986217-english-page-012.png)

![986217_English Page 13](/test-2/assets/986217-english-page-013.png)

![986217_English Page 14](/test-2/assets/986217-english-page-014.png)

![986217_English Page 15](/test-2/assets/986217-english-page-015.png)
