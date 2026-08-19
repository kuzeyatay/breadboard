"use client";

// Buzz calls into a Tauri command for sidebar haptics. There is no such host
// here, so both entry points keep their signatures and do nothing.

export function performDefaultHaptic(): void {}

export function performSidebarDefaultHaptic(): void {}
