import type { MeetingLanguage } from '../../shared/meeting-prompt'

export function meetingSttBackend(): 'speechmatics' | 'legacy' {
  const backend = process.env.MEETING_STT_BACKEND?.trim() || 'speechmatics'
  if (backend !== 'speechmatics' && backend !== 'legacy') throw new Error('MEETING_STT_BACKEND phải là speechmatics hoặc legacy.')
  return backend
}

export function speechmaticsConfig(language: MeetingLanguage) {
  const model = process.env.SPEECHMATICS_MODEL?.trim() || 'enhanced'
  if (!['melia-1', 'enhanced'].includes(model)) throw new Error('SPEECHMATICS_MODEL phải là melia-1 hoặc enhanced.')
  if (model === 'enhanced' && language === 'auto') {
    throw new Error('Speechmatics Enhanced cần chọn Tiếng Việt hoặc English. Chọn Melia 1 để nhận Việt–Anh tự động.')
  }
  return {
    message: 'StartRecognition',
    audio_format: { type: 'raw', encoding: 'pcm_s16le', sample_rate: 16000 },
    transcription_config: model === 'melia-1'
      ? { model, language: 'multi', language_hints: ['vi', 'en'], enable_partials: true }
      : { model, language, enable_partials: true, max_delay: 1.5,
          conversation_config: { end_of_utterance_silence_trigger: 1.4 },
          additional_vocab: ['TypeScript', 'JavaScript', 'React', 'Node.js', 'PostgreSQL', 'Redis',
            'Docker', 'Kubernetes', 'GraphQL', 'REST API', 'CI/CD', 'AWS', 'GitHub'].map(content => ({ content })) }
  }
}

export function speechmaticsCredentials() {
  const key = process.env.SPEECHMATICS_API_KEY?.trim()
  if (!key) throw new Error('Thiếu SPEECHMATICS_API_KEY. Thêm key vào .env rồi khởi động lại app. Audio sẽ được gửi tới Speechmatics.')
  const region = process.env.SPEECHMATICS_REGION?.trim() || 'global'
  if (!['global', 'eu', 'us', 'au'].includes(region)) throw new Error('SPEECHMATICS_REGION phải là global, eu, us hoặc au.')
  return { key, url: `wss://${region}.rt.speechmatics.com/v2` }
}
