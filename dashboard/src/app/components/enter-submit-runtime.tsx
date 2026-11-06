'use client';
import { useEffect } from 'react';
import { handleEnterSubmit } from '@/lib/enter-submit';

export default function EnterSubmitRuntime() {
  useEffect(() => {
    document.addEventListener('keydown', handleEnterSubmit);
    return () => document.removeEventListener('keydown', handleEnterSubmit);
  }, []);
  return null;
}
