---
title: "Topic Overview"
date: "2026-07-12T11:48:03.492Z"
knowledge_type: "topic-overview"
breadboardType: "topic_overview"
gardenId: "test-2"
generatedBy: "learn_button"
generated_by: "learn_button"
learningVersion: "learning_mrhqb6op_fspr5tk"
learningVersionId: "learning_mrhqb6op_fspr5tk"
sourceSetHash: "da4e4aa8c56753a3b736ce67191e566a20546815fb4beba56b78a636c1861ef5"
---

# Spiking Neural Networks

Spiking neural networks process information through discrete events called **spikes**. Instead of recomputing continuous activation values at every step, a spiking neuron maintains an internal state, responds to incoming events over time, and emits a spike when that state crosses a threshold. This makes **timing** part of the representation: information can depend not only on how many spikes occur, but also on when they occur.

This garden develops that idea from first principles. You will follow an input as it is encoded into spike trains, accumulated by Leaky Integrate-and-Fire neurons, and shaped by competition between neurons. You will then examine three ways to train or obtain a working spiking network:

- **Surrogate-gradient training** uses a differentiable approximation during optimization to work around the non-differentiable spike event.
- **ANN-to-SNN conversion** transfers behavior from a trained conventional neural network into a spiking implementation.
- **Spike-Timing-Dependent Plasticity (STDP)** changes connection strengths according to the relative timing of presynaptic and postsynaptic spikes.

These approaches solve different learning problems and produce different tradeoffs. A model with strong classification accuracy may require more spikes, a longer inference window, or more energy. A model with sparse activity and low estimated energy may learn more slowly. There is therefore no useful single-metric answer to the question "Which model is best?"

## What You Will Learn

By the end of the garden, you should be able to:

1. Explain why dense, synchronous computation motivates event-driven alternatives.
2. Distinguish continuous-valued activations from temporally structured spike trains.
3. Trace the accumulation, leakage, threshold crossing, spike emission, and reset of a Leaky Integrate-and-Fire neuron.
4. Follow information from input encoding through spike trains, excitatory neurons, and winner-take-all competition.
5. Explain why discrete spikes complicate ordinary gradient-based training.
6. Compare surrogate-gradient training, ANN-to-SNN conversion, and STDP.
7. Calculate and interpret classification accuracy, inference latency, spike count, estimated energy, normalized energy efficiency, and convergence time.
8. Read tables, learning curves, and comparison graphs without reducing model quality to one number.
9. Choose a training strategy based on accuracy, latency, energy, activity, convergence, application demands, and deployment constraints.

## The Learning Path

The recommended order follows the path from mechanism to evidence: first understand why spikes are useful, then how they are generated and trained, and finally how competing approaches are measured and selected.

### 1. [[learning/1. How Brain-inspired Computation Works/_index|1. How Brain-inspired Computation Works]]

Begin with the computational motivation and build a concrete picture of event-driven processing.

1. [[learning/1. How Brain-inspired Computation Works/1.1 Why Spiking Neural Networks Exist|Why Spiking Neural Networks Exist]] - Contrast dense, continuously recomputed activations with sparse event-driven activity.
2. [[learning/1. How Brain-inspired Computation Works/1.2 Spikes, Timing, and Event-Driven Computation|Spikes, Timing, and Event-Driven Computation]] - Learn how spike timing, spike rate, and asynchronous communication create a spatiotemporal representation.
3. [[learning/1. How Brain-inspired Computation Works/1.3 The Leaky Integrate-and-Fire Neuron|The Leaky Integrate-and-Fire Neuron]] - Follow membrane potential as input is accumulated, partially lost through leakage, compared with a firing threshold, and reset after a spike.
4. [[learning/1. How Brain-inspired Computation Works/1.4 From Encoded Input to Spike Trains|From Encoded Input to Spike Trains]] - Trace an input through encoding and into the temporally structured activity processed by spiking neurons.
5. [[learning/1. How Brain-inspired Computation Works/1.5 Winner-Take-All Competition|Winner-Take-All Competition]] - See how lateral inhibition makes excitatory neurons compete and promotes selective responses.

### 2. [[learning/2. How Non-differentiable Spike Event Is Applied/_index|2. How Non-differentiable Spike Event Is Applied]]

Once spike generation is clear, examine the central learning difficulty: a discrete threshold event does not provide the ordinary derivative expected by gradient-based optimization.

1. [[learning/2. How Non-differentiable Spike Event Is Applied/2.1 How SNNs Learn|How SNNs Learn]] - Establish why spiking networks require distinct learning strategies.
2. [[learning/2. How Non-differentiable Spike Event Is Applied/2.2 Surrogate-Gradient Training|Surrogate-Gradient Training]] - Understand how an approximate derivative enables direct optimization of an SNN.
3. [[learning/2. How Non-differentiable Spike Event Is Applied/2.3 ANN-to-SNN Conversion|ANN-to-SNN Conversion]] - Examine what can be preserved when trained ANN behavior is transferred into a spiking implementation, and what additional simulation time or spike activity may be required.
4. [[learning/2. How Non-differentiable Spike Event Is Applied/2.4 Spike-Timing-Dependent Plasticity|Spike-Timing-Dependent Plasticity]] - Connect the order and separation of spikes to local changes in connection strength.

