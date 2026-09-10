import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Switchboard — “Hello operator, connect me to superintelligence”',
  description: 'Run lightweight apps with your own Claude Code, Codex or local models. Switchboard connects them to your tools and project files, with access you control.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
