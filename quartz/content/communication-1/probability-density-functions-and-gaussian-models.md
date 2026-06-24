---
title: "Probability Density Functions and Gaussian Models"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 51", "Page 52", "Page 53", "Page 54"]
related: ["additive-white-gaussian-noise-model", "q-function-as-gaussian-tail-probability", "bit-error-probability-on-awgn-channels"]
tags: ["probability-density-function", "gaussian-distribution", "random-variable", "variance", "standard-deviation", "central-limit-theorem"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-051-2.png", "/communication-1/assets/communications-1-coursereader-page-052-2.png"]
---

## Probability Density Functions and Gaussian Models

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 51, Page 52, Page 53, Page 54

The probability section introduces the mathematical tools later used to model channel noise and bit errors. A random variable may be discrete, such as a received bit that is either 0 or 1, or continuous, such as a received voltage taking values in a range $V_{min} < x < V_{max}$. For continuous random variables, the probability density function (PDF) describes relative likelihood over the range of possible values. Probabilities are obtained by integration: $$\Pr[a < x < b] = \int_a^b p_X(x)\,dx.$$ For the uniform distribution over $[V_{min},V_{max}]$, this becomes $$\Pr[a < x < b] = \frac{b-a}{V_{max}-V_{min}}.$$ The section then states general PDF properties: normalization $$\int_{-\infty}^{\infty} p_X(x)dx = 1,$$ mean $$\mu_X = \int_{-\infty}^{\infty} x p_X(x)dx,$$ variance $$\sigma_X^2 = \int_{-\infty}^{\infty}(x-\mu_X)^2 p_X(x)dx,$$ and standard deviation $\sigma_X = \sqrt{\sigma_X^2}$. The Gaussian distribution is then introduced as especially important, with PDF $$p_X(x)=\frac{1}{\sqrt{2\pi\sigma_x^2}} e^{-\frac{(x-\mu_x)^2}{2\sigma_x^2}}.$$ The text motivates its importance through the central limit theorem and its relevance to modeling many independent physical noise processes.

### Source snapshots

![Communications_1_CourseReader Page 51](/communication-1/assets/communications-1-coursereader-page-051-2.png)

![Communications_1_CourseReader Page 52](/communication-1/assets/communications-1-coursereader-page-052-2.png)

### Page-grounded details

#### Page 51

5.5 Bit-error probability Pe and channel noise
Channel noise refers to unwanted signals or interference that disrupt the transmission of
information through a communication channel. This interference can arise from various
sources, including thermal noise, electromagnetic interference, and crosstalk from adjacent
channels. Any physical channel might add some form of noise to a signal passing through.
The goal is to correctly detect the transmitted bits on the incoming noisy signal while
making is few mistakes in detection as possible.
Bit-error probability (Pe) is a crucial metric in communication systems, representing the
likelihood of an error occurring in the transmission of a single bit across a communication
channel. As an example, an accepted bit-error probability rate for digital wireless commu-
nications is around Pe ~= 10-6. This means that for every 1 million bits, at least one bit
will be flipped (hence corrupting the data), which might seem at first as not a big deal,
however, if you are downloading data at 1 Mbps speed (which nowadays is considered not
that fast), this means that every second one bit will be flipped, and corrupt the data.
To understand how bit-error pr

[Truncated for analysis]

#### Page 52

When we conduct experiments or studies involving random variables, we observe particular
outcomes. For example, if we roll a fair six-sided die, the possible outcomes (observations)
are the numbers 1 through 6. Each roll of the die results in a specific observation.
5.5.2 Probability density functions (PDFs)
The PDF represents the probability distribution of a continuous random variable over its
entire range of possible values. It does not directly give the probability of specific outcomes,
as the probability of any single point in a continuous distribution is typically zero. Instead,
the PDF specifies the relative likelihood of different outcomes occurring.
In our case where we wanted to model the received voltage random variable on the range
Vmin < x < Vmax, if each voltage point on that range has an equal chance (or probability
of occurring) then the PDF pX (x) of that random variable X would be in the form of
Fig.33
Vmin 	Vmax
Figure 33: Probability density function of a received voltage random variable with equal probability
between range Vmin up to Vmax. This is also known as a uniform distribution
Now, suppose you want to find the probability that the voltage will fall in a

[Truncated for analysis]

#### Page 53

Vmin Vmax	a b
Figure 34: Illustration of finding the probability that the voltage will fall within the range a and b
The following are some properties of PDFs:
For any PDF it must hold that Z ∞
-∞
pX (x) dx = 1 (73)
The average (or mean) value of a PDF can be found as
μX =
Z ∞
-∞
x pX (x) dx (74)
The variance of a PDF can be found as
σ2
X = mean((x - μx)2) =
Z ∞
-∞
(x - μx)2 pX (x) dx =
Z ∞
-∞
x2 pX (x) dx - μ2
x (75)
The standard deviation of a PDF can be found as
σX = √V ariance =
q
σ2
X (76)
Standard deviation measures the 'spreadness' of a PDF.
5.5.3 Gaussian distribution (or normal distribution)
Normal distributions are important in statistics and they often emerge naturally in nature.
Their importance is partly also due to the central limit theorem. It states that, under some
conditions, the average of many samples (observations) of a random variable with finite
mean and variance is itself a random variable-whose distribution converges to a normal
distribution as the number of samples increases. Therefore, physical quantities that are
expected to be the sum of many independent processes, such as measurement errors, often
have nearly normal distributions [3].
The PDF of a norm

[Truncated for analysis]

#### Page 54

-5 	-4 	-3 	-2 	-1 	0 	1 	2 	3 	4 	5
X
0
0.05
0.1
0.15
0.2
0.25
0.3
0.35
0.4
Probability Density
Figure 35: Gaussian distribution with mean μx = 0, and standard deviation σx = 1
5.5.4 Additive white Gaussian noise (AWGN)
Additive white Gaussian noise (AWGN) is a basic noise model used in telecommunications
to mimic the effects of many random processes that occur in nature that may interfere with
your transmitted signal. For example, thermal noise which is generated by the agitation of
the charge carriers inside an electrical conductor at equilibrium, is modeled using AWGN
noise.
- Additive - Because the noise can be added to any signal such that the signal and the
noise are combined together, and what we observe or measure is the sum of the two.
- White - "white" refers to the spectral characteristics of the noise. White noise has a
constant power spectral density across all frequencies denoted by NO
2 , meaning it has
equal power at all frequencies (see Fig. 36).
AWGN Noise
PSD |N(f )|
+f	-f
Figure 36: Illustration of AWGN noise power spectral density
- Gaussian - This refers to the probability distribution of the noise amplitude. Gaus-
sian noise follows a Gaussian (or normal) di

[Truncated for analysis]

### Key points

- A random variable can be discrete or continuous.
- A PDF describes the distribution of a continuous random variable.
- Probabilities over intervals are found by integrating the PDF.
- For a uniform distribution, probability is interval length divided by total range length.
- Every PDF integrates to 1 over all values.
- Mean, variance, and standard deviation are defined through PDF integrals.
- The Gaussian PDF is central to noise modeling in communications.

### Related topics

- [[additive-white-gaussian-noise-model|Additive White Gaussian Noise Model]]
- [[q-function-as-gaussian-tail-probability|Q-Function as Gaussian Tail Probability]]
- [[bit-error-probability-on-awgn-channels|Bit Error Probability on AWGN Channels]]

### Relationships

- depends-on: [[additive-white-gaussian-noise-model|Additive White Gaussian Noise Model]]
- depends-on: [[q-function-as-gaussian-tail-probability|Q-Function as Gaussian Tail Probability]]
