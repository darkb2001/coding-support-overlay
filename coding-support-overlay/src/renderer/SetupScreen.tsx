import { useEffect, useRef, useState } from 'react'
import { groupedModels, modelLabel, preferredModel } from '../shared/model-options'
import { saveText, storedText } from './preferences'
import OverlayIcon from './OverlayIcon'
import QuitButton from './QuitButton'
import './provider-setup.css'

export interface BridgeStatus {
  ok: boolean; hasKey: boolean; verified: boolean; provider?: string; model?: string; apiBaseUrl?: string; visionSupported?: boolean
}
const STORAGE_KEY = 'coding-support.provider-setup.v1'
type Provider = 'auto' | 'gemini' | 'openai'
interface SavedFields { apiKey: string; provider: Provider; model: string; apiBaseUrl: string; visionSupported: boolean }
function loadSaved(status: BridgeStatus): SavedFields {
  let data: Partial<SavedFields> = {}
  try { data = JSON.parse(storedText(STORAGE_KEY, '{}')) ?? {} } catch { /* An invalid draft must not block setup. */ }
  const provider = ['auto', 'gemini', 'openai'].includes(data.provider ?? '') ? data.provider! : 'openai'
  return {
    apiKey: typeof data.apiKey === 'string' ? data.apiKey : '',
    provider,
    model: typeof data.model === 'string' ? data.model : status.model ?? '',
    // Gemini is direct Google API; do not reuse the OpenAI/9Router URL.
    apiBaseUrl: provider === 'gemini' ? '' : (typeof data.apiBaseUrl === 'string' ? data.apiBaseUrl : status.apiBaseUrl ?? 'https://9router.darkb-tech.io.vn/v1'),
    visionSupported: typeof data.visionSupported === 'boolean' ? data.visionSupported : status.visionSupported ?? false
  }
}

