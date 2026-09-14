import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Switchboard — Give your AI a job',
  description: 'Bring your own compute. Use or build harnesses that combine AI, tools and context for your work. Switchboard powers the connection, with access you control.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
