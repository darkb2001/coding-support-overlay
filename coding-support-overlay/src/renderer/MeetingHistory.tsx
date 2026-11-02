import { useCallback, useEffect, useState } from 'react'

interface MeetingSummary {
  id: string
  title: string
  createdAt: number
  utterances: number
  hasMarkdown: boolean
}

interface Utterance {
  speaker: string
  text: string
  ts: number
}

export default function MeetingHistory({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<MeetingSummary[]>([])
  const [open, setOpen] = useState<{ id: string; utterances: Utterance[] } | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const list = await window.api.meeting.history()
    setItems(Array.isArray(list) ? list : [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openMeeting = useCallback(async (id: string) => {
    const data = await window.api.meeting.read(id)
    if (data) setOpen({ id, utterances: data.utterances })
  }, [])

  const remove = useCallback(async (id: string) => {
    await window.api.meeting.remove(id)
    setOpen((cur) => (cur?.id === id ? null : cur))
    void refresh()
  }, [refresh])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, WebkitAppRegion: 'no-drag' as React.CSSProperties['WebkitAppRegion'] }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#c4b5fd' }}>
          {open ? 'Chi tiết cuộc họp' : 'Lịch sử cuộc họp'}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {open && (
            <button onClick={() => setOpen(null)} style={btnStyle}>
              ← Danh sách
            </button>
          )}
          <button onClick={onClose} style={btnStyle}>
            Đóng
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 12px 12px' }}>
        {open ? (
          <>
            <button onClick={() => window.api.meeting.openExport(open.id)} style={{ ...btnStyle, marginBottom: 8 }}>
              Mở file .md
            </button>
            {open.utterances.length === 0 && <Empty text="Cuộc họp chưa có nội dung." />}
            {open.utterances.map((u, i) => {
              const mine = u.speaker === 'Me'
              return (
                <div key={`${u.ts}-${i}`} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 5 }}>
                  <div
                    style={{
                      maxWidth: '82%',
                      padding: '5px 9px',
                      background: mine ? 'rgba(96,165,250,0.18)' : 'rgba(36,36,48,0.7)',
                      border: `1px solid ${mine ? 'rgba(96,165,250,0.35)' : 'rgba(255,255,255,0.07)'}`,
                      borderRadius: 10,
                      fontSize: 11.5,
                      color: 'var(--text-primary)',
                      lineHeight: 1.5,
                      userSelect: 'text',
                      wordBreak: 'break-word'
                    }}
                  >
                    <div style={{ fontSize: 9, opacity: 0.7, marginBottom: 2 }}>
                      {mine ? 'Tôi' : 'Đối phương'} · {new Date(u.ts).toLocaleTimeString()}
                    </div>
                    {u.text}
                  </div>
                </div>
              )
            })}
          </>
        ) : loading ? (
          <Empty text="Đang tải..." />
        ) : items.length === 0 ? (
          <Empty text="Chưa có cuộc họp nào được lưu." />
        ) : (
          items.map((m) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 9px', marginBottom: 5, borderRadius: 8, background: 'rgba(36,36,48,0.55)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <button onClick={() => openMeeting(m.id)} style={{ flex: 1, textAlign: 'left', background: 'none', border: 0, cursor: 'pointer', color: 'var(--text-primary)' }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{m.title}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  {m.utterances} lượt {m.hasMarkdown ? '· có bản .md' : ''}
                </div>
              </button>
              <button
                onClick={() => remove(m.id)}
                title="Xóa cuộc họp"
                style={{ ...btnStyle, color: '#fca5a5', borderColor: 'rgba(248,113,113,0.35)' }}
              >
                Xóa
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '3px 8px',
  fontSize: 10.5,
  borderRadius: 6,
  border: '1px solid rgba(167,139,250,0.35)',
  background: 'rgba(167,139,250,0.1)',
  color: '#c4b5fd',
  cursor: 'pointer'
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 11.5 }}>{text}</div>
  )
}
