export default function OverlayIcon({ name, size = 18 }: { name: 'move' | 'hide' | 'settings' | 'mic' | 'screen' | 'copy' | 'arrow' | 'spark' | 'close'; size?: number }) {
  const paths = {
    close: <path d="m6 6 12 12M6 18 18 6" />,
    move: <><path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4" /></>,
    hide: <><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A11 11 0 0 1 21 12a16 16 0 0 1-3.4 4.5M6.4 6.4A16 16 0 0 0 3 12c2 5 7 8 12 7" /></>,
    settings: <><path d="M4 7h16M4 17h16M8 4v6M16 14v6" /></>,
    mic: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M6 10v2a6 6 0 0 0 12 0v-2M12 18v3M9 21h6" /></>,
    screen: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M12 17v4M8 21h8" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></>,
    arrow: <><path d="M4 12h16m-6-6 6 6-6 6" /></>,
    spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" /></>
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
