---
title: "Spiking Neural Networks"
date: "2026-07-15T07:54:25.433Z"
knowledge_type: "learning-index"
breadboardType: "learning_index"
gardenId: "test-2"
generatedBy: "learn_button"
generated_by: "learn_button"
learningVersion: "learning_mrlsa79t_o4mh57x"
learningVersionId: "learning_mrlsa79t_o4mh57x"
sourceSetHash: "da4e4aa8c56753a3b736ce67191e566a20546815fb4beba56b78a636c1861ef5"
---

# Spiking Neural Networks

Learners will explain how spike-based computation works, trace leaky integrate-and-fire dynamics through a competitive network, compare three SNN training paradigms, calculate six evaluation metrics, interpret the reported accuracy-energy-latency-convergence tradeoffs, and select an approach for source-supported applications.

Read the sections in order. Start with the [[learning/Topic Overview|Topic Overview]], then work through each numbered section.

## Sections

- [[learning/1. From Spiking Neural Network to Brain-inspired Computation/_index|1. From Spiking Neural Network to Brain-inspired Computation]]
  - [[learning/1. From Spiking Neural Network to Brain-inspired Computation/1.1 Why Spiking Neural Networks Exist|1.1 Why Spiking Neural Networks Exist]]
  - [[learning/1. From Spiking Neural Network to Brain-inspired Computation/1.2 Spikes, Timing, and Event-Driven Computation|1.2 Spikes, Timing, and Event-Driven Computation]]
  - [[learning/1. From Spiking Neural Network to Brain-inspired Computation/1.3 The Leaky Integrate-and-Fire Neuron|1.3 The Leaky Integrate-and-Fire Neuron]]
  - [[learning/1. From Spiking Neural Network to Brain-inspired Computation/1.4 From Input Signals to Network Spikes|1.4 From Input Signals to Network Spikes]]
  - [[learning/1. From Spiking Neural Network to Brain-inspired Computation/1.5 Excitation, Inhibition, and Winner-Take-All Competition|1.5 Excitation, Inhibition, and Winner-Take-All Competition]]
- [[learning/2. How Non-differentiable Spike Event Is Applied/_index|2. How Non-differentiable Spike Event Is Applied]]
  - [[learning/2. How Non-differentiable Spike Event Is Applied/2.1 Why Spikes Complicate Gradient-Based Learning|2.1 Why Spikes Complicate Gradient-Based Learning]]
  - [[learning/2. How Non-differentiable Spike Event Is Applied/2.2 Direct Training with Surrogate Gradients|2.2 Direct Training with Surrogate Gradients]]
  - [[learning/2. How Non-differentiable Spike Event Is Applied/2.3 Converting a Trained ANN into an SNN|2.3 Converting a Trained ANN into an SNN]]
  - [[learning/2. How Non-differentiable Spike Event Is Applied/2.4 Learning with Spike-Timing Dependent Plasticity|2.4 Learning with Spike-Timing Dependent Plasticity]]
- [[learning/3. How Performance Is Evaluated/_index|3. How Performance Is Evaluated]]
  - [[learning/3. How Performance Is Evaluated/3.1 Classification Accuracy|3.1 Classification Accuracy]]
  - [[learning/3. How Performance Is Evaluated/3.2 Decision Latency|3.2 Decision Latency]]
  - [[learning/3. How Performance Is Evaluated/3.3 Total Spike Count|3.3 Total Spike Count]]
- [[learning/4. Measuring Spike-event Cost/_index|4. Measuring Spike-event Cost]]
  - [[learning/4. Measuring Spike-event Cost/4.1 Energy per Inference|4.1 Energy per Inference]]
  - [[learning/4. Measuring Spike-event Cost/4.2 Normalized Energy Efficiency|4.2 Normalized Energy Efficiency]]
  - [[learning/4. Measuring Spike-event Cost/4.3 Convergence Time|4.3 Convergence Time]]
- [[learning/5. Comparing and Interpreting the Results/_index|5. Comparing and Interpreting the Results]]
  - [[learning/5. Comparing and Interpreting the Results/5.1 Accuracy and Energy Across Training Paradigms|5.1 Accuracy and Energy Across Training Paradigms]]
  - [[learning/5. Comparing and Interpreting the Results/5.2 Inference Latency Across Model Types|5.2 Inference Latency Across Model Types]]
  - [[learning/5. Comparing and Interpreting the Results/5.3 Energy Consumption and Spike Activity|5.3 Energy Consumption and Spike Activity]]
  - [[learning/5. Comparing and Interpreting the Results/5.4 Training Loss, Accuracy, and Convergence|5.4 Training Loss, Accuracy, and Convergence]]
  - [[learning/5. Comparing and Interpreting the Results/5.5 The Accuracy-Latency-Energy Tradeoff|5.5 The Accuracy-Latency-Energy Tradeoff]]
- [[learning/6. Using Neuromorphic Hardware in Practice/_index|6. Using Neuromorphic Hardware in Practice]]
  - [[learning/6. Using Neuromorphic Hardware in Practice/6.1 Neuromorphic Hardware and Event-Driven Deployment|6.1 Neuromorphic Hardware and Event-Driven Deployment]]
  - [[learning/6. Using Neuromorphic Hardware in Practice/6.2 Applications for Sparse Temporal Computation|6.2 Applications for Sparse Temporal Computation]]
  - [[learning/6. Using Neuromorphic Hardware in Practice/6.3 Choosing an SNN Training Strategy|6.3 Choosing an SNN Training Strategy]]
  - [[learning/6. Using Neuromorphic Hardware in Practice/6.4 Limits to Broad SNN Adoption|6.4 Limits to Broad SNN Adoption]]
