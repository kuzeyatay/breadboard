---
title: "Topic Overview"
date: "2026-07-08T19:39:34.701Z"
knowledge_type: "topic-overview"
breadboardType: "topic_overview"
gardenId: "test-2"
generatedBy: "learn_button"
generated_by: "learn_button"
learningVersion: "learning_mrchdrl4_wzddido"
learningVersionId: "learning_mrchdrl4_wzddido"
sourceSetHash: "da4e4aa8c56753a3b736ce67191e566a20546815fb4beba56b78a636c1861ef5"
---

# Spiking Neural Networks

Spiking neural networks are neural networks that communicate with discrete events called **spikes**. Instead of sending a continuously updated activation value through every layer at every step, a spiking neuron stays mostly quiet until its internal state reaches a threshold. When that threshold is crossed, the neuron emits a spike. That single event says: something has happened, and the timing of that event matters.

This changes the central question of neural computation. A conventional neural network usually asks, "What activation value should each unit hold?" An SNN also asks, "When should each neuron fire?" The answer can carry information through sparse activity, temporal patterns, and event-driven computation. When few spikes occur, little computation may be needed. When timing matters, the network can use the order and spacing of events as part of the representation.

The main intuition is simple: **SNNs are useful when information, energy, and time are all part of the problem.** They are motivated by settings where continuous dense computation can be wasteful, where temporal signals matter, or where inference must happen under tight energy and latency constraints. Robotics, neuromorphic vision, edge AI, brain-computer interfaces, and sensory processing are natural application areas because they often involve changing signals, limited power, and a need for fast responses.

This garden teaches SNNs as a chain of ideas. First, you will learn why spike events matter. Then you will learn how a single spiking neuron accumulates input, leaks over time, crosses a threshold, and emits a spike. After that, you will see how SNN layers organize spike flow through input, excitatory, and inhibitory populations. Only then do the training strategies become meaningful: surrogate gradient training, ANN-to-SNN conversion, and spike-timing dependent plasticity each solve a different version of the SNN learning problem.

The most important habit to build is **tradeoff thinking**. An SNN method is not good or bad in isolation. A surrogate-gradient SNN may be attractive when high accuracy, fast convergence, and low latency matter. A converted SNN may preserve competitive performance from a conventional neural network, but may require longer simulation windows or higher spike counts. An STDP-based SNN may be slower to converge, but can be attractive when low energy, low spike count, local learning, or unsupervised learning is important. No single method wins every metric.

## How To Learn This Garden

Read the garden in the order below. The order is designed to move from intuition to mechanism, then from mechanism to evaluation, and finally from evaluation to responsible application.

Start with [[learning/1. Why SNNs Need Events/_index|1. Why SNNs Need Events]]. This section explains why spiking computation exists at all. The key idea is that continuous activations can waste work when computation happens even though little useful information has changed. Spikes make activity sparse and event-driven, so timing becomes part of the signal rather than a detail added later.

Then read:

1. [[learning/1. Why SNNs Need Events/1.1 Why Spiking Neural Networks Exist|Why Spiking Neural Networks Exist]]
   Learn the motivation: energy-constrained inference, temporal data, biological inspiration, and the limits of dense continuous updates.

2. [[learning/1. Why SNNs Need Events/1.2 Spikes, Timing, and Event-Driven Computation|Spikes, Timing, and Event-Driven Computation]]
   Learn what a spike event is, what a spike train represents, and why computation can be triggered by events instead of continuous updates.

3. [[learning/1. Why SNNs Need Events/1.3 The Leaky Integrate-and-Fire Neuron|The Leaky Integrate-and-Fire Neuron]]
   Learn the basic neuron mechanism: input raises membrane potential, leakage lowers it, a threshold turns accumulated state into a spike, and reset prepares the neuron for future input.

4. [[learning/1. Why SNNs Need Events/1.4 SNN Layers and Inhibitory Competition|SNN Layers and Inhibitory Competition]]
   Learn how input, excitatory, and inhibitory layers organize spike-based computation and how inhibition can shape competition among responses.

