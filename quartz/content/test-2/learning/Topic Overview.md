---
title: "Topic Overview"
date: "2026-07-10T11:34:42.044Z"
knowledge_type: "topic-overview"
breadboardType: "topic_overview"
gardenId: "test-2"
generatedBy: "learn_button"
generated_by: "learn_button"
learningVersion: "learning_mreuxy2y_mayckmp"
learningVersionId: "learning_mreuxy2y_mayckmp"
sourceSetHash: "da4e4aa8c56753a3b736ce67191e566a20546815fb4beba56b78a636c1861ef5"
---

# Spiking Neural Networks

Spiking Neural Networks, or SNNs, are neural networks that communicate through discrete spike events instead of continuously updated activation values. A conventional artificial neural network usually computes with dense numerical activations: each layer produces values, passes them forward, and repeats this process whether or not the input has changed much. An SNN changes the basic rhythm of computation. A neuron stays mostly quiet until its internal state crosses a firing threshold; then it emits a spike. That spike is both a signal and an event in time.

This makes time part of the representation. In an SNN, information can be carried not only by whether a neuron fires, but also by when it fires, how often it fires, and how spike patterns unfold across neurons. This event-driven style is the central idea of the garden: sparse spikes can reduce unnecessary computation, temporal firing patterns can support time-sensitive processing, and the value of an SNN must be judged with more than accuracy alone.

The main learning path begins with motivation. Dense, continuous, synchronous computation can become expensive in low-power or real-time settings. SNNs are introduced as a brain-inspired alternative because they compute only when events occur. This does not automatically make every SNN better than every ANN. It means the comparison has to include the costs and delays that ordinary accuracy scores can hide.

From there, the garden builds the core mechanism. Input data must first be encoded into spikes. Spiking neurons then accumulate input over time, leak some of that accumulated state, and fire when their membrane potential crosses a threshold. Lateral inhibition can make neurons compete, so that the network's activity becomes more selective rather than simply spreading everywhere.

After the mechanism, the garden turns to measurement. SNNs are evaluated through a multi-metric lens: accuracy, latency, spike count, energy per inference, normalized energy efficiency, and convergence time. These metrics belong together. Accuracy asks how often the model is right. Latency asks how long it takes to decide. Spike count asks how much event activity occurs. Energy per inference estimates the cost of producing one answer. Normalized energy efficiency connects correctness to energy use. Convergence time asks how quickly training reaches a useful target.

Training is the next major step. Surrogate gradient training, ANN-to-SNN conversion, and spike-timing-dependent plasticity each solve a different part of the problem. Surrogate gradient training is useful when strong accuracy, low latency, and fast convergence matter. ANN-to-SNN conversion can preserve competitive performance, but may require higher spike counts and longer simulation windows. STDP is attractive for sparse, low-energy, unsupervised settings, but it can converge more slowly.

The final part of the garden asks where SNNs fit. Neuromorphic hardware, including systems such as IBM TrueNorth and Intel Loihi, matters because event-driven networks are most compelling when the hardware can exploit sparse spike activity. Applications cluster around low-power and temporal intelligence: robotics, neuromorphic vision, edge AI, brain-computer interfaces, sensory processing, mobile devices, and real-time scenarios. The open challenges remain practical and important: scalable training and hardware standardization.

## How to Learn This Garden

Read the garden as one chain of cause and effect:

1. **Start with the problem.** Conventional neural networks can be powerful, but dense computation creates energy and latency pressure.
2. **Learn the event-driven idea.** SNNs replace continuous activation flow with sparse spike events.
3. **Understand the neuron.** A spiking neuron accumulates input over time and fires only when a threshold is crossed.
4. **Study the metrics.** Accuracy alone is not enough; latency, spikes, energy, and convergence determine whether an SNN is useful.
5. **Compare training methods.** Each training strategy makes a different tradeoff.
6. **Interpret the results.** Tables, graphs, curves, and formulas show why "best model" depends on the metric being prioritized.
7. **End with deployment.** SNNs matter most where time, energy, and hardware constraints shape the design.

The most important habit is to keep asking: **what is being saved, what is being delayed, what is being counted, and what is being traded away?**

## Recommended Reading Order

1. [[learning/1. Why SNNs Need Events/_index|1. Why SNNs Need Events]]
   Begin here to understand why SNNs exist, how event-driven spikes differ from continuous activations, how input encoding works, and how the Leaky Integrate-and-Fire neuron turns accumulated input into spike events.

2. Why SNNs Need Events/Why Spiking Neural Networks Exist
   Use this page to connect SNNs to the limits of dense, continuous computation in low-power and real-time settings.

3. Why SNNs Need Events/Spikes, Timing, and Event-Driven Computation
   Learn how spike trains and temporal firing patterns make timing part of neural computation.

4. Why SNNs Need Events/Input Encoding and Lateral Inhibition
   Study how ordinary inputs become spikes and how competition between neurons shapes network activity.

5. Why SNNs Need Events/The Leaky Integrate-and-Fire Neuron
   Learn the basic spiking-neuron mechanism: membrane potential, leak, threshold crossing, spike emission, and reset intuition.

6. [[learning/3. Accuracy, Correct Predictions, Total Predictions Metrics/_index|3. Accuracy, Correct Predictions, Total Predictions Metrics]]
   Move next into evaluation. This section introduces accuracy, latency, and spike count as the first layer of SNN measurement.

7. Accuracy, Correct Predictions, Total Predictions Metrics/Accuracy as Correct Prediction Rate
   Learn why accuracy measures correctness but cannot reveal cost, delay, or activity burden by itself.

