import { useState } from 'react'
import api from '../api/axios'
import { useToast } from '../context/ToastContext'

export default function VerificationModal({ skillsOffered = [], initialSkill = '', onClose, onSuccess }) {
  const { addToast } = useToast()

  const [selectedSkill, setSelectedSkill] = useState(initialSkill || skillsOffered[0]?.skill || '')
  const [evidenceType, setEvidenceType]   = useState('github')
  const [evidenceUrl, setEvidenceUrl]     = useState('')
  const [description, setDescription]     = useState('')
  const [fileBase64, setFileBase64]       = useState('')
  const [fileName, setFileName]           = useState('')
  const [loading, setLoading]             = useState(false)
  const [error, setError]                 = useState('')

  // Handle local document file selection (PDF, PNG, JPG)
  function handleFileChange(e) {
    const file = e.target.files[0]
    if (!file) return

    // Max size: 5MB
    if (file.size > 5 * 1024 * 1024) {
      setError('File size must be 5MB or less')
      addToast('File too large (maximum 5MB)', 'warning')
      e.target.value = ''
      return
    }

    const validTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg']
    if (!validTypes.includes(file.type)) {
      setError('Only authentic PDF, PNG, or JPEG certificate documents are allowed')
      addToast('Unsupported file type (PDF/PNG/JPEG only)', 'warning')
      e.target.value = ''
      return
    }

    setError('')
    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = () => {
      setFileBase64(reader.result)
    }
    reader.onerror = () => {
      setError('Failed to read file')
    }
    reader.readAsDataURL(file)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!selectedSkill) {
      setError('Please select a skill to verify')
      return
    }

    if (!description.trim()) {
      setError('Please provide a description of your practical experience or project')
      return
    }

    if (['github', 'portfolio', 'project'].includes(evidenceType)) {
      if (!evidenceUrl.trim()) {
        setError('Please enter a valid URL for your evidence')
        return
      }
      try {
        const u = new URL(evidenceUrl.trim())
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          setError('URL must start with http:// or https://')
          return
        }
      } catch (err) {
        setError('Please enter a valid URL (e.g. https://github.com/your-username/repo)')
        return
      }
    }

    if (evidenceType === 'certificate' && !fileBase64) {
      setError('Please upload your certificate document (PDF, PNG, JPEG)')
      return
    }

    setLoading(true)
    try {
      const offered = skillsOffered.find(s => s.skill.toLowerCase() === selectedSkill.toLowerCase())

      await api.post('/verification', {
        skillName: selectedSkill,
        category: offered?.category || 'General',
        evidenceType,
        evidenceUrl: evidenceUrl.trim(),
        certificateBase64: fileBase64,
        certificateFileName: fileName,
        description: description.trim(),
      })

      addToast(`Verification request for "${selectedSkill}" submitted! 📋`, 'success')
      if (onSuccess) onSuccess()
      onClose()
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to submit verification'
      setError(msg)
      addToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 540 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
          <div>
            <h3 style={{ margin: 0 }}>Request Skill Verification 🎓</h3>
            <p style={{ margin: '.25rem 0 0', fontSize: '.84rem', color: 'var(--text-muted)' }}>
              Submit supporting evidence to receive an official verified badge from administrators.
            </p>
          </div>
          <button className="toast-close" onClick={onClose} style={{ fontSize: '1.2rem' }}>✕</button>
        </div>

        {error && <div className="alert alert-error">⚠ {error}</div>}

        <form onSubmit={handleSubmit}>
          {/* Select Skill */}
          <div className="form-group">
            <label className="form-label">Offered Skill to Verify <span style={{ color: 'var(--primary)' }}>★</span></label>
            <select
              className="form-select"
              value={selectedSkill}
              onChange={e => setSelectedSkill(e.target.value)}
              required
            >
              {skillsOffered.map((s, idx) => (
                <option key={idx} value={s.skill}>
                  {s.skill} ({s.category} - {s.level})
                </option>
              ))}
            </select>
          </div>

          {/* Evidence Type */}
          <div className="form-group">
            <label className="form-label">Evidence Type <span style={{ color: 'var(--primary)' }}>★</span></label>
            <div className="evidence-type-pills">
              {[
                { type: 'github', label: '🐙 GitHub Repository' },
                { type: 'certificate', label: '📜 Certificate Document' },
                { type: 'portfolio', label: '🌐 Portfolio Link' },
                { type: 'project', label: '🚀 Live Project' },
              ].map(opt => (
                <button
                  type="button"
                  key={opt.type}
                  className={`filter-pill ${evidenceType === opt.type ? 'filter-pill-active' : ''}`}
                  onClick={() => setEvidenceType(opt.type)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Evidence URL Input */}
          {['github', 'portfolio', 'project'].includes(evidenceType) && (
            <div className="form-group">
              <label className="form-label">
                {evidenceType === 'github' ? 'GitHub Repository URL' : evidenceType === 'portfolio' ? 'Portfolio Website URL' : 'Live Project URL'}
                <span style={{ color: 'var(--primary)' }}> ★</span>
              </label>
              <input
                className="form-input"
                type="url"
                placeholder={
                  evidenceType === 'github'
                    ? 'https://github.com/username/project'
                    : 'https://myportfolio.dev/projects'
                }
                value={evidenceUrl}
                onChange={e => setEvidenceUrl(e.target.value)}
                required
              />
            </div>
          )}

          {/* Certificate File Picker */}
          {evidenceType === 'certificate' && (
            <div className="form-group">
              <label className="form-label">
                Upload Certificate / Credential (PDF, PNG, JPG - max 5MB)
                <span style={{ color: 'var(--primary)' }}> ★</span>
              </label>
              <input
                className="form-input"
                type="file"
                accept=".pdf,image/png,image/jpeg,image/jpg"
                onChange={handleFileChange}
                required
              />
              {fileName && (
                <div style={{ fontSize: '.78rem', color: 'var(--primary)', marginTop: '.35rem', fontWeight: 600 }}>
                  ✓ Selected: {fileName}
                </div>
              )}
            </div>
          )}

          {/* Project & Skills Description */}
          <div className="form-group">
            <label className="form-label">
              Experience & Project Summary <span style={{ color: 'var(--primary)' }}>★</span>
            </label>
            <textarea
              className="form-textarea"
              rows={3}
              placeholder="Explain how you demonstrated this skill (e.g. concepts applied, libraries used, problems solved)..."
              value={description}
              onChange={e => setDescription(e.target.value)}
              required
            />
          </div>

          <div style={{ display: 'flex', gap: '.5rem', marginTop: '1.25rem' }}>
            <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={loading}>
              {loading ? 'Submitting Application…' : 'Submit for Review'}
            </button>
            <button type="button" className="btn btn-muted" onClick={onClose} disabled={loading}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
