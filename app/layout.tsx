import './globals.css';
import type { Metadata, Viewport } from 'next';
import PwaRegister from './pwa-register';

export const metadata: Metadata = {
  title: 'TimeStack',
  description: 'Calendario di lavoro web responsive',
  applicationName: 'TimeStack',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'TimeStack',
  },
};

export const viewport: Viewport = {
  themeColor: '#020617',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}