8. Accuracy, Correct Predictions, Total Predictions Metrics/Latency as Decision Delay
   Learn how decision time matters for real-time SNN behavior.

9. Accuracy, Correct Predictions, Total Predictions Metrics/Spike Count as Activity Cost
   Learn why counting spikes helps connect event activity to computational cost.

10. [[learning/4. The Metrics That Make SNNs Measurable/_index|4. The Metrics That Make SNNs Measurable]]
   Continue into energy-centered evaluation: total energy, normalized energy efficiency, and convergence time.

11. Energy Per Inference, Spike Energy Cost, Synaptic Operation Cost Metrics/Energy per Inference
   Learn how spike costs and synaptic-operation costs combine into one energy estimate.

12. Energy Per Inference, Spike Energy Cost, Synaptic Operation Cost Metrics/Normalized Energy Efficiency
   Learn how accuracy and energy can be combined into a single efficiency comparison.

13. Energy Per Inference, Spike Energy Cost, Synaptic Operation Cost Metrics/Convergence Time
   Learn how training speed is measured by the first epoch that reaches a target accuracy.

14. [[learning/2. How SNNs Learn/_index|2. How SNNs Learn]]
   Study the three main training strategies and the tradeoffs each one creates.

15. How SNNs Learns/Surrogate Gradient Training
   Read this first if you want the practical route toward strong accuracy, low latency, and fast convergence.

16. How SNNs Learns/ANN-to-SNN Conversion
   Read this to understand how conventional ANN performance can be carried into an SNN, and why spike count and simulation time can rise.

17. How SNNs Learns/Spike-Timing-Dependent Plasticity
   Read this to understand timing-based learning, sparse activity, low energy, and slower convergence.

18. [[learning/5. What the Results Show/_index|5. What the Results Show]]
   Use this section to practice reading performance tables, latency comparisons, energy comparisons, loss curves, and learning curves.

19. What the Results Show/Limits of CNNs, Recurrent Models, and Transformers
   Read this contrastively: these models motivate SNNs only where temporal processing, resource cost, or real-time constraints matter.

20. What the Results Show/Accuracy and Energy Performance Results
   Learn why model comparison is not a single leaderboard when accuracy and energy pull in different directions.

21. What the Results Show/Training Curves and Learning Behavior
   Learn how loss and accuracy curves reveal training dynamics that final scores can hide.

22. [[learning/6. Where SNNs Fit and What Still Blocks Adoption/_index|6. Where SNNs Fit and What Still Blocks Adoption]]
   Finish here to connect SNNs to neuromorphic hardware, applications, strategy selection, and remaining bottlenecks.

23. Where SNNs Fits and What Still Blocks It/Neuromorphic Hardware
   Learn why specialized event-driven hardware strengthens the case for SNN efficiency.

24. Where SNNs Fits and What Still Blocks It/Choosing an SNN Training Strategy
   Use this as the synthesis page for choosing among surrogate gradients, conversion, and STDP.

25. Where SNNs Fits and What Still Blocks It/Applications for Low-Power Temporal Intelligence
   Learn where SNNs naturally fit: robotics, neuromorphic vision, edge AI, brain-computer interfaces, sensory processing, mobile devices, and real-time scenarios.

26. Where SNNs Fits and What Still Blocks It/Open Challenges in Scalable SNNs
   End with the unresolved barriers: hardware standardization and scalable training.

## What This Garden Covers

This garden covers SNNs as sparse, event-driven neural systems that use spike timing and temporal firing patterns. It explains why SNNs are compared with conventional ANNs, why low-power and real-time settings matter, how spike-based computation works at a conceptual level, and how a Leaky Integrate-and-Fire neuron decides when to fire.

It also covers the main evaluation framework: accuracy, latency, total spikes, total energy, normalized energy efficiency, and convergence time. These metrics are treated as a connected system because SNN evaluation depends on tradeoffs. A model that is accurate but slow, energy-hungry, or spike-heavy may be less useful than its accuracy score suggests.

The garden compares three training strategies: surrogate gradient training, ANN-to-SNN conversion, and STDP. The goal is not to crown one universal winner. The goal is to understand which method fits which priority: accuracy, latency, energy, spike count, convergence, or unsupervised low-power learning.

The garden also covers neuromorphic hardware and low-power temporal applications. SNNs become especially important when computation must happen near the sensor, under energy limits, or in real time.

## What This Garden Does Not Cover

This garden does not teach detailed biological neuroscience. It uses brain inspiration only as far as needed to understand spike events, temporal firing, sparse activity, and threshold-based neuron behavior.

This garden does not provide a coding tutorial. It does not walk through PyTorch, snnTorch, Brian2, Norse, Lava, Loihi SDK, or any implementation framework.

This garden does not dive into neuromorphic chip internals. IBM TrueNorth and Intel Loihi appear as examples of low-power neuromorphic hardware, not as subjects for microarchitecture study.

This garden does not introduce unsupported benchmarks or datasets beyond the named comparison contexts such as MNIST and CIFAR-10. It also does not treat CNNs, RNNs, LSTMs, GRUs, or Transformers as standalone topics; they appear only as contrastive background for understanding why SNNs are useful.

This garden does not claim that SNNs are always superior to conventional neural networks. The central lesson is more careful: SNNs are promising when sparse event-driven computation, temporal dynamics, latency, energy efficiency, and suitable hardware matter enough to justify their training and deployment challenges.