export default function SetupScreen({ status, onVerified, onClose }: { status: BridgeStatus; onVerified: () => void; onClose?: () => void }) {
  const [fields, setFields] = useState(() => loadSaved(status))
  const [models, setModels] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saved, setSaved] = useState(true)
  const [message, setMessage] = useState('Nhập key để tải danh sách model của tài khoản.')
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [refresh, setRefresh] = useState(0)
  const epoch = useRef(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++ } }, [])
  useEffect(() => { setSaved(saveText(STORAGE_KEY, JSON.stringify(fields))) }, [fields])
  function update<K extends keyof SavedFields>(key: K, value: SavedFields[K]) {
    if (key === 'apiKey' || key === 'apiBaseUrl' || key === 'provider') epoch.current++
    setFields((old) => key === 'provider' && value === 'gemini'
      ? { ...old, provider: value, apiBaseUrl: '' }
      : { ...old, [key]: value })
    setResult(null)
  }
  useEffect(() => {
    const request = ++epoch.current
    setModels([])
    setResult(null)
    if (!fields.apiKey.trim()) { setLoading(false); setMessage('Nhập key để tải danh sách model của tài khoản.'); return }
    setLoading(true)
    setMessage('Đang tải model từ provider…')
    const timer = setTimeout(async () => {
      try {
        const response = await window.api.bridge.models(fields)
        if (!mounted.current || request !== epoch.current) return
        if (!response.ok || !response.models?.length) throw new Error(response.error || 'Catalog trống. Bấm Tải lại để thử lại.')
        setModels(response.models)
        setFields((old) => ({ ...old, model: preferredModel(response.models!, old.model, status.model) }))
        setMessage(`${response.models.length} model từ tài khoản · chọn một model rồi kiểm tra kết nối.`)
      } catch (error) {
        if (mounted.current && request === epoch.current) setMessage(error instanceof Error ? error.message : 'Không tải được model. Thử lại.')
      } finally { if (mounted.current && request === epoch.current) setLoading(false) }
    }, 650)
    return () => { clearTimeout(timer); epoch.current++ }
  }, [fields.apiKey, fields.apiBaseUrl, fields.provider, refresh])

  async function test() {
    if (testing || !models.includes(fields.model)) return
    const request = ++epoch.current
    setTesting(true); setResult(null)
    try {
      const response = await window.api.bridge.testConnection({ ...fields, apiKey: fields.apiKey.trim(), apiBaseUrl: fields.apiBaseUrl.trim() }, true)
      if (!mounted.current || request !== epoch.current) return
      setResult({ ok: response.ok, message: response.ok ? 'Kết nối thành công. Đã lưu cấu hình.' : response.error || 'Không kết nối được. Kiểm tra key và model rồi thử lại.' })
      if (response.ok) onVerified()
    } catch { if (mounted.current && request === epoch.current) setResult({ ok: false, message: 'Không kết nối được Bridge. Kiểm tra Cursor rồi thử lại.' }) }
    finally { if (mounted.current) setTesting(false) }
  }
  return <section className="provider-setup" aria-label="Cấu hình provider"
    onMouseDownCapture={() => { void window.api.toggleFocusable(true) }}
    onFocusCapture={() => { void window.api.toggleFocusable(true) }}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void window.api.toggleFocusable(false) }}>
    <header className="provider-top"><strong><OverlayIcon name="spark" /> Meeting Copilot</strong>
      <div><button type="button" onClick={() => { void window.api.setMinimized(true); window.dispatchEvent(new Event('overlay-minimized')) }} title="Thu gọn thành thanh nhỏ">Thu gọn</button>{onClose && <button type="button" disabled={testing} onClick={onClose}>Đóng</button>}<QuitButton /></div>
    </header>
    <div className="provider-content">
      <h1>Kết nối AI của bạn</h1>
      <p>Cấu hình một lần, lần sau tiếp tục ngay. Model được tải từ chính tài khoản của bạn.</p>
      {!status.ok && <div className="provider-message is-error" role="alert">Chưa thấy Bridge tại cổng 3799. Mở Cursor và bật Coding Support Bridge 1.0.8+. Bạn vẫn có thể lưu thông tin và tải model tại đây.</div>}
      <fieldset disabled={testing}>
        <label htmlFor="provider-base">Base URL</label>
        <input id="provider-base" value={fields.apiBaseUrl} onChange={(e) => update('apiBaseUrl', e.target.value)} placeholder={fields.provider === 'gemini' ? 'Để trống khi dùng Google Gemini' : 'https://9router.darkb-tech.io.vn/v1'} spellCheck={false} />
        {fields.provider === 'gemini' && <p className="provider-note">Gemini trực tiếp dùng Google API; Base URL được bỏ qua.</p>}
        <label htmlFor="provider-key">API key</label>
        <input id="provider-key" type="password" value={fields.apiKey} onChange={(e) => update('apiKey', e.target.value)} placeholder="Dán API key của bạn" autoComplete="off" spellCheck={false} />
        <div className="provider-columns">
          <div><label htmlFor="provider-type">Giao thức</label><select id="provider-type" value={fields.provider} onChange={(e) => update('provider', e.target.value as Provider)}>
            <option value="openai">OpenAI / 9Router</option><option value="gemini">Google Gemini trực tiếp</option><option value="auto">Tự nhận diện</option>
          </select></div>
          <div><label htmlFor="provider-model">Model mặc định</label><select id="provider-model" value={models.includes(fields.model) ? fields.model : ''} disabled={loading || !models.length} onChange={(e) => update('model', e.target.value)}>
            {!models.length && <option value="">{loading ? 'Đang tải model…' : 'Cần tải danh sách model'}</option>}
            {groupedModels(models).map(([group, ids]) => <optgroup key={group} label={group}>{ids.map((id) => <option key={id} value={id}>{modelLabel(id)}</option>)}</optgroup>)}
          </select></div>
        </div>
        <div className="provider-catalog-status"><p role="status">{message}</p><button type="button" onClick={() => setRefresh((n) => n + 1)} disabled={loading || !fields.apiKey.trim()}>Tải lại</button></div>
        <label className="provider-checkbox"><input type="checkbox" checked={fields.visionSupported} onChange={(e) => update('visionSupported', e.target.checked)} /> Cho phép gửi ảnh (Coding và Meeting)</label>
        <p className="provider-note">Áp dụng vào Bridge sau khi bấm Kiểm tra kết nối & tiếp tục. Đây là quyền gửi ảnh, không phải kết quả kiểm tra vision của model.</p>
      </fieldset>
      {result && <p role="status" className={`provider-message ${result.ok ? 'is-ok' : 'is-error'}`}>{result.message}</p>}
      <button type="button" className="provider-primary" onClick={() => { void test() }} disabled={testing || loading || !status.ok || !models.includes(fields.model)}>{testing ? 'Đang kiểm tra kết nối…' : 'Kiểm tra kết nối & tiếp tục'} <OverlayIcon name="arrow" /></button>
      <p className="provider-note">{saved ? 'Thông tin tự lưu trên máy này, gồm API key (không mã hoá trong localStorage).' : 'Không lưu được trên máy. Kiểm tra quyền lưu trữ trước khi đóng app.'} Không đưa vào source dự án. Key chỉ gửi tới provider bạn cấu hình và Bridge cục bộ.</p>
    </div>
  </section>
}
