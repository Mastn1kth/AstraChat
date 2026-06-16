import { useState } from 'react'
import { BarChart3, Check, Lock } from 'lucide-react'

function totalVotes(options) {
  return options.reduce((sum, o) => sum + (o.votes || 0), 0)
}

export default function PollCard({ poll, onVote, isOwn }) {
  const [pending, setPending] = useState(false)
  if (!poll) return null

  const total = totalVotes(poll.options)
  const hasVoted = poll.options.some((o) => o.votedByMe)
  const closed = Boolean(poll.closedAt)
  const showResults = hasVoted || closed

  async function handleVote(optionId) {
    if (pending || closed || !onVote) return
    if (hasVoted && !poll.multipleChoice) return
    setPending(true)
    try {
      await onVote(poll.multipleChoice
        ? poll.options.filter((o) => o.votedByMe && o.id !== optionId || !o.votedByMe && o.id === optionId).map((o) => o.id)
        : [optionId])
    } finally {
      setPending(false)
    }
  }

  return (
    <div className={`poll-card ${isOwn ? 'poll-own' : ''}`}>
      <div className="poll-header">
        <BarChart3 size={14} className="poll-icon" />
        <span className="poll-type">
          {closed ? 'Closed poll' : poll.quiz ? 'Quiz' : poll.multipleChoice ? 'Multiple choice' : 'Poll'}
        </span>
        {closed && <Lock size={12} className="poll-lock" />}
      </div>
      <p className="poll-question">{poll.question}</p>
      <div className="poll-options">
        {poll.options.map((option) => {
          const pct = total > 0 ? Math.round((option.votes / total) * 100) : 0
          const isSelected = option.votedByMe
          return (
            <button
              key={option.id}
              className={`poll-option ${isSelected ? 'selected' : ''} ${showResults ? 'show-results' : ''}`}
              onClick={() => handleVote(option.id)}
              disabled={pending || closed || (hasVoted && !poll.multipleChoice)}
            >
              <div className="poll-option-bar" style={{ width: showResults ? `${pct}%` : '0%' }} />
              <span className="poll-option-text">{option.text}</span>
              {showResults && <span className="poll-option-pct">{pct}%</span>}
              {isSelected && <Check size={13} className="poll-option-check" />}
            </button>
          )
        })}
      </div>
      <div className="poll-footer">
        {total} {total === 1 ? 'vote' : 'votes'}
        {poll.anonymous && ' · Anonymous'}
      </div>
    </div>
  )
}