Next, move to [[learning/2. How SNNs Learn/_index|2. How SNNs Learn]]. This section compares the main ways SNNs are built or trained. Read it after the neuron and architecture sections, because the training strategies only make sense once spikes, thresholds, and timing are familiar.

Recommended order:

1. [[learning/2. How SNNs Learn/2.1 How SNNs Learn|How SNNs Learn]]
   Learn the three major approaches: surrogate gradient training, ANN-to-SNN conversion, and STDP-based learning.

2. [[learning/2. How SNNs Learn/2.2 Surrogate Gradient Training|Surrogate Gradient Training]]
   Learn why discrete spikes make ordinary gradient training difficult, and how surrogate gradients make accuracy-oriented SNN training practical.

3. [[learning/2. How SNNs Learn/2.3 ANN-to-SNN Conversion|ANN-to-SNN Conversion]]
   Learn why a trained conventional network can be converted into an SNN, and why simulation windows and spike counts become hidden costs.

4. [[learning/2. How SNNs Learn/2.4 Spike-Timing Dependent Plasticity|Spike-Timing Dependent Plasticity]]
   Learn how the timing between pre-synaptic and post-synaptic spikes can become a local learning signal.

After that, read [[learning/3. The Metrics That Make SNNs Measurable/_index|3. The Metrics That Make SNNs Measurable]]. This is the section that prevents vague claims. SNNs are not evaluated by accuracy alone; they must be judged by how correct, fast, sparse, energy-efficient, and trainable they are.

Recommended order:

1. [[learning/3. The Metrics That Make SNNs Measurable/3.1 Accuracy as Correct Classification|Accuracy as Correct Classification]]
   Accuracy measures correct predictions out of total predictions, but it does not reveal energy or speed.

2. [[learning/3. The Metrics That Make SNNs Measurable/3.2 Latency as Decision Time|Latency as Decision Time]]
   Latency measures how long inference takes after a stimulus begins. It is not the same as training time.

3. [[learning/3. The Metrics That Make SNNs Measurable/3.3 Spike Count as Computational Activity|Spike Count as Computational Activity]]
   Spike count measures activity across neurons and time steps, making sparsity visible.

4. [[learning/3. The Metrics That Make SNNs Measurable/3.4 Energy Consumption and Energy Efficiency|Energy Consumption and Energy Efficiency]]
   Energy depends on spike-related costs and synaptic operation costs, while normalized energy efficiency asks how much useful accuracy is achieved per unit energy.

5. [[learning/3. The Metrics That Make SNNs Measurable/3.5 Convergence Time and Training Curves|Convergence Time and Training Curves]]
   Convergence time measures how quickly training reaches a target accuracy, while loss and accuracy curves show different views of training progress.

Then read [[learning/4. What the Results Show/_index|4. What the Results Show]]. This section puts the metrics to work. The goal is not to memorize winners, but to learn how to read comparisons without collapsing multiple metrics into one oversimplified ranking.

Recommended order:

1. [[learning/4. What the Results Show/4.1 Accuracy and Energy Results Across Models|Accuracy and Energy Results Across Models]]
   Compare ANN, converted SNN, surrogate-gradient SNN, and STDP-based SNN behavior by reading accuracy and energy together.

2. [[learning/4. What the Results Show/4.2 Latency Results Across Models|Latency Results Across Models]]
   See why surrogate-gradient SNNs are especially important for low-latency inference in the reported comparisons, including latency as low as 10 milliseconds.

3. [[learning/4. What the Results Show/4.3 Energy and Spike Count Results Across Models|Energy and Spike Count Results Across Models]]
   See why STDP-based SNNs can be attractive for low-energy settings, including reported energy as low as 5 millijoules per inference and low spike counts.

