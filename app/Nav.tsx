'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './Nav.module.css'

export default function Nav() {
  const path = usePathname()
  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        <span className={styles.brand}>📜 Paleográfico</span>
        <div className={styles.tabs}>
          <Link href="/" className={`${styles.tab} ${path === '/' ? styles.active : ''}`}>
            Línea a línea
          </Link>
          <Link href="/batch" className={`${styles.tab} ${path === '/batch' ? styles.active : ''}`}>
            Análisis por lotes
          </Link>
        </div>
      </div>
    </nav>
  )
}