### 3. [[learning/3. How Performance Is Evaluated/_index|3. How Performance Is Evaluated]]

Learn the first three measurements before interpreting any model ranking.

1. [[learning/3. How Performance Is Evaluated/3.1 Classification Accuracy|Classification Accuracy]] - Calculate the fraction of predictions that are correct and identify what accuracy leaves unmeasured.
2. [[learning/3. How Performance Is Evaluated/3.2 Inference Latency|Inference Latency]] - Measure elapsed time from the arrival of a stimulus to the model's decision.
3. [[learning/3. How Performance Is Evaluated/3.3 Spike Count and Event Activity|Spike Count and Event Activity]] - Sum spike events across neurons and simulation timesteps to quantify network activity.

### 4. [[learning/4. Measuring Energy Cost Per Spike/_index|4. Measuring Energy Cost Per Spike]]

Connect event activity to estimated computational cost, then interpret learning speed.

1. [[learning/4. Measuring Energy Cost Per Spike/4.1 Energy per Inference|Energy per Inference]] - Combine the costs of spike events and synaptic operations into an estimated total.
2. [[learning/4. Measuring Energy Cost Per Spike/4.2 Normalized Energy Efficiency|Normalized Energy Efficiency]] - Relate task performance to energy consumption using accuracy per joule.
3. [[learning/4. Measuring Energy Cost Per Spike/4.3 Convergence Time and Learning Curves|Convergence Time and Learning Curves]] - Use loss and accuracy curves together, and define convergence as the first epoch at which a chosen target accuracy is reached.

### 5. [[learning/5. Comparing and Interpreting the Results/_index|5. Comparing and Interpreting the Results]]

Finish by combining the mechanisms and metrics rather than searching for a universal winner.

1. [[learning/5. Comparing and Interpreting the Results/5.1 Accuracy and Energy Tradeoffs|Accuracy and Energy Tradeoffs]] - Compare ANN and SNN approaches on MNIST and CIFAR-10 while keeping predictive performance and normalized energy distinct.
2. [[learning/5. Comparing and Interpreting the Results/5.2 Latency, Energy, and Spike-Count Tradeoffs|Latency, Energy, and Spike-Count Tradeoffs]] - Examine why response time, energy per inference, and event count are related but not interchangeable.
3. [[learning/5. Comparing and Interpreting the Results/5.3 Choosing an SNN Training Strategy|Choosing an SNN Training Strategy]] - Match model characteristics to priorities such as fast response, sparse activity, low energy, competitive accuracy, timing-based adaptation, and practical deployment.

## How to Study This Garden

Move through the sections in order on your first pass. Later ideas depend on earlier distinctions: spike count is meaningful only after spike events are clear, and training tradeoffs are easier to interpret once latency, energy, and convergence have precise definitions.

When you encounter a neuron trajectory, network diagram, table, or learning curve, do more than identify the highest or lowest value. Ask:

- What quantity is changing?
- What mechanism could produce that change?
- Which competing objective becomes worse when this one improves?
- Is the result a general property of the method, or a result within the evaluated setup?

For each metric, calculate a small example before comparing models. For each training strategy, keep two questions together: **How does learning happen?** and **What costs or benefits follow from that choice?** This prevents a strong result on one metric from becoming an unsupported claim of overall superiority.

## Scope

This garden covers the event-driven foundations of spiking computation, Leaky Integrate-and-Fire neuron intuition, input encoding, spike trains, excitatory competition, three training paradigms, six evaluation metrics, and comparative results for ANN and SNN variants on MNIST and CIFAR-10. It also connects model selection to neuromorphic computing, robotics, sensory processing, mobile and edge AI, and brain-computer interfaces. IBM TrueNorth and Intel Loihi appear as examples of neuromorphic platforms that motivate event-driven deployment.

The reported comparisons remain tied to their evaluated models, datasets, assumptions, and measurement methods. Energy values based on spike and synaptic-operation costs are treated as estimates rather than automatically interpreted as direct hardware measurements. MNIST and CIFAR-10 results illustrate tradeoffs; they do not establish that one training strategy-or SNNs as a whole-always outperforms conventional neural networks.

The garden does not provide implementation tutorials, framework APIs, benchmark-reproduction instructions, detailed hardware programming, or a broad survey of every neuron model and encoding scheme. It also does not derive unsupported surrogate estimators, conversion algorithms, or STDP equations. Detailed biological membrane models, advanced network architectures, hardware specifications, and comparisons with unrelated model families remain outside the present scope.

The goal is narrower and more useful: to understand how timed spike events support computation, how spiking networks can learn, how their behavior is measured, and how to make a defensible choice when accuracy, speed, energy, activity, and convergence point in different directions.