const User = require('../models/User');

// ─── Compatibility Scoring ────────────────────────────────────────────────────
// Returns { score, note } between 0-100.
// Fully transparent — no ML, rule-based reciprocal overlap.
function computeCompatibility(currentUser, candidate) {
  const reasons = [];
  let score = 0;

  const myWanted     = (currentUser.skillsWanted  || []).map(s => s.skill.toLowerCase());
  const myOffered    = (currentUser.skillsOffered || []).map(s => s.skill.toLowerCase());
  const theirOffered = (candidate.skillsOffered  || []).map(s => s.skill.toLowerCase());
  const theirWanted  = (candidate.skillsWanted   || []).map(s => s.skill.toLowerCase());

  // How many of MY wanted skills does the candidate offer?
  const forwardMatches = myWanted.filter(s => theirOffered.includes(s));
  // How many of THEIR wanted skills can I offer?
  const reverseMatches = theirWanted.filter(s => myOffered.includes(s));

  // Forward match: up to 60 points
  if (forwardMatches.length > 0) {
    const pts = Math.min(60, forwardMatches.length * 20);
    score += pts;
    reasons.push(`They offer ${forwardMatches.length} skill(s) you want: ${forwardMatches.join(', ')}`);
  }

  // Reverse match: up to 40 points (bidirectionality bonus)
  if (reverseMatches.length > 0) {
    const pts = Math.min(40, reverseMatches.length * 20);
    score += pts;
    reasons.push(`You offer ${reverseMatches.length} skill(s) they want: ${reverseMatches.join(', ')}`);
  }

  // Cap at 100
  score = Math.min(100, score);

  return {
    score,
    note: reasons.length > 0 ? reasons.join('. ') + '.' : 'No direct skill overlap found.',
    forwardMatches,
    reverseMatches,
  };
}

// ─── Availability overlap check ───────────────────────────────────────────────
function hasAvailabilityOverlap(slotsA, slotsB) {
  if (!slotsA || !slotsB || slotsA.length === 0 || slotsB.length === 0) return null; // unknown
  for (const a of slotsA) {
    for (const b of slotsB) {
      if (a.day === b.day && a.from < b.to && b.from < a.to) return true;
    }
  }
  return false;
}

// GET /api/match
// Returns ranked matches with compatibility scores and explanations
exports.getMatches = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const myWanted = (user.skillsWanted || []).map(s => s.skill);

    if (myWanted.length === 0) {
      return res.status(200).json({ matches: [], message: 'Add skills you want to learn in your profile to see ranked matches.' });
    }

    // Fetch candidates: exclude self, users blocked by current user, AND users who blocked current user
    const candidates = await User.find({
      _id: { $nin: [user._id, ...(user.blockedUsers || [])] },
      blockedUsers: { $ne: user._id },
      'skillsOffered.skill': { $in: myWanted },
    }).select('-password -blockedUsers');

    // Score and annotate each candidate
    const scored = candidates.map(candidate => {
      const { score, note, forwardMatches, reverseMatches } = computeCompatibility(user, candidate);
      const availOverlap = hasAvailabilityOverlap(user.availabilitySlots, candidate.availabilitySlots);

      return {
        user: {
          _id:            candidate._id,
          name:           candidate.name,
          bio:            candidate.bio,
          skillsOffered:  candidate.skillsOffered,
          skillsWanted:   candidate.skillsWanted,
          availabilitySlots: candidate.availabilitySlots,
          availability:   candidate.availability,
          averageRating:  candidate.averageRating,
          totalRatings:   candidate.totalRatings,
        },
        compatibilityScore: score,
        compatibilityNote:  note,
        forwardMatches,
        reverseMatches,
        availabilityOverlap: availOverlap,
      };
    });

    // Sort by score descending
    scored.sort((a, b) => b.compatibilityScore - a.compatibilityScore);

    res.status(200).json({ matches: scored });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/match/search?q=keyword
// Browse / search users by skill name or user name (mutually excludes blocked users)
exports.searchUsers = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const blockedList = user ? (user.blockedUsers || []) : [];

    const q = req.query.q || '';
    const regex = new RegExp(q, 'i');

    const users = await User.find({
      _id: { $nin: [req.userId, ...blockedList] },
      blockedUsers: { $ne: req.userId },
      $or: [
        { name: regex },
        { 'skillsOffered.skill': regex },
        { 'skillsWanted.skill': regex },
      ],
    }).select('name bio skillsOffered skillsWanted averageRating totalRatings availability availabilitySlots');

    res.status(200).json(users);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
