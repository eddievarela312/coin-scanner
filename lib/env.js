// Reads a Vercel setting regardless of capitalization.
export const env = (...names) => {
  for (const n of names) {
    const k = Object.keys(process.env).find((key) => key.trim().toUpperCase() === n.toUpperCase());
    if (k && String(process.env[k]).trim()) return String(process.env[k]).trim();
  }
  return '';
};
