import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import Spinner from '../components/Spinner'
import Avatar from '../components/Avatar'

export default function LearningDashboard() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const [searchParams] = useSearchParams()

  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('learning') // 'learning' | 'teaching'
  const [learningTracks, setLearningTracks] = useState([])
  const [teachingTracks, setTeachingTracks] = useState([])
  const [stats, setStats] = useState(null)
  const [upcomingMilestones, setUpcomingMilestones] = useState([])

  // Selected track for detail workspace modal
  const [selectedTrack, setSelectedTrack] = useState(null)
  const [trackLoading, setTrackLoading] = useState(false)

  // Modals inside track workspace
  const [submitMilestoneTarget, setSubmitMilestoneTarget] = useState(null)
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [submissionNotes, setSubmissionNotes] = useState('')

  const [reviewMilestoneTarget, setReviewMilestoneTarget] = useState(null)
  const [reviewAction, setReviewAction] = useState('approve')
  const [reviewFeedback, setReviewFeedback] = useState('')

  const [addMilestoneOpen, setAddMilestoneOpen] = useState(false)
  const [newMilestoneTitle, setNewMilestoneTitle] = useState('')
  const [newMilestoneDesc, setNewMilestoneDesc] = useState('')
  const [newMilestoneDueDate, setNewMilestoneDueDate] = useState('')

  // Quiz Modal state
  const [activeQuiz, setActiveQuiz] = useState(null)
  const [selectedAnswers, setSelectedAnswers] = useState({})
  const [quizSubmitting, setQuizSubmitting] = useState(false)
  const [quizResult, setQuizResult] = useState(null)

  // Practical Task Modals
  const [practicalSubmitTarget, setPracticalSubmitTarget] = useState(null)
  const [practicalText, setPracticalText] = useState('')
  const [practicalUrl, setPracticalUrl] = useState('')

  const [practicalEvalTarget, setPracticalEvalTarget] = useState(null)
  const [practicalPassed, setPracticalPassed] = useState(true)
  const [practicalFeedback, setPracticalFeedback] = useState('')

  // Action loading states
  const [actionLoading, setActionLoading] = useState(false)

  async function loadDashboard() {
    try {
      const { data } = await api.get('/learning/dashboard')
      setLearningTracks(data.learning || [])
      setTeachingTracks(data.teaching || [])
      setStats(data.stats || null)
      setUpcomingMilestones(data.upcomingMilestones || [])

      // Auto-open track if trackId is passed in URL query parameter
      const requestedTrackId = searchParams.get('trackId')
      if (requestedTrackId) {
        openTrackDetails(requestedTrackId)
      } else {
        const requestedSwapId = searchParams.get('swapId')
        if (requestedSwapId) {
          const match = (data.learning || []).concat(data.teaching || []).find(
            t => t.swapRequest?._id === requestedSwapId || t.swapRequest === requestedSwapId
          )
          if (match) {
            openTrackDetails(match._id)
          }
        }
      }
    } catch (err) {
      addToast('Failed to load learning dashboard', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDashboard()
  }, [searchParams])

  async function openTrackDetails(trackId) {
    setTrackLoading(true)
    try {
      const { data } = await api.get(`/learning/track/${trackId}`)
      setSelectedTrack(data)
    } catch (err) {
      addToast(err.response?.data?.message || 'Could not load learning track', 'error')
    } finally {
      setTrackLoading(false)
    }
  }

  // ── Milestone Actions ──────────────────────────────────────────────────
  async function handleCreateMilestone(e) {
    e.preventDefault()
    if (!newMilestoneTitle.trim()) return

    setActionLoading(true)
    try {
      const { data } = await api.post(`/learning/track/${selectedTrack._id}/milestones`, {
        title: newMilestoneTitle.trim(),
        description: newMilestoneDesc.trim(),
        dueDate: newMilestoneDueDate || null,
      })
      setSelectedTrack(data)
      setAddMilestoneOpen(false)
      setNewMilestoneTitle('')
      setNewMilestoneDesc('')
      setNewMilestoneDueDate('')
      addToast('Milestone added to learning roadmap 📌', 'success')
      loadDashboard()
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to add milestone', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleSubmitMilestone(e) {
    e.preventDefault()
    if (!submitMilestoneTarget) return

    setActionLoading(true)
    try {
      const { data } = await api.post(
        `/learning/track/${selectedTrack._id}/milestones/${submitMilestoneTarget._id}/submit`,
        {
          evidenceUrl: evidenceUrl.trim(),
          submissionNotes: submissionNotes.trim(),
        }
      )
      setSelectedTrack(data)
      setSubmitMilestoneTarget(null)
      setEvidenceUrl('')
      setSubmissionNotes('')
      addToast('Milestone submitted for instructor evaluation! 📝', 'success')
      loadDashboard()
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to submit milestone', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleReviewMilestone(e) {
    e.preventDefault()
    if (!reviewMilestoneTarget) return

    setActionLoading(true)
    try {
      const { data } = await api.post(
        `/learning/track/${selectedTrack._id}/milestones/${reviewMilestoneTarget._id}/review`,
        {
          action: reviewAction,
          feedback: reviewFeedback.trim(),
        }
      )
      setSelectedTrack(data)
      setReviewMilestoneTarget(null)
      setReviewFeedback('')
      addToast(
        reviewAction === 'approve'
          ? 'Milestone approved! Progress updated. ✅'
          : 'Revision requested from learner. ⚠️',
        'success'
      )
      loadDashboard()
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to review milestone', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleDeleteMilestone(milestoneId) {
    if (!window.confirm('Are you sure you want to delete this milestone?')) return
    try {
      const { data } = await api.delete(`/learning/track/${selectedTrack._id}/milestones/${milestoneId}`)
      setSelectedTrack(data)
      addToast('Milestone removed', 'info')
      loadDashboard()
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to delete milestone', 'error')
    }
  }

  // ── Quiz Actions ────────────────────────────────────────────────────────
  function startQuiz(quiz) {
    setActiveQuiz(quiz)
    setSelectedAnswers({})
    setQuizResult(null)
  }

  async function handleSubmitQuiz(e) {
    e.preventDefault()
    if (!activeQuiz) return

    const answersArray = activeQuiz.questions.map((_, idx) =>
      selectedAnswers[idx] !== undefined ? selectedAnswers[idx] : -1
    )

    if (answersArray.some(a => a === -1)) {
      addToast('Please answer all questions before submitting', 'warning')
      return
    }

    setQuizSubmitting(true)
    try {
      const { data } = await api.post(
        `/learning/track/${selectedTrack._id}/assessments/${activeQuiz._id}/quiz-submit`,
        { answers: answersArray }
      )
      setQuizResult(data)
      addToast(
        data.passed
          ? `Congratulations! You passed with ${data.score}%! 🎉`
          : `Scored ${data.score}%. Passing threshold is ${data.passingScore}%. Try again!`,
        data.passed ? 'success' : 'warning'
      )
      openTrackDetails(selectedTrack._id)
      loadDashboard()
    } catch (err) {
      addToast(err.response?.data?.message || 'Quiz submission failed', 'error')
    } finally {
      setQuizSubmitting(false)
    }
  }

  // ── Practical Task Actions ──────────────────────────────────────────────
  async function handleSubmitPractical(e) {
    e.preventDefault()
    if (!practicalSubmitTarget || !practicalText.trim()) return

    setActionLoading(true)
    try {
      await api.post(
        `/learning/track/${selectedTrack._id}/assessments/${practicalSubmitTarget._id}/practical-submit`,
        {
          submissionText: practicalText.trim(),
          evidenceUrl: practicalUrl.trim(),
        }
      )
      setPracticalSubmitTarget(null)
      setPracticalText('')
      setPracticalUrl('')
      addToast('Practical project submitted for evaluation! 💻', 'success')
      openTrackDetails(selectedTrack._id)
      loadDashboard()
    } catch (err) {
      addToast(err.response?.data?.message || 'Submission failed', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleEvaluatePractical(e) {
    e.preventDefault()
    if (!practicalEvalTarget) return

    setActionLoading(true)
    try {
      await api.post(
        `/learning/track/${selectedTrack._id}/assessments/${practicalEvalTarget._id}/practical-evaluate`,
        {
          passed: practicalPassed,
          feedback: practicalFeedback.trim(),
        }
      )
      setPracticalEvalTarget(null)
      setPracticalFeedback('')
      addToast('Practical project evaluated successfully! 📋', 'success')
      openTrackDetails(selectedTrack._id)
      loadDashboard()
    } catch (err) {
      addToast(err.response?.data?.message || 'Evaluation failed', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) return <Spinner message="Loading your peer learning dashboard…" />

  const isUserLearner = selectedTrack?.learner?._id === user?.id || selectedTrack?.learner === user?.id
  const isUserInstructor = selectedTrack?.instructor?._id === user?.id || selectedTrack?.instructor === user?.id

  const tracksToDisplay = activeTab === 'learning' ? learningTracks : teachingTracks

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      {/* Header */}
      <div className="page-header-flex">
        <div>
          <h2 className="page-title">Peer Learning & Progress</h2>
          <p className="page-sub">
            Track measurable milestones, submit proof of learning, and test comprehension through assessments.
          </p>
        </div>
      </div>

      {/* Metrics Row */}
      {stats && (
        <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
          <div className="stat-card">
            <span className="stat-value">{stats.totalLearning}</span>
            <span className="stat-label">📚 Skills Learning</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.totalTeaching}</span>
            <span className="stat-label">👨‍🏫 Skills Teaching</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.completedTracks}</span>
            <span className="stat-label">🏆 Tracks Mastered</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.avgProgress}%</span>
            <span className="stat-label">📈 Avg Progress</span>
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="swaps-tabs-bar" style={{ marginBottom: '1.25rem' }}>
        <button
          className={`tab-btn ${activeTab === 'learning' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('learning')}
        >
          📚 Skills I'm Learning ({learningTracks.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'teaching' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('teaching')}
        >
          👨‍🏫 Skills I'm Teaching ({teachingTracks.length})
        </button>
      </div>

      {/* Tracks Grid */}
      {tracksToDisplay.length === 0 ? (
        <div className="empty-card" style={{ marginTop: '1.5rem' }}>
          <div className="empty-icon">{activeTab === 'learning' ? '📖' : '🎓'}</div>
          <h3>No {activeTab} tracks yet</h3>
          <p style={{ maxWidth: 480, margin: '.5rem auto 1.5rem', color: 'var(--text-muted)' }}>
            {activeTab === 'learning'
              ? 'When a skill swap is accepted, a personalized learning track is automatically generated for you.'
              : 'You have not accepted any teaching barter sessions yet. Match with peers to start coaching.'}
          </p>
          <Link to="/matches" className="btn btn-primary shadow-glow">
            Find Matches →
          </Link>
        </div>
      ) : (
        <div className="card-grid">
          {tracksToDisplay.map(t => {
            const partner = activeTab === 'learning' ? t.instructor : t.learner
            const totalM = t.milestones?.length || 0
            const approvedM = (t.milestones || []).filter(m => m.status === 'approved').length

            return (
              <div key={t._id} className="card peer-card" style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="peer-card-header">
                  <Avatar name={partner?.name} size={46} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <strong style={{ fontSize: '1.15rem' }}>{t.skillName}</strong>
                      <span className={`badge ${t.status === 'completed' ? 'badge-green' : 'badge-blue'}`}>
                        {t.status === 'completed' ? '✓ Mastered' : 'In Progress'}
                      </span>
                    </div>
                    <span style={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>
                      {activeTab === 'learning' ? `Instructor: ${partner?.name}` : `Learner: ${partner?.name}`}
                    </span>
                  </div>
                </div>

                {t.learningObjective && (
                  <p style={{ fontSize: '.84rem', color: 'var(--text-muted)', margin: '.6rem 0' }}>
                    {t.learningObjective}
                  </p>
                )}

                {/* Progress Bar */}
                <div style={{ margin: 'auto 0 .8rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.78rem', marginBottom: '.3rem' }}>
                    <span>Milestones: {approvedM}/{totalM}</span>
                    <strong>{t.overallProgress}%</strong>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 999, height: 8, overflow: 'hidden' }}>
                    <div
                      style={{
                        background: t.overallProgress === 100 ? '#10b981' : 'var(--primary, #6366f1)',
                        width: `${t.overallProgress}%`,
                        height: '100%',
                        transition: 'width 0.4s ease',
                      }}
                    />
                  </div>
                </div>

                <button
                  className="btn btn-primary btn-sm btn-block shadow-glow"
                  onClick={() => openTrackDetails(t._id)}
                >
                  Open Learning Roadmap 🎯
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Track Workspace Modal / View */}
      {selectedTrack && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setSelectedTrack(null) }}>
          <div className="modal" style={{ maxWidth: 780, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1.4rem' }}>{selectedTrack.skillName}</h3>
                  <span className={`badge ${selectedTrack.status === 'completed' ? 'badge-green' : 'badge-blue'}`}>
                    {selectedTrack.status === 'completed' ? '✓ Mastered' : 'In Progress'}
                  </span>
                </div>
                <p style={{ margin: '.3rem 0 0', fontSize: '.85rem', color: 'var(--text-muted)' }}>
                  Learner: <strong>{selectedTrack.learner?.name}</strong> • Instructor: <strong>{selectedTrack.instructor?.name}</strong>
                </p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelectedTrack(null)}>✕</button>
            </div>

            {/* Overall Progress Banner */}
            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: 8, marginBottom: '1.5rem', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem' }}>
                <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Roadmap Progress</span>
                <span style={{ fontWeight: 700, fontSize: '1.1rem', color: selectedTrack.overallProgress === 100 ? '#10b981' : '#6366f1' }}>
                  {selectedTrack.overallProgress}%
                </span>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 999, height: 10, overflow: 'hidden' }}>
                <div
                  style={{
                    background: selectedTrack.overallProgress === 100 ? '#10b981' : 'var(--primary, #6366f1)',
                    width: `${selectedTrack.overallProgress}%`,
                    height: '100%',
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
              {selectedTrack.learningObjective && (
                <p style={{ margin: '.6rem 0 0', fontSize: '.82rem', color: 'var(--text-muted)' }}>
                  🎯 <strong>Goal:</strong> {selectedTrack.learningObjective}
                </p>
              )}
            </div>

            {/* Milestones Section */}
            <div style={{ marginBottom: '2rem' }}>
              <div className="section-title-row" style={{ marginBottom: '1rem' }}>
                <h4 style={{ margin: 0 }}>📍 Milestones ({selectedTrack.milestones?.length || 0})</h4>
                {isUserInstructor && (
                  <button className="btn btn-muted btn-sm" onClick={() => setAddMilestoneOpen(true)}>
                    + Add Milestone
                  </button>
                )}
              </div>

              {selectedTrack.milestones?.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '.88rem' }}>
                  No milestones added to this roadmap yet.
                </p>
              ) : (
                <div className="card-list">
                  {selectedTrack.milestones.map((m, idx) => (
                    <div key={m._id} style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid var(--border-color)', marginBottom: '.75rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '.5rem' }}>
                        <div>
                          <strong style={{ fontSize: '1rem' }}>
                            {idx + 1}. {m.title}
                          </strong>
                          {m.dueDate && (
                            <span style={{ marginLeft: '.5rem', fontSize: '.75rem', color: 'var(--text-muted)' }}>
                              Due: {new Date(m.dueDate).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        <div>
                          {m.status === 'approved' && <span className="badge badge-green">✓ Approved</span>}
                          {m.status === 'submitted' && <span className="badge badge-blue">⏳ Under Review</span>}
                          {m.status === 'revision_requested' && <span className="badge badge-rejected">⚠️ Revision Requested</span>}
                          {m.status === 'pending' && <span className="badge badge-pending">Pending</span>}
                        </div>
                      </div>

                      {m.description && (
                        <p style={{ margin: '.4rem 0', fontSize: '.85rem', color: 'var(--text-muted)' }}>
                          {m.description}
                        </p>
                      )}

                      {/* Evidence & Submission Notes */}
                      {m.evidenceUrl && (
                        <div style={{ fontSize: '.82rem', marginTop: '.4rem' }}>
                          🔗 Evidence:{' '}
                          <a href={m.evidenceUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>
                            {m.evidenceUrl}
                          </a>
                        </div>
                      )}
                      {m.submissionNotes && (
                        <div style={{ fontSize: '.82rem', color: 'var(--text-muted)', marginTop: '.2rem' }}>
                          💬 Notes: {m.submissionNotes}
                        </div>
                      )}

                      {/* Feedback from instructor */}
                      {m.feedback && (
                        <div style={{ marginTop: '.5rem', padding: '.5rem .75rem', background: 'rgba(255,255,255,0.03)', borderRadius: 6, fontSize: '.82rem' }}>
                          <strong>Instructor Feedback:</strong> {m.feedback}
                        </div>
                      )}

                      {/* Action buttons */}
                      <div style={{ marginTop: '.75rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                        {isUserLearner && (m.status === 'pending' || m.status === 'revision_requested') && (
                          <button
                            className="btn btn-primary btn-xs"
                            onClick={() => {
                              setSubmitMilestoneTarget(m)
                              setEvidenceUrl(m.evidenceUrl || '')
                              setSubmissionNotes(m.submissionNotes || '')
                            }}
                          >
                            Submit Proof of Work 📝
                          </button>
                        )}

                        {isUserInstructor && m.status === 'submitted' && (
                          <button
                            className="btn btn-primary btn-xs"
                            onClick={() => {
                              setReviewMilestoneTarget(m)
                              setReviewAction('approve')
                              setReviewFeedback('')
                            }}
                          >
                            Evaluate Submission ⚖️
                          </button>
                        )}

                        {isUserInstructor && (
                          <button
                            className="btn btn-danger btn-xs"
                            onClick={() => handleDeleteMilestone(m._id)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Assessments Section */}
            <div>
              <div className="section-title-row" style={{ marginBottom: '1rem' }}>
                <h4 style={{ margin: 0 }}>📊 Skill Assessments & Quizzes ({selectedTrack.assessments?.length || 0})</h4>
              </div>

              {selectedTrack.assessments?.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '.88rem' }}>
                  No quizzes or practical evaluations set for this track yet.
                </p>
              ) : (
                <div className="card-list">
                  {selectedTrack.assessments.map(a => {
                    const latestAttempt = a.attempts?.[a.attempts?.length - 1]

                    return (
                      <div key={a._id} style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid var(--border-color)', marginBottom: '.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <strong style={{ fontSize: '1rem' }}>{a.title}</strong>
                            <span style={{ marginLeft: '.5rem', fontSize: '.75rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.06)' }}>
                              {a.type === 'quiz' ? 'Multiple-Choice Quiz' : 'Practical Project Task'}
                            </span>
                          </div>
                          <div>
                            {a.type === 'quiz' && latestAttempt ? (
                              <span className={`badge ${latestAttempt.passed ? 'badge-green' : 'badge-rejected'}`}>
                                Score: {latestAttempt.score}% ({latestAttempt.passed ? 'PASSED' : 'NEEDS PRACTICE'})
                              </span>
                            ) : a.type === 'practical' ? (
                              <span className={`badge ${a.evaluationStatus === 'evaluated' ? (a.passed ? 'badge-green' : 'badge-rejected') : 'badge-pending'}`}>
                                {a.evaluationStatus === 'evaluated' ? (a.passed ? 'Passed' : 'Needs Revision') : a.evaluationStatus === 'submitted' ? 'Submitted' : 'Not Started'}
                              </span>
                            ) : (
                              <span className="badge badge-pending">Unattempted</span>
                            )}
                          </div>
                        </div>

                        {a.description && (
                          <p style={{ margin: '.4rem 0', fontSize: '.85rem', color: 'var(--text-muted)' }}>
                            {a.description}
                          </p>
                        )}

                        {/* Quiz Trigger */}
                        {a.type === 'quiz' && (
                          <div style={{ marginTop: '.75rem' }}>
                            {isUserLearner && (
                              <button
                                className="btn btn-outline btn-xs"
                                onClick={() => startQuiz(a)}
                              >
                                {latestAttempt ? 'Retake Quiz ↻' : 'Take Quiz ✍️'}
                              </button>
                            )}
                            {a.attempts?.length > 0 && (
                              <span style={{ marginLeft: '.6rem', fontSize: '.78rem', color: 'var(--text-muted)' }}>
                                Attempts: {a.attempts.length}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Practical Task Trigger */}
                        {a.type === 'practical' && (
                          <div style={{ marginTop: '.75rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                            {a.instructions && (
                              <p style={{ width: '100%', fontSize: '.82rem', color: 'var(--text-muted)' }}>
                                📋 Instructions: {a.instructions}
                              </p>
                            )}

                            {a.evidenceUrl && (
                              <div style={{ width: '100%', fontSize: '.82rem' }}>
                                🔗 Evidence: <a href={a.evidenceUrl} target="_blank" rel="noopener noreferrer">{a.evidenceUrl}</a>
                              </div>
                            )}

                            {a.instructorFeedback && (
                              <div style={{ width: '100%', padding: '.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: 6, fontSize: '.82rem' }}>
                                <strong>Feedback:</strong> {a.instructorFeedback}
                              </div>
                            )}

                            {isUserLearner && a.evaluationStatus !== 'evaluated' && (
                              <button
                                className="btn btn-primary btn-xs"
                                onClick={() => {
                                  setPracticalSubmitTarget(a)
                                  setPracticalText(a.submissionText || '')
                                  setPracticalUrl(a.evidenceUrl || '')
                                }}
                              >
                                Submit Practical Project 💻
                              </button>
                            )}

                            {isUserInstructor && a.evaluationStatus === 'submitted' && (
                              <button
                                className="btn btn-primary btn-xs"
                                onClick={() => {
                                  setPracticalEvalTarget(a)
                                  setPracticalPassed(true)
                                  setPracticalFeedback('')
                                }}
                              >
                                Grade Practical Project ⚖️
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Sub-Modals ──────────────────────────────────────────────────────── */}

      {/* Add Milestone Modal */}
      {addMilestoneOpen && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setAddMilestoneOpen(false) }}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <h3>Add Learning Milestone</h3>
            <form onSubmit={handleCreateMilestone}>
              <div className="form-group">
                <label className="form-label">Milestone Title</label>
                <input
                  className="form-input"
                  placeholder="e.g. Master React State & Hooks"
                  value={newMilestoneTitle}
                  onChange={e => setNewMilestoneTitle(e.target.value)}
                  required
                />
              </div>
              <div className="form-group" style={{ marginTop: '.8rem' }}>
                <label className="form-label">Description / Instructions</label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  placeholder="What concepts should the student study or build?"
                  value={newMilestoneDesc}
                  onChange={e => setNewMilestoneDesc(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ marginTop: '.8rem' }}>
                <label className="form-label">Target Completion Date (Optional)</label>
                <input
                  type="date"
                  className="form-input"
                  value={newMilestoneDueDate}
                  onChange={e => setNewMilestoneDueDate(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: '.5rem', marginTop: '1.25rem' }}>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={actionLoading}>
                  {actionLoading ? 'Saving…' : 'Add Milestone'}
                </button>
                <button type="button" className="btn btn-muted" onClick={() => setAddMilestoneOpen(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Submit Milestone Modal */}
      {submitMilestoneTarget && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setSubmitMilestoneTarget(null) }}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <h3>Submit Proof of Work</h3>
            <p style={{ fontSize: '.85rem', color: 'var(--text-muted)' }}>
              for: <strong>{submitMilestoneTarget.title}</strong>
            </p>
            <form onSubmit={handleSubmitMilestone}>
              <div className="form-group">
                <label className="form-label">Evidence URL (GitHub, Google Docs, or Demo link)</label>
                <input
                  type="url"
                  className="form-input"
                  placeholder="https://github.com/..."
                  value={evidenceUrl}
                  onChange={e => setEvidenceUrl(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ marginTop: '.8rem' }}>
                <label className="form-label">Notes for Your Instructor</label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  placeholder="Summarize what you implemented or any challenges encountered…"
                  value={submissionNotes}
                  onChange={e => setSubmissionNotes(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: '.5rem', marginTop: '1.25rem' }}>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={actionLoading}>
                  {actionLoading ? 'Submitting…' : 'Submit for Review'}
                </button>
                <button type="button" className="btn btn-muted" onClick={() => setSubmitMilestoneTarget(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Review Milestone Modal */}
      {reviewMilestoneTarget && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setReviewMilestoneTarget(null) }}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <h3>Evaluate Milestone Submission</h3>
            <p style={{ fontSize: '.85rem', color: 'var(--text-muted)' }}>
              Milestone: <strong>{reviewMilestoneTarget.title}</strong>
            </p>
            {reviewMilestoneTarget.evidenceUrl && (
              <p style={{ fontSize: '.84rem', margin: '.4rem 0' }}>
                🔗 <a href={reviewMilestoneTarget.evidenceUrl} target="_blank" rel="noopener noreferrer">Inspect Student Evidence Link</a>
              </p>
            )}
            <form onSubmit={handleReviewMilestone}>
              <div className="form-group" style={{ marginTop: '1rem' }}>
                <label className="form-label">Decision</label>
                <div style={{ display: 'flex', gap: '.5rem' }}>
                  <button
                    type="button"
                    className={`btn ${reviewAction === 'approve' ? 'btn-primary' : 'btn-muted'}`}
                    style={{ flex: 1 }}
                    onClick={() => setReviewAction('approve')}
                  >
                    ✓ Approve Milestone
                  </button>
                  <button
                    type="button"
                    className={`btn ${reviewAction === 'revision_requested' ? 'btn-danger' : 'btn-muted'}`}
                    style={{ flex: 1 }}
                    onClick={() => setReviewAction('revision_requested')}
                  >
                    ⚠️ Request Revision
                  </button>
                </div>
              </div>
              <div className="form-group" style={{ marginTop: '.8rem' }}>
                <label className="form-label">Constructive Feedback for Student</label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  placeholder="Provide constructive feedback or specify what needs revision…"
                  value={reviewFeedback}
                  onChange={e => setReviewFeedback(e.target.value)}
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: '.5rem', marginTop: '1.25rem' }}>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={actionLoading}>
                  {actionLoading ? 'Saving…' : 'Submit Evaluation'}
                </button>
                <button type="button" className="btn btn-muted" onClick={() => setReviewMilestoneTarget(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Active Quiz Taker Modal */}
      {activeQuiz && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setActiveQuiz(null) }}>
          <div className="modal" style={{ maxWidth: 580 }}>
            <h3>{activeQuiz.title}</h3>
            {activeQuiz.description && (
              <p style={{ fontSize: '.85rem', color: 'var(--text-muted)' }}>{activeQuiz.description}</p>
            )}

            {quizResult ? (
              <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                <div style={{ fontSize: '3rem', marginBottom: '.5rem' }}>
                  {quizResult.passed ? '🎉' : '📚'}
                </div>
                <h4>{quizResult.passed ? 'Passed Assessment!' : 'Needs Practice'}</h4>
                <p style={{ fontSize: '1.2rem', fontWeight: 700, margin: '.5rem 0', color: quizResult.passed ? '#10b981' : '#f59e0b' }}>
                  Score: {quizResult.score}% ({quizResult.correctCount}/{quizResult.totalQuestions} correct)
                </p>
                <p style={{ fontSize: '.84rem', color: 'var(--text-muted)' }}>
                  Passing threshold: {quizResult.passingScore}%
                </p>
                <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => setActiveQuiz(null)}>
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmitQuiz}>
                <div style={{ marginTop: '1rem' }}>
                  {activeQuiz.questions.map((q, qIndex) => (
                    <div key={qIndex} style={{ marginBottom: '1.25rem', padding: '.85rem', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid var(--border-color)' }}>
                      <strong style={{ fontSize: '.95rem' }}>
                        {qIndex + 1}. {q.question}
                      </strong>
                      <div style={{ marginTop: '.6rem' }}>
                        {q.options.map((opt, oIndex) => (
                          <label
                            key={oIndex}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '.5rem',
                              padding: '.4rem .6rem',
                              borderRadius: 6,
                              marginBottom: '.3rem',
                              background: selectedAnswers[qIndex] === oIndex ? 'rgba(99,102,241,0.15)' : 'transparent',
                              cursor: 'pointer',
                              border: selectedAnswers[qIndex] === oIndex ? '1px solid #6366f1' : '1px solid transparent',
                            }}
                          >
                            <input
                              type="radio"
                              name={`question-${qIndex}`}
                              checked={selectedAnswers[qIndex] === oIndex}
                              onChange={() => setSelectedAnswers({ ...selectedAnswers, [qIndex]: oIndex })}
                            />
                            <span style={{ fontSize: '.88rem' }}>{opt}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '.5rem', marginTop: '1.25rem' }}>
                  <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={quizSubmitting}>
                    {quizSubmitting ? 'Grading on Server…' : 'Submit Answers'}
                  </button>
                  <button type="button" className="btn btn-muted" onClick={() => setActiveQuiz(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Practical Submit Modal */}
      {practicalSubmitTarget && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setPracticalSubmitTarget(null) }}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <h3>Submit Practical Project</h3>
            <form onSubmit={handleSubmitPractical}>
              <div className="form-group">
                <label className="form-label">Project / Work Description</label>
                <textarea
                  className="form-textarea"
                  rows={4}
                  placeholder="Detail your solution, tech stack, and testing methodology…"
                  value={practicalText}
                  onChange={e => setPracticalText(e.target.value)}
                  required
                />
              </div>
              <div className="form-group" style={{ marginTop: '.8rem' }}>
                <label className="form-label">GitHub Repository or Live Demo URL</label>
                <input
                  type="url"
                  className="form-input"
                  placeholder="https://github.com/..."
                  value={practicalUrl}
                  onChange={e => setPracticalUrl(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: '.5rem', marginTop: '1.25rem' }}>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={actionLoading}>
                  {actionLoading ? 'Submitting…' : 'Submit Project'}
                </button>
                <button type="button" className="btn btn-muted" onClick={() => setPracticalSubmitTarget(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Practical Evaluate Modal */}
      {practicalEvalTarget && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setPracticalEvalTarget(null) }}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <h3>Evaluate Practical Project</h3>
            <form onSubmit={handleEvaluatePractical}>
              <div className="form-group">
                <label className="form-label">Assessment Result</label>
                <div style={{ display: 'flex', gap: '.5rem' }}>
                  <button
                    type="button"
                    className={`btn ${practicalPassed ? 'btn-primary' : 'btn-muted'}`}
                    style={{ flex: 1 }}
                    onClick={() => setPracticalPassed(true)}
                  >
                    ✓ Mark Passed
                  </button>
                  <button
                    type="button"
                    className={`btn ${!practicalPassed ? 'btn-danger' : 'btn-muted'}`}
                    style={{ flex: 1 }}
                    onClick={() => setPracticalPassed(false)}
                  >
                    ⚠️ Needs Revision
                  </button>
                </div>
              </div>
              <div className="form-group" style={{ marginTop: '.8rem' }}>
                <label className="form-label">Feedback for Learner</label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  placeholder="Evaluate code cleanliness, functionality, and suggestions…"
                  value={practicalFeedback}
                  onChange={e => setPracticalFeedback(e.target.value)}
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: '.5rem', marginTop: '1.25rem' }}>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={actionLoading}>
                  {actionLoading ? 'Saving…' : 'Submit Evaluation'}
                </button>
                <button type="button" className="btn btn-muted" onClick={() => setPracticalEvalTarget(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
