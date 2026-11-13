"use client";

import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const sync = () => setDark(document.documentElement.dataset.theme === 'dark');
    sync();
    const storage = (event: StorageEvent) => {
      if (event.key !== 'studio-theme') return;
      document.documentElement.dataset.theme = event.newValue === 'dark' ? 'dark' : 'light';
      sync();
    };
    window.addEventListener('storage', storage);
    return () => window.removeEventListener('storage', storage);
  }, []);
  function toggle() {
    const next = !dark;
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next ? '#0B1120' : '#F9FAFB');
    try { localStorage.setItem('studio-theme', next ? 'dark' : 'light'); } catch { /* Session switching still works when storage is disabled. */ }
    setDark(next);
  }
  return <button type="button" onClick={toggle} aria-label="Dark mode" aria-pressed={dark}
    className="theme-toggle rounded-xl border px-4 py-2.5 text-sm font-medium">
    <span aria-hidden="true">{dark ? '☀' : '☾'}</span> {dark ? 'Light mode' : 'Dark mode'}
  </button>;
}
