import type { Metadata } from 'next'
import './globals.css'
import Nav from './Nav'

export const metadata: Metadata = {
  title: 'Transcriptor Paleográfico',
  description: 'Normalización de texto histórico con MT5',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Nav />
        {children}
      </body>
    </html>
  )
}