4. [[learning/4. What the Results Show/4.4 Convergence Results Across Training Strategies|Convergence Results Across Training Strategies]]
   Compare training-loss and training-accuracy curves to understand why surrogate-gradient SNNs can converge quickly, while STDP-based SNNs may trade slower convergence for energy advantages.

Finally, read [[learning/5. Where SNNs Fit and What Still Blocks Adoption/_index|5. Where SNNs Fit and What Still Blocks Adoption]]. This section turns the earlier ideas into application judgment.

Recommended order:

1. [[learning/5. Where SNNs Fit and What Still Blocks Adoption/5.1 Choosing an SNN Training Strategy|Choosing an SNN Training Strategy]]
   Learn how to choose among methods based on constraints: accuracy, latency, energy, spike count, convergence speed, or unsupervised learning.

2. [[learning/5. Where SNNs Fit and What Still Blocks Adoption/5.2 Neuromorphic Hardware and Edge Deployment|Neuromorphic Hardware and Edge Deployment]]
   Learn why neuromorphic hardware and edge systems make event-driven efficiency especially important, including the role of chips such as IBM TrueNorth and Intel Loihi.

3. [[learning/5. Where SNNs Fit and What Still Blocks Adoption/5.3 Applications for Spiking Neural Networks|Applications for Spiking Neural Networks]]
   Connect SNN strengths to robotics, neuromorphic vision, edge AI, brain-computer interfaces, and sensory processing.

4. [[learning/5. Where SNNs Fit and What Still Blocks Adoption/5.4 Limits of Current SNNs|Limits of Current SNNs]]
   Understand why SNNs are promising but not a complete replacement for conventional neural networks, especially because scalable training and hardware standardization remain challenges.

5. [[learning/5. Where SNNs Fit and What Still Blocks Adoption/5.5 Reading SNN Results Without Overclaiming|Reading SNN Results Without Overclaiming]]
   Learn how to make careful claims that preserve the tradeoffs among accuracy, latency, energy, spike count, convergence, applications, and limitations.

## What This Garden Covers

This garden covers SNNs as **event-driven neural networks** built around spike timing, sparse activity, and threshold-based neurons. It explains the Leaky Integrate-and-Fire intuition, the role of input/excitatory/inhibitory architecture, and the main compared training approaches: surrogate gradients, ANN-to-SNN conversion, and STDP.

It also covers the core evaluation metrics needed to reason about SNNs: accuracy, latency, total spike count, total energy consumption, normalized energy efficiency, and convergence time. These metrics are used to interpret reported comparisons across ANN, converted SNN, surrogate-gradient SNN, and STDP-based SNN models.

The central conclusion is constraint-based: **SNNs are most compelling when their event-driven nature matches the problem's needs.** Low-latency inference, low-energy deployment, temporal signals, sparse activity, neuromorphic hardware, and edge devices are the recurring reasons SNNs matter.

## What This Garden Does Not Cover

This garden does not teach detailed biological neuron dynamics such as ion channels, Hodgkin-Huxley equations, cortical microcircuits, or synaptic biophysics. The LIF neuron is treated as an intuitive computational model: accumulation, leakage, threshold, spike, and reset.

It does not provide a full mathematical derivation of LIF differential equations, because the focus is on the mechanism needed to understand spike generation and SNN evaluation.

It does not teach hands-on SNN programming, GPU kernels, neuromorphic SDK workflows, or deployment procedures for IBM TrueNorth, Intel Loihi, or other hardware platforms. Hardware appears here as motivation for low-power event-driven computation, not as an implementation tutorial.

It does not survey every modern SNN architecture, dataset, benchmark, or learning rule. The learning methods are limited to the compared approaches: surrogate gradient training, ANN-to-SNN conversion, and STDP-based learning.

It also does not claim that SNNs are universally better than conventional neural networks. A careful SNN claim always names the metric and constraint: accuracy, latency, energy, spike count, convergence speed, local learning, or deployment setting. The right question is not "Are SNNs better?" The right question is: **better for which constraint, under which metric, and at what cost